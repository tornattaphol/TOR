import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryDrawStore } from "../../src/lib/db/memory-store";
import { ConfigError, parseSourcesConfig, type SourceConfig, type SourcesConfig } from "../../src/lib/config/sources";
import { ingestAll, ingestSource, type PipelineDeps } from "../../src/lib/ingestion/pipeline";
import { getHealth } from "../../src/lib/services";
import { htmlSource, listPageHtml, robotsAllowAll, startServer, testHttp, type FixtureRow, type TestServer } from "../helpers/fixtures";

const TODAY = "2026-10-04";
const row = (date: string, r4: string): FixtureRow => ({ date, r4, r3: r4.slice(1), r2: r4.slice(2) });

/** Real values seen on the live source (Mon/Wed/Fri), used here only as realistic fixture text. */
const WEEK = [row("2026-10-02", "4693"), row("2026-09-30", "3653"), row("2026-09-28", "4277")];
const PREV = [row("2026-09-25", "2383"), row("2026-09-23", "7960")];

let server: TestServer;
let store: MemoryDrawStore;
const servers: TestServer[] = [];
const tmpDirs: string[] = [];

async function serve(routes: Parameters<typeof startServer>[0]) {
  const s = await startServer(routes);
  servers.push(s);
  return s;
}

beforeEach(() => {
  store = new MemoryDrawStore();
});
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const cfgOf = (...sources: SourceConfig[]): SourcesConfig => ({ lotteryCode: "LAO_DEV", sources });

function run(src: SourceConfig, over: Partial<PipelineDeps> = {}, extraSources: SourceConfig[] = []) {
  return ingestSource(src, { store, config: cfgOf(src, ...extraSources), http: testHttp(), today: TODAY, trigger: "test", ...over });
}

const twoPages = () => ({
  "/robots.txt": robotsAllowAll,
  "/en/lottery/lao-lottery": listPageHtml(WEEK, { page: 1, total: 2 }),
  "/en/lottery/lao-lottery?page=2": listPageHtml(PREV, { page: 2, total: 2 }),
});

describe("ingestion — valid data", () => {
  it("fetches every page, validates and stores records with provenance", async () => {
    server = await serve(twoPages());
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "SUCCESS", errorCode: null, pagesFetched: 2, recordsParsed: 5, recordsValid: 5, inserted: 5, updated: 0, unchanged: 0, invalid: 0 });
    const rows = await store.findDraws();
    expect(rows.map((r) => r.drawDate)).toEqual(["2026-09-23", "2026-09-25", "2026-09-28", "2026-09-30", "2026-10-02"]);
    expect(rows.at(-1)).toMatchObject({
      result4: "4693", result3: "693", result2: "93", source: "fixture-html", drawId: "lao_dev_20261002", hasConflict: false,
      sourceUrl: `${server.url}/en/lottery/lao-lottery/2026-10-02`,
    });
    expect(new Date(rows[0].fetchedAt).getTime()).toBeGreaterThan(0);
    const runs = await store.listRuns(5);
    expect(runs[0]).toMatchObject({ status: "SUCCESS", trigger: "test", inserted: 5 });
    expect(await store.lastSuccessfulRunAt()).not.toBeNull();
  });

  it("is idempotent: a second run reports everything as unchanged", async () => {
    server = await serve(twoPages());
    await run(htmlSource(server.url));
    const again = await run(htmlSource(server.url));
    expect(again).toMatchObject({ status: "SUCCESS", inserted: 0, updated: 0, unchanged: 5 });
    expect(await store.countDraws()).toBe(5);
  });

  it("incremental refresh honours maxPages", async () => {
    server = await serve(twoPages());
    const out = await run(htmlSource(server.url), { maxPages: 1 });
    expect(out).toMatchObject({ pagesFetched: 1, inserted: 3 });
    expect(server.hits.filter((h) => h.includes("page=2"))).toEqual([]);
  });

  it("identifies itself and checks robots.txt exactly once per origin", async () => {
    let ua = "";
    server = await serve({ ...twoPages(), "/en/lottery/lao-lottery": (req, res) => { ua = String(req.headers["user-agent"]); res.setHeader("content-type", "text/html"); res.end(listPageHtml(WEEK, { page: 1, total: 2 })); } });
    await run(htmlSource(server.url), { http: testHttp({ userAgent: "StatsBot/9 (+contact)" }) });
    expect(ua).toBe("StatsBot/9 (+contact)");
    expect(server.hits.filter((h) => h === "/robots.txt")).toHaveLength(1);
  });

  it("follows the configured host only (never links found in page content)", async () => {
    const evil = await serve({ "/en/lottery/lao-lottery/2026-10-02": "evil" });
    const html = listPageHtml(WEEK, { page: 1, total: 1 }).replace(/href="\/en\/lottery\/lao-lottery\/2026-10-02"/, `href="${evil.url}/en/lottery/lao-lottery/2026-10-02"`);
    server = await serve({ "/en/lottery/lao-lottery": html });
    await run(htmlSource(server.url));
    expect(evil.hits).toEqual([]);
  });
});

