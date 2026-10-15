import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as analyticsRoute } from "../../src/app/api/analytics/route";
import { GET as drawsRoute } from "../../src/app/api/draws/route";
import { GET as healthRoute } from "../../src/app/api/health/route";
import { buildAnalytics } from "../../src/lib/analytics";
import { setStore } from "../../src/lib/db";
import { MemoryDrawStore } from "../../src/lib/db/memory-store";
import { createPrisma } from "../../src/lib/db/prisma";
import { PrismaDrawStore } from "../../src/lib/db/prisma-store";
import { ingestAll, ingestSource } from "../../src/lib/ingestion/pipeline";
import type { SourcesConfig } from "../../src/lib/config/sources";
import { call, freshApiEnv } from "../helpers/api";
import { htmlSource, listPageHtml, pseudoValues, robotsAllowAll, scheduleDraws, startServer, testHttp, type TestServer } from "../helpers/fixtures";
import { rec, runStoreContract } from "../helpers/store-contract";

type Prisma = ReturnType<typeof createPrisma>;

let pg: EmbeddedPostgres;
let prisma: Prisma;
let dataDir: string;
let connectionString: string;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function truncate() {
  await prisma.$executeRawUnsafe("TRUNCATE TABLE draws, source_records, data_issues, ingestion_runs RESTART IDENTITY CASCADE");
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "lao-pg-"));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"] });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("lao_test");
  connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/lao_test?schema=public`;
  // the REAL migrations, exactly as production would apply them
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: connectionString }, stdio: "pipe", cwd: process.cwd() });
  prisma = createPrisma(connectionString);
});

afterAll(async () => {
  await prisma?.$disconnect();
  await pg?.stop();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

beforeEach(async () => {
  await truncate();
});

/* ───────────── same behavioural contract as the in-memory store ───────────── */

runStoreContract("PrismaDrawStore on PostgreSQL", async () => {
  await truncate();
  return new PrismaDrawStore(prisma);
});

/* ───────────── schema & database-level guarantees ───────────── */

describe("PostgreSQL schema", () => {
  it("uses snake_case columns named as in the specification", async () => {
    const cols = await prisma.$queryRawUnsafe<{ column_name: string }[]>("SELECT column_name FROM information_schema.columns WHERE table_name = 'draws' ORDER BY ordinal_position");
    const names = cols.map((c) => c.column_name);
    for (const required of ["draw_date", "draw_id", "result_2_digit", "result_3_digit", "result_4_digit", "source", "source_url", "fetched_at"]) {
      expect(names, required).toContain(required);
    }
  });

  it("enforces one draw per date at the database level", async () => {
    const store = new PrismaDrawStore(prisma);
    await store.ingestBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records: [rec("2026-01-05", "1234")] });
    await expect(
      prisma.draw.create({ data: { lotteryCode: "LAO_DEV", drawDate: new Date("2026-01-05T00:00:00Z"), drawId: "other", result2: "34", source: "x", sourceUrl: "u", fetchedAt: new Date() } }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.draw.create({ data: { lotteryCode: "LAO_DEV", drawDate: new Date("2026-01-07T00:00:00Z"), drawId: "lao_dev_20260105", result2: "34", source: "x", sourceUrl: "u", fetchedAt: new Date() } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects over-long digit strings (VARCHAR limits) instead of truncating them", async () => {
    await expect(
      prisma.draw.create({ data: { lotteryCode: "LAO_DEV", drawDate: new Date("2026-01-09T00:00:00Z"), drawId: "x", result2: "123", source: "x", sourceUrl: "u", fetchedAt: new Date() } }),
    ).rejects.toThrow();
  });

  it("stores the calendar date without time-zone drift and keeps leading zeros", async () => {
    const store = new PrismaDrawStore(prisma);
    await store.ingestBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records: [rec("2026-10-02", "0007")] });
    const raw = await prisma.$queryRawUnsafe<{ d: string; r4: string }[]>("SELECT draw_date::text AS d, result_4_digit AS r4 FROM draws");
    expect(raw).toEqual([{ d: "2026-10-02", r4: "0007" }]);
    expect((await store.findDraws())[0].drawDate).toBe("2026-10-02");
  });

  it("stores Thai text and JSON extras (UTF-8 database)", async () => {
    const store = new PrismaDrawStore(prisma);
    await store.saveIssues([{ kind: "UNEXPECTED_WEEKDAY", severity: "WARNING", sourceId: "a", drawDate: "2026-10-01", message: "ผลวันพฤหัสบดี ไม่ใช่วันออกรางวัล", details: { ที่มา: "ทดสอบ", n: [1, 2] } }], null);
    const [i] = await store.listIssues();
    expect(i.message).toBe("ผลวันพฤหัสบดี ไม่ใช่วันออกรางวัล");
    expect(i.details).toEqual({ ที่มา: "ทดสอบ", n: [1, 2] });
  });
});

describe("PostgreSQL store — safety", () => {
  it("a failing batch rolls back completely (no partial writes)", async () => {
    const store = new PrismaDrawStore(prisma);
    const bad = rec("2026-01-09", "1234", { result2: "999" }); // violates VARCHAR(2) → whole transaction must abort
    await expect(store.ingestBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records: [rec("2026-01-05", "1234"), rec("2026-01-07", "5678"), bad] })).rejects.toThrow();
    expect(await store.countDraws()).toBe(0);
    expect(await prisma.sourceRecord.count()).toBe(0);
  });

  it("stores hostile strings as data (parameterised queries, no injection)", async () => {
    const store = new PrismaDrawStore(prisma);
    const evil = "'; DROP TABLE draws; --";
    await store.saveIssues([{ kind: "INVALID_NUMBER_FORMAT", severity: "ERROR", sourceId: evil, drawDate: null, message: evil, details: { evil } }], null);
    await store.ingestBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records: [rec("2026-01-05", "1234", { sourceUrl: evil })] });
    expect((await store.listIssues())[0].message).toBe(evil);
    expect((await store.findDraws())[0].sourceUrl).toBe(evil);
    expect(await store.countDraws()).toBe(1); // table still exists and holds the row
  });

  it("handles a realistic backfill volume quickly and idempotently", async () => {
    const store = new PrismaDrawStore(prisma);
    const draws = scheduleDraws("2020-01-01", pseudoValues(1500, 99));
    const records = draws.map((d) => rec(d.drawDate, d.result4 as string));
    const t0 = Date.now();
    const first = await store.ingestBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records });
    const again = await store.ingestBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records });
    expect(first.inserted).toBe(1500);
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 1500 });
    expect(await store.countDraws()).toBe(1500);
    expect(Date.now() - t0).toBeLessThan(60_000);
  });
});

/* ───────────── pipeline end-to-end against the real database ───────────── */

describe("ingestion pipeline on PostgreSQL", () => {
  const servers: TestServer[] = [];
  afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
  });
  const rows = [
    { date: "2026-10-02", r4: "4693", r3: "693", r2: "93" },
    { date: "2026-09-30", r4: "3653", r3: "653", r2: "53" },
    { date: "2026-09-28", r4: "4277", r3: "277", r2: "77" },
  ];
  const cfg = (...sources: ReturnType<typeof htmlSource>[]): SourcesConfig => ({ lotteryCode: "LAO_DEV", sources });

  it("valid → stored with provenance; re-run is idempotent; runs and timestamps are recorded", async () => {
    const server = await startServer({ "/robots.txt": robotsAllowAll, "/en/lottery/lao-lottery": listPageHtml(rows, { page: 1, total: 1 }) });
    servers.push(server);
    const store = new PrismaDrawStore(prisma);
    const src = htmlSource(server.url);
    const deps = { store, config: cfg(src), http: testHttp(), today: "2026-10-04", trigger: "integration" };

    expect(await ingestSource(src, deps)).toMatchObject({ status: "SUCCESS", inserted: 3 });
    expect(await ingestSource(src, deps)).toMatchObject({ status: "SUCCESS", inserted: 0, unchanged: 3 });

    const stored = await store.findDraws({ order: "desc" });
    expect(stored[0]).toMatchObject({ drawDate: "2026-10-02", result4: "4693", source: "fixture-html", sourceUrl: `${server.url}/en/lottery/lao-lottery/2026-10-02` });
    expect(await prisma.sourceRecord.count()).toBe(3);
    const runs = await store.listRuns(5);
    expect(runs).toHaveLength(2);
    expect(runs[0].trigger).toBe("integration");
    expect(await store.lastSuccessfulRunAt()).not.toBeNull();
  });

  it("source unavailable → FAILED run recorded, existing data untouched", async () => {
    const server = await startServer({ "/robots.txt": robotsAllowAll, "/en/lottery/lao-lottery": listPageHtml(rows, { page: 1, total: 1 }) });
    servers.push(server);
    const store = new PrismaDrawStore(prisma);
    const src = htmlSource(server.url);
    const deps = { store, config: cfg(src), http: testHttp({ maxRetries: 0 }), today: "2026-10-04" };
    await ingestSource(src, deps);
    server.routes.set("/en/lottery/lao-lottery", (_q, res) => { res.statusCode = 503; res.end(); });
    const failed = await ingestSource(src, deps);
    expect(failed).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
    expect(await store.countDraws()).toBe(3);
    expect((await store.listRuns(1))[0]).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE", finishedAt: expect.any(String) });
  });

  it("malformed + duplicate + weekday-violating rows produce de-duplicated issues in the database", async () => {
    const page = listPageHtml(
      [rows[0], rows[0], { date: "2026-09-30", r4: "36x3", r3: "6x3", r2: "x3" }, { date: "2026-10-01", r4: "5609", r3: "609", r2: "09" }, rows[2]],
      { page: 1, total: 1 },
    );
    const server = await startServer({ "/en/lottery/lao-lottery": page });
    servers.push(server);
    const store = new PrismaDrawStore(prisma);
    const src = htmlSource(server.url);
    const deps = { store, config: cfg(src), http: testHttp(), today: "2026-10-04" };
    const a = await ingestSource(src, deps);
    expect(a).toMatchObject({ status: "PARTIAL", inserted: 2, invalid: 1, quarantined: 1, duplicates: 1 });
    await ingestSource(src, deps);
    const counts = await store.issueCounts();
    expect(counts).toEqual({ DUPLICATE_IN_SOURCE: 1, INVALID_NUMBER_FORMAT: 1, UNEXPECTED_WEEKDAY: 1 });
    expect((await store.listIssues({ kind: "INVALID_NUMBER_FORMAT" }))[0].occurrences).toBe(2);
    expect(await store.countDraws()).toBe(2);
  });

  it("source conflict between two sources is flagged in the canonical draw", async () => {
    const s1 = await startServer({ "/en/lottery/lao-lottery": listPageHtml(rows, { page: 1, total: 1 }) });
    const s2 = await startServer({ "/en/lottery/lao-lottery": listPageHtml([{ ...rows[1], r4: "9653", r3: "653", r2: "53" }], { page: 1, total: 1 }) });
    servers.push(s1, s2);
    const store = new PrismaDrawStore(prisma);
    const a = htmlSource(s1.url, { id: "alpha", priority: 1 });
    const b = htmlSource(s2.url, { id: "beta", priority: 2 });
    const outs = await ingestAll({ store, config: cfg(a, b), http: testHttp(), today: "2026-10-04" });
    expect(outs.map((o) => o.status)).toEqual(["SUCCESS", "PARTIAL"]);
    const day = (await store.findDraws()).find((d) => d.drawDate === "2026-09-30");
    expect(day).toMatchObject({ result4: "3653", source: "alpha", sourceCount: 2, hasConflict: true });
    expect((await store.listIssues({ kind: "SOURCE_CONFLICT" }))[0].severity).toBe("ERROR");
  });
});

/* ───────────── API on top of the real database ───────────── */

describe("REST API backed by PostgreSQL", () => {
  let env: ReturnType<typeof freshApiEnv>;
  beforeEach(() => {
    env = freshApiEnv();
  });
  afterEach(() => {
    env.restore();
    setStore(null);
  });

  async function seedDb(n = 80) {
    const store = new PrismaDrawStore(prisma);
    const draws = scheduleDraws("2025-10-13", pseudoValues(n, 12));
    await store.ingestBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records: draws.map((d) => rec(d.drawDate, d.result4 as string)) });
    const run = await store.startRun("a", "test");
    await store.finishRun(run.id, { status: "SUCCESS" });
    setStore(store);
    return { store, draws };
  }

  it("serves draws, analytics and health from the database", async () => {
    const { draws } = await seedDb(80);
    const list = await call(drawsRoute, "/api/draws?limit=3");
    expect(list.status).toBe(200);
    expect(list.json.data.total).toBe(80);
    expect(list.json.data.rows[0].drawDate).toBe(draws[79].drawDate);

    const a = await call(analyticsRoute, "/api/analytics?prize=2&last=50");
    expect(a.json.data.selection.drawCount).toBe(50);

    const h = await call(healthRoute, "/api/health");
    expect(h.json.data.totals.records).toBe(80);
    expect(h.json.data.freshness.lastSuccessfulRunAt).toBeTruthy();
  });

  it("analytics from PostgreSQL are identical to analytics computed from the same data in memory", async () => {
    const { store, draws } = await seedDb(90);
    const mem = new MemoryDrawStore();
    await mem.ingestBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records: draws.map((d) => rec(d.drawDate, d.result4 as string)) });
    for (const prize of ["2", "3", "4"] as const) {
      const fromDb = buildAnalytics(await store.findDraws(), { prize, last: 60 });
      const fromMem = buildAnalytics(await mem.findDraws(), { prize, last: 60 });
      expect(fromDb).toEqual(fromMem);
    }
  });

  it("an empty database yields an empty (not failing) API response", async () => {
    setStore(new PrismaDrawStore(prisma));
    const a = await call(analyticsRoute, "/api/analytics");
    expect(a.status).toBe(200);
    expect(a.json.meta.empty).toBe(true);
  });
});