describe("ingestion — duplicate data", () => {
  it("collapses rows repeated across pages (pagination overlap) and records an INFO issue", async () => {
    server = await serve({
      "/en/lottery/lao-lottery": listPageHtml([...WEEK], { page: 1, total: 2 }),
      "/en/lottery/lao-lottery?page=2": listPageHtml([WEEK[2], ...PREV], { page: 2, total: 2 }), // 09-28 appears again
    });
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "SUCCESS", recordsParsed: 6, recordsValid: 5, duplicates: 1, inserted: 5 });
    expect(await store.countDraws()).toBe(5);
    const issues = await store.listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "DUPLICATE_IN_SOURCE", severity: "INFO", drawDate: "2026-09-28" });
  });

  it("repeated runs update one issue row (occurrences grow) instead of piling up", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([WEEK[0], WEEK[0]], { page: 1, total: 1 }) });
    await run(htmlSource(server.url));
    await run(htmlSource(server.url));
    const issues = await store.listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].occurrences).toBe(2);
  });
});

describe("ingestion — missing draws", () => {
  it("stores what exists and Data Health reports the gap", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([row("2026-10-02", "4693"), row("2026-09-28", "4277"), row("2026-09-25", "2383")], { page: 1, total: 1 }) }); // 09-30 missing
    const src = htmlSource(server.url);
    const out = await run(src);
    expect(out.status).toBe("SUCCESS");
    const health = await getHealth(store, cfgOf(src));
    expect(health.schedule.missing).toEqual([{ date: "2026-09-30", reason: "not_in_source" }]);
    expect(health.totals.records).toBe(3);
    expect(health.status).toBe("warning");
  });

  it("a record rejected by validation shows up as a missing draw caused by validation", async () => {
    const bad: FixtureRow = { date: "2026-09-30", r4: "0599", r3: "599", r2: "59" }; // real source anomaly pattern
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([row("2026-10-02", "4693"), bad, row("2026-09-28", "4277")], { page: 1, total: 1 }) });
    const src = htmlSource(server.url);
    const out = await run(src);
    expect(out).toMatchObject({ status: "PARTIAL", invalid: 1, inserted: 2 });
    const health = await getHealth(store, cfgOf(src));
    expect(health.schedule.missing).toEqual([{ date: "2026-09-30", reason: "rejected_by_validation" }]);
    expect(health.issues.derivedMismatch).toBe(1);
  });
});

describe("ingestion — malformed data", () => {
  it("keeps valid rows, records every rejected one, and ends PARTIAL", async () => {
    server = await serve({
      "/en/lottery/lao-lottery": listPageHtml(
        [
          row("2026-10-02", "4693"),
          { date: "2026-09-30", r4: "36x3", r3: "6x3", r2: "x3" },
          { date: "2026-09-28", r4: "42777", r3: "277", r2: "77" },
          { date: "2026-02-30", r4: "2383", r3: "383", r2: "83" }, // "30 February 2026" does not exist
          row("2026-09-23", "7960"),
        ],
        { page: 1, total: 1 },
      ),
    });
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "PARTIAL", recordsParsed: 5, recordsValid: 2, invalid: 3, inserted: 2 });
    expect((await store.findDraws()).map((d) => d.drawDate)).toEqual(["2026-09-23", "2026-10-02"]);
    const kinds = (await store.listIssues()).map((i) => i.kind).sort();
    expect(kinds).toEqual(["INVALID_DATE", "INVALID_NUMBER_FORMAT", "INVALID_NUMBER_FORMAT"]);
  });

  it("when nothing validates the run FAILS (NO_VALID_RECORDS), nothing is stored, but the evidence is kept", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([{ date: "2026-10-02", r4: "ab12", r3: "b12", r2: "12" }], { page: 1, total: 1 }) });
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "FAILED", errorCode: "NO_VALID_RECORDS", inserted: 0 });
    expect(await store.countDraws()).toBe(0);
    expect(await store.lastSuccessfulRunAt()).toBeNull();
    expect((await store.listIssues())[0].kind).toBe("INVALID_NUMBER_FORMAT");
  });

  it("quarantines results on non-draw weekdays (e.g. an aggregator listing Tue/Thu)", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([row("2026-10-02", "4693"), row("2026-10-01", "5609"), row("2026-09-29", "6616"), row("2026-09-30", "3653")], { page: 1, total: 1 }) });
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "PARTIAL", quarantined: 2, inserted: 2 });
    expect((await store.findDraws()).map((d) => d.drawDate)).toEqual(["2026-09-30", "2026-10-02"]);
    const q = (await store.listIssues({ kind: "UNEXPECTED_WEEKDAY" })).map((i) => i.drawDate).sort();
    expect(q).toEqual(["2026-09-29", "2026-10-01"]);
  });

  it("rejects future-dated rows", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([row("2026-10-02", "4693"), row("2026-10-07", "1234")], { page: 1, total: 1 }) });
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "PARTIAL", invalid: 1, inserted: 1 });
    expect((await store.listIssues())[0].kind).toBe("FUTURE_DATE");
  });
});

describe("ingestion — source unavailable", () => {
  it("HTTP 500 → FAILED SOURCE_UNAVAILABLE after bounded retries; no data written", async () => {
    server = await serve({ "/en/lottery/lao-lottery": (_q, res) => { res.statusCode = 500; res.end("err"); } });
    const out = await run(htmlSource(server.url), { http: testHttp({ maxRetries: 2 }) });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE", inserted: 0, pagesFetched: 0 });
    expect(out.errorMessage).toMatch(/HTTP 500/);
    expect(server.hits.filter((h) => h.startsWith("/en/lottery"))).toHaveLength(3); // 1 try + 2 retries
    expect(await store.countDraws()).toBe(0);
    expect((await store.listRuns(1))[0]).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
  });

  it("HTTP 404 is not retried", async () => {
    server = await serve({});
    const out = await run(htmlSource(server.url), { http: testHttp({ maxRetries: 3 }) });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
    expect(server.hits.filter((h) => h.startsWith("/en/lottery"))).toHaveLength(1);
  });

  it("recovers when a transient error clears within the retry budget", async () => {
    let n = 0;
    server = await serve({ "/en/lottery/lao-lottery": (_q, res) => { if (n++ === 0) { res.statusCode = 503; res.end(); return; } res.setHeader("content-type", "text/html"); res.end(listPageHtml(WEEK, { page: 1, total: 1 })); } });
    const out = await run(htmlSource(server.url), { http: testHttp({ maxRetries: 2 }) });
    expect(out).toMatchObject({ status: "SUCCESS", inserted: 3 });
  });

  it("connection refused → FAILED SOURCE_UNAVAILABLE", async () => {
    const dead = await startServer({});
    const url = dead.url;
    await dead.close();
    const out = await run(htmlSource(url), { http: testHttp({ maxRetries: 0 }) });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
  });

  it("timeout → FAILED SOURCE_UNAVAILABLE", async () => {
    server = await serve({ "/en/lottery/lao-lottery": () => new Promise(() => {}) });
    const out = await run(htmlSource(server.url), { http: testHttp({ timeoutMs: 150, maxRetries: 0 }) });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
    expect(out.errorMessage).toMatch(/Timeout/);
  });

  it("an oversized response is refused", async () => {
    server = await serve({ "/en/lottery/lao-lottery": (_q, res) => { res.setHeader("content-type", "text/html"); res.end("x".repeat(5000)); } });
    const out = await run(htmlSource(server.url), { http: testHttp({ maxBodyBytes: 1000, maxRetries: 0 }) });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
  });

  it("a failing run never touches data stored by an earlier successful run", async () => {
    server = await serve(twoPages());
    await run(htmlSource(server.url));
    const before = JSON.stringify(await store.findDraws());
    const okAt = await store.lastSuccessfulRunAt();
    server.routes.set("/en/lottery/lao-lottery", (_q, res) => { res.statusCode = 502; res.end(); });
    const out = await run(htmlSource(server.url), { http: testHttp({ maxRetries: 0 }) });
    expect(out.status).toBe("FAILED");
    expect(JSON.stringify(await store.findDraws())).toBe(before);
    expect(await store.lastSuccessfulRunAt()).toBe(okAt);
    expect((await store.listRuns(1))[0].status).toBe("FAILED");
  });
});

describe("ingestion — source responds but has no usable data", () => {
  it("no rows → EMPTY_RESPONSE", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([], { page: 1, total: 1 }) });
    expect(await run(htmlSource(server.url))).toMatchObject({ status: "FAILED", errorCode: "EMPTY_RESPONSE", inserted: 0 });
    expect(await store.countDraws()).toBe(0);
  });

  it("unrecognised markup → LAYOUT_CHANGED", async () => {
    server = await serve({ "/en/lottery/lao-lottery": "<html><body><h1>We are redesigning</h1></body></html>" });
    expect(await run(htmlSource(server.url))).toMatchObject({ status: "FAILED", errorCode: "LAYOUT_CHANGED" });
  });

  it("non-HTML content → PARSE_ERROR", async () => {
    server = await serve({ "/en/lottery/lao-lottery": (_q, res) => { res.setHeader("content-type", "application/json"); res.end("{}"); } });
    expect(await run(htmlSource(server.url))).toMatchObject({ status: "FAILED", errorCode: "PARSE_ERROR" });
  });

  it("layout change on a later page aborts the run before anything is written", async () => {
    server = await serve({
      "/en/lottery/lao-lottery": listPageHtml(WEEK, { page: 1, total: 2 }),
      "/en/lottery/lao-lottery?page=2": "<html><body>maintenance</body></html>",
    });
    expect(await run(htmlSource(server.url))).toMatchObject({ status: "FAILED", errorCode: "LAYOUT_CHANGED" });
    expect(await store.countDraws()).toBe(0);
  });
});

describe("ingestion — robots.txt", () => {
  it("honours Disallow and never requests the page", async () => {
    server = await serve({ "/robots.txt": (_q, res) => { res.setHeader("content-type", "text/plain"); res.end("User-agent: *\nDisallow: /en/lottery\n"); }, "/en/lottery/lao-lottery": listPageHtml(WEEK) });
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "FAILED", errorCode: "ROBOTS_DISALLOWED" });
    expect(server.hits).toEqual(["/robots.txt"]);
  });

  it("an unreachable robots.txt (5xx) is treated as 'do not crawl'", async () => {
    server = await serve({ "/robots.txt": (_q, res) => { res.statusCode = 500; res.end(); }, "/en/lottery/lao-lottery": listPageHtml(WEEK) });
    expect(await run(htmlSource(server.url))).toMatchObject({ status: "FAILED", errorCode: "ROBOTS_DISALLOWED" });
  });

  it("a missing robots.txt (404) allows crawling", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml(WEEK, { page: 1, total: 1 }) });
    expect(await run(htmlSource(server.url))).toMatchObject({ status: "SUCCESS" });
  });
});

describe("ingestion — source conflicts", () => {
  function csvFile(content: string) {
    const dir = mkdtempSync(join(tmpdir(), "lao-test-"));
    tmpDirs.push(dir);
    const path = join(dir, "second.csv");
    writeFileSync(path, content);
    return path;
  }
  const csvSource = (path: string, over: Record<string, unknown> = {}): SourceConfig =>
    parseSourcesConfig({ sources: [{ id: "second-csv", type: "csv", priority: 2, path, columns: { date: "date", result4: "four", result3: "three", result2: "two" }, ...over }] }).sources[0];

  it("keeps the higher-priority source, flags the date, and Data Health turns critical", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml(WEEK, { page: 1, total: 1 }) });
    const primary = htmlSource(server.url);
    const path = csvFile("date,four,three,two\n2026-10-02,4693,693,93\n2026-09-30,9999,999,99\n2026-09-28,4277,277,77\n");
    const secondary = csvSource(path);
    const all = [primary, secondary];

    const first = await run(primary, {}, [secondary]);
    expect(first.status).toBe("SUCCESS");
    const second = await run(secondary, {}, [primary]);
    expect(second).toMatchObject({ status: "PARTIAL", conflicts: 1 });

    const rows = await store.findDraws();
    const day = rows.find((r) => r.drawDate === "2026-09-30")!;
    expect(day).toMatchObject({ result4: "3653", source: "fixture-html", sourceCount: 2, hasConflict: true });
    expect(rows.find((r) => r.drawDate === "2026-10-02")).toMatchObject({ sourceCount: 2, hasConflict: false });

    const issue = (await store.listIssues({ kind: "SOURCE_CONFLICT" }))[0];
    expect(issue).toMatchObject({ severity: "ERROR", drawDate: "2026-09-30" });
    expect(issue.message).toContain("fixture-html=3653");
    expect(issue.message).toContain("second-csv=9999");

    const health = await getHealth(store, cfgOf(...all));
    expect(health.status).toBe("critical");
    expect(health.totals.recordsWithConflict).toBe(1);
  });

  it("a lower-priority source arriving first does not outrank the primary later", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([row("2026-10-02", "4693")], { page: 1, total: 1 }) });
    const primary = htmlSource(server.url);
    const secondary = csvSource(csvFile("date,four,three,two\n2026-10-02,1111,111,11\n"));
    await run(secondary, {}, [primary]);
    expect((await store.findDraws())[0]).toMatchObject({ result4: "1111", source: "second-csv" });
    await run(primary, {}, [secondary]);
    expect((await store.findDraws())[0]).toMatchObject({ result4: "4693", source: "fixture-html", hasConflict: true });
  });

  it("when the same source revises a published result it is applied but reported", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([row("2026-10-02", "4693")], { page: 1, total: 1 }) });
    const src = htmlSource(server.url);
    await run(src);
    server.routes.set("/en/lottery/lao-lottery", (_q, res) => { res.setHeader("content-type", "text/html"); res.end(listPageHtml([row("2026-10-02", "4699")], { page: 1, total: 1 })); });
    const out = await run(src);
    expect(out).toMatchObject({ status: "PARTIAL", updated: 1, conflicts: 1 });
    expect((await store.findDraws())[0].result4).toBe("4699");
    expect((await store.listIssues({ kind: "SOURCE_CONFLICT" }))[0]).toMatchObject({ severity: "WARNING" });
  });

  it("two different results for one date inside the same source drop that date", async () => {
    server = await serve({ "/en/lottery/lao-lottery": listPageHtml([row("2026-10-02", "4693"), row("2026-10-02", "1111"), row("2026-09-30", "3653")], { page: 1, total: 1 }) });
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "PARTIAL", conflicts: 1, inserted: 1 });
    expect((await store.findDraws()).map((d) => d.drawDate)).toEqual(["2026-09-30"]);
  });
});

describe("generic adapters", () => {
  it("CSV file source", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lao-test-"));
    tmpDirs.push(dir);
    const path = join(dir, "data.csv");
    writeFileSync(path, "Date,Four,Three,Two\r\n2026-10-02,4693,693,93\r\n2026-09-30,0653,653,53\r\n");
    const src = parseSourcesConfig({ sources: [{ id: "csv-file", type: "csv", path, columns: { date: "Date", result4: "Four", result3: "Three", result2: "Two" } }] }).sources[0];
    const out = await run(src);
    expect(out).toMatchObject({ status: "SUCCESS", inserted: 2, pagesFetched: 1 });
    expect((await store.findDraws())[0]).toMatchObject({ drawDate: "2026-09-30", result4: "0653", sourceUrl: `file:${path}` });
  });

  it("missing CSV file → FAILED SOURCE_UNAVAILABLE", async () => {
    const src = parseSourcesConfig({ sources: [{ id: "csv-file", type: "csv", path: join(tmpdir(), "definitely-missing.csv"), columns: { date: "d", result2: "r" } }] }).sources[0];
    expect(await run(src)).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
  });

  it("CSV whose header no longer matches the configuration → LAYOUT_CHANGED", async () => {
    server = await serve({ "/d.csv": (_q, res) => { res.setHeader("content-type", "text/csv"); res.end("when,a,b,c\n2026-10-02,1,2,3\n"); } });
    const src = parseSourcesConfig({ sources: [{ id: "csv-url", type: "csv", url: `${server.url}/d.csv`, columns: { date: "date", result4: "four", result3: "three", result2: "two" } }] }).sources[0];
    expect(await run(src)).toMatchObject({ status: "FAILED", errorCode: "LAYOUT_CHANGED" });
  });

  const jsonSrc = (url: string) =>
    parseSourcesConfig({
      sources: [{ id: "json-api", type: "json", url, recordsPath: "data", fields: { date: "d", result4: "r4", result3: "r3", result2: "r2" }, apiKey: { env: "TEST_API_KEY" } }],
    }).sources[0];

  it("JSON API source with an API key taken from the environment (never from config)", async () => {
    let auth = "";
    server = await serve({ "/api": (req, res) => { auth = String(req.headers.authorization); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ d: "2026-10-02", r4: "4693", r3: "693", r2: "93" }] })); } });
    const out = await run(jsonSrc(`${server.url}/api`), { env: { TEST_API_KEY: "s3cr3t-key" } });
    expect(out).toMatchObject({ status: "SUCCESS", inserted: 1 });
    expect(auth).toBe("Bearer s3cr3t-key");
    expect(JSON.stringify(await store.listRuns(5))).not.toContain("s3cr3t-key");
  });

  it("a missing API key is a CONFIG_ERROR that names the variable but nothing else", async () => {
    server = await serve({ "/api": (_q, res) => { res.end("{}"); } });
    const out = await run(jsonSrc(`${server.url}/api`), { env: {} });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "CONFIG_ERROR" });
    expect(out.errorMessage).toContain("TEST_API_KEY");
    expect(server.hits).toEqual([]);
  });

  it("an API that returns numbers without leading zeros is rejected rather than 'repaired'", async () => {
    server = await serve({ "/api": (_q, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ data: [{ d: "2026-09-28", r4: 702, r3: 702, r2: 2 }] })); } });
    const out = await run(jsonSrc(`${server.url}/api`), { env: { TEST_API_KEY: "k" } });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "NO_VALID_RECORDS" });
  });
});

describe("ingestAll", () => {
  it("runs sources independently: one failing source does not stop the others", async () => {
    const good = await serve({ "/en/lottery/lao-lottery": listPageHtml(WEEK, { page: 1, total: 1 }) });
    const bad = await serve({});
    const a = htmlSource(good.url, { id: "good", priority: 1 });
    const b = htmlSource(bad.url, { id: "bad", priority: 2 });
    const outs = await ingestAll({ store, config: cfgOf(a, b), http: testHttp({ maxRetries: 0 }), today: TODAY });
    expect(outs.map((o) => [o.sourceId, o.status])).toEqual([["good", "SUCCESS"], ["bad", "FAILED"]]);
    expect(await store.countDraws()).toBe(3);
  });

  it("can be limited to named sources and rejects unknown names", async () => {
    const s1 = await serve({ "/en/lottery/lao-lottery": listPageHtml(WEEK, { page: 1, total: 1 }) });
    const a = htmlSource(s1.url, { id: "one" });
    const b = htmlSource("http://127.0.0.1:1", { id: "two", priority: 2 });
    const outs = await ingestAll({ store, config: cfgOf(a, b), http: testHttp({ maxRetries: 0 }), today: TODAY, only: ["one"] });
    expect(outs.map((o) => o.sourceId)).toEqual(["one"]);
    await expect(ingestAll({ store, config: cfgOf(a), http: testHttp(), only: ["nope"] })).rejects.toBeInstanceOf(ConfigError);
  });

  it("skips disabled sources", async () => {
    const s1 = await serve({});
    const outs = await ingestAll({ store, config: cfgOf(htmlSource(s1.url, { enabled: false })), http: testHttp() });
    expect(outs).toEqual([]);
    expect(s1.hits).toEqual([]);
  });
});

describe("HTTP client — redirects and URL hygiene", () => {
  it("follows a same-site redirect", async () => {
    server = await serve({
      "/old": (_q, res) => { res.statusCode = 301; res.setHeader("location", "/en/lottery/lao-lottery"); res.end(); },
      "/en/lottery/lao-lottery": listPageHtml(WEEK, { page: 1, total: 1 }),
    });
    const out = await run(htmlSource(server.url, { listPath: "/old" }));
    expect(out).toMatchObject({ status: "SUCCESS", inserted: 3 });
  });

  it("refuses to follow a redirect to another host (SSRF guard) and never contacts it", async () => {
    const internal = await serve({ "/secret": "internal-only" });
    server = await serve({ "/en/lottery/lao-lottery": (_q, res) => { res.statusCode = 302; res.setHeader("location", `http://localhost:${new URL(internal.url).port}/secret`); res.end(); } });
    const out = await run(htmlSource(server.url));
    expect(out).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
    expect(out.errorMessage).toMatch(/Refused redirect/);
    expect(internal.hits).toEqual([]);
  });

  it("does not forward the API key on redirects to a different host", async () => {
    const other = await serve({ "/api": (req, res) => { res.end(String(req.headers.authorization)); } });
    server = await serve({ "/api": (_q, res) => { res.statusCode = 307; res.setHeader("location", `http://localhost:${new URL(other.url).port}/api`); res.end(); } });
    const src = parseSourcesConfig({ sources: [{ id: "json-redirect", type: "json", url: `${server.url}/api`, fields: { date: "d" }, apiKey: { env: "K" } }] }).sources[0];
    const out = await run(src, { env: { K: "key-123" } });
    expect(out.status).toBe("FAILED");
    expect(other.hits).toEqual([]);
  });

  it("stops redirect loops", async () => {
    server = await serve({ "/en/lottery/lao-lottery": (_q, res) => { res.statusCode = 302; res.setHeader("location", "/en/lottery/lao-lottery"); res.end(); } });
    const out = await run(htmlSource(server.url), { http: testHttp({ maxRetries: 0 }) });
    expect(out).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
    expect(out.errorMessage).toMatch(/Too many redirects/);
  });

  it("never stores credential-looking query parameters in provenance URLs", async () => {
    server = await serve({ "/d.csv": (_q, res) => { res.setHeader("content-type", "text/csv"); res.end("date,two\n2026-10-02,93\n"); } });
    const src = parseSourcesConfig({ sources: [{ id: "csv-url", type: "csv", url: `${server.url}/d.csv?token=abc123&api_key=zzz&page=2`, columns: { date: "date", result2: "two" } }] }).sources[0];
    const out = await run(src);
    expect(out.status).toBe("SUCCESS");
    const [d] = await store.findDraws();
    expect(d.sourceUrl).toContain("page=2");
    expect(d.sourceUrl).not.toMatch(/abc123|zzz|token|api_key/);
    expect(JSON.stringify(await store.listRuns(5))).not.toContain("abc123");
  });
});

describe("HTTP client behaviour", () => {
  it("throttles requests to the same origin", async () => {
    server = await serve(twoPages());
    const slept: number[] = [];
    await run(htmlSource(server.url), { http: testHttp({ delayMs: 60, sleep: async (ms) => { slept.push(ms); await new Promise((r) => setTimeout(r, Math.min(ms, 5))); } }) });
    expect(slept.filter((m) => m > 0).length).toBeGreaterThanOrEqual(2); // between robots → page 1 → page 2
  });

  it("backs off exponentially between retries", async () => {
    server = await serve({ "/en/lottery/lao-lottery": (_q, res) => { res.statusCode = 500; res.end(); } });
    const slept: number[] = [];
    await run(htmlSource(server.url), { http: testHttp({ maxRetries: 3, sleep: async (ms) => { slept.push(ms); } }) });
    const backoffs = slept.filter((m) => m >= 500);
    expect(backoffs).toHaveLength(3);
    expect(backoffs[1]).toBeGreaterThan(backoffs[0]);
    expect(backoffs[2]).toBeGreaterThan(backoffs[1]);
  });
});
