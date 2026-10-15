import { afterEach, describe, expect, it } from "vitest";
import { GET as draws } from "../../src/app/api/draws/route";
import { GET as analytics } from "../../src/app/api/analytics/route";
import { GET as forecast } from "../../src/app/api/forecast/backtest/route";
import { POST as ingest } from "../../src/app/api/ingest/route";
import nextConfig from "../../next.config";
import { parseSourcesConfig } from "../../src/lib/config/sources";
import { call, freshApiEnv, seed, standardDraws } from "../helpers/api";
import { htmlSource, listPageHtml, robotsAllowAll, startServer, type TestServer } from "../helpers/fixtures";
import { setStore } from "../../src/lib/db";
import type { DrawStore } from "../../src/lib/db/store";
import { MemoryDrawStore } from "../../src/lib/db/memory-store";

let env: ReturnType<typeof freshApiEnv> | undefined;
const servers: TestServer[] = [];
afterEach(async () => {
  env?.restore();
  env = undefined;
  while (servers.length) await servers.pop()!.close();
});

const TOKEN = "unit-test-token-0123456789";
const auth = { authorization: `Bearer ${TOKEN}` };

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the per-minute budget is spent, per client", async () => {
    env = freshApiEnv({ RATE_LIMIT_PER_MINUTE: "3" });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call(draws, "/api/draws", { headers: { "x-forwarded-for": "203.0.113.7" } })).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    const blocked = await call(draws, "/api/draws", { headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(blocked.json.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // another client is unaffected
    expect((await call(draws, "/api/draws", { headers: { "x-forwarded-for": "198.51.100.9" } })).status).toBe(200);
  });

  it("applies a stricter budget to the expensive forecast endpoint", async () => {
    env = freshApiEnv({ RATE_LIMIT_HEAVY_PER_MINUTE: "2" });
    await seed(env.store, standardDraws(10));
    const s = [];
    for (let i = 0; i < 4; i++) s.push((await call(forecast, "/api/forecast/backtest")).status);
    expect(s).toEqual([200, 200, 429, 429]);
    expect((await call(analytics, "/api/analytics")).status).toBe(200); // other endpoints keep their own budget
  });
});

describe("error handling does not leak internals", () => {
  const failing = (err: Error): DrawStore => {
    const s = new MemoryDrawStore();
    const boom = async () => {
      throw err;
    };
    return Object.assign(s, { findDraws: boom, countDraws: boom, getLatestDraw: boom, lastSuccessfulRunAt: boom });
  };

  it("database unreachable → 503 DATABASE_UNAVAILABLE with a safe message", async () => {
    env = freshApiEnv();
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432 (postgresql://app:hunter2@db.internal/lao)"), { code: "ECONNREFUSED" });
    setStore(failing(err));
    const r = await call(draws, "/api/draws");
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(r.text).not.toContain("hunter2");
    expect(r.text).not.toContain("postgresql://");
    expect(r.headers.get("retry-after")).toBeTruthy();
  });

  it("DATABASE_URL not configured → 503, not a crash", async () => {
    env = freshApiEnv();
    setStore(failing(new Error("DATABASE_URL is not set. Copy .env.example to .env and configure it.")));
    expect((await call(draws, "/api/draws")).status).toBe(503);
  });

  it("unexpected errors → generic 500 without stack traces, SQL or credentials", async () => {
    env = freshApiEnv();
    setStore(failing(new Error('query failed: select * from draws where password="s3cret" at /srv/app/node_modules/x.js:10:5')));
    const r = await call(draws, "/api/draws");
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe("INTERNAL_ERROR");
    expect(r.text).not.toContain("s3cret");
    expect(r.text).not.toContain("select");
    expect(r.text).not.toContain("node_modules");
  });
});

describe("POST /api/ingest — authentication & input validation", () => {
  it("is disabled (503) until INGEST_TOKEN is configured", async () => {
    env = freshApiEnv();
    const r = await call(ingest, "/api/ingest", { method: "POST", headers: auth });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("DISABLED");
  });

  it("rejects missing, malformed and wrong tokens with 401", async () => {
    env = freshApiEnv({ INGEST_TOKEN: TOKEN });
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer wrong-token-0123456789" }, { authorization: TOKEN }, { authorization: "Basic abc" }, { authorization: `Bearer ${TOKEN} ` + "x" }]) {
      const r = await call(ingest, "/api/ingest", { method: "POST", headers });
      expect(r.status, JSON.stringify(headers)).toBe(401);
      expect(r.text).not.toContain(TOKEN);
    }
  });

  it("rejects a too-short configured token at startup validation", async () => {
    env = freshApiEnv({ INGEST_TOKEN: "short" });
    const r = await call(ingest, "/api/ingest", { method: "POST", headers: { authorization: "Bearer short" } });
    expect(r.status).toBe(500); // invalid configuration is a server error, never an open door
    expect(r.text).not.toContain("short");
  });

  it("validates the body strictly", async () => {
    env = freshApiEnv({ INGEST_TOKEN: TOKEN }, parseSourcesConfig({ sources: [htmlSource("https://example.test") as never] }));
    for (const body of ['{"source":"Bad Id!"}', '{"full":"yes"}', '{"maxPages":0}', '{"maxPages":1000}', '{"unknown":1}', "not json", '["x"]']) {
      const r = await call(ingest, "/api/ingest", { method: "POST", headers: auth, body });
      expect([400], body).toContain(r.status);
    }
    const huge = await call(ingest, "/api/ingest", { method: "POST", headers: auth, body: JSON.stringify({ pad: "x".repeat(20_000) }) });
    expect(huge.status).toBe(413);
  });

  it("rate-limits ingestion attempts (including failed authentication)", async () => {
    env = freshApiEnv({ INGEST_TOKEN: TOKEN, RATE_LIMIT_INGEST_PER_HOUR: "2" });
    const s = [];
    for (let i = 0; i < 4; i++) s.push((await call(ingest, "/api/ingest", { method: "POST", headers: { authorization: "Bearer nope-nope-nope-nope" } })).status);
    expect(s).toEqual([401, 401, 429, 429]);
  });
});

describe("POST /api/ingest — running a refresh", () => {
  async function setup(pages: Record<string, unknown>) {
    const server = await startServer(pages as never);
    servers.push(server);
    const cfg = parseSourcesConfig({ sources: [{ ...htmlSource(server.url), maxPages: 5 }] });
    env = freshApiEnv({ INGEST_TOKEN: TOKEN, INGEST_REQUEST_DELAY_MS: "0", INGEST_TIMEOUT_MS: "2000", INGEST_MAX_RETRIES: "0" }, cfg);
    return server;
  }
  const rows = [
    { date: "2026-09-30", r4: "3653", r3: "653", r2: "53" },
    { date: "2026-09-28", r4: "4277", r3: "277", r2: "77" },
  ];

  it("authenticated call ingests and the data becomes visible through the read API", async () => {
    await setup({ "/robots.txt": robotsAllowAll, "/en/lottery/lao-lottery": listPageHtml(rows, { page: 1, total: 1 }) });
    const r = await call(ingest, "/api/ingest", { method: "POST", headers: auth, body: JSON.stringify({ source: "fixture-html" }) });
    expect(r.status).toBe(200);
    expect(r.json.data.outcomes[0]).toMatchObject({ sourceId: "fixture-html", status: "SUCCESS", inserted: 2, errorCode: null });
    const list = await call(draws, "/api/draws");
    expect(list.json.data.rows.map((x: any) => x.result4)).toEqual(["3653", "4277"]);
    expect(list.json.data.rows[0].sourceUrl).toContain("/en/lottery/lao-lottery/2026-09-30");
  });

  it("an unreachable source yields a clear FAILED outcome, not a server error, and no data", async () => {
    await setup({ "/robots.txt": robotsAllowAll, "/en/lottery/lao-lottery": (_q: unknown, res: { statusCode: number; end: () => void }) => { res.statusCode = 503; res.end(); } });
    const r = await call(ingest, "/api/ingest", { method: "POST", headers: auth });
    expect(r.status).toBe(200);
    expect(r.json.data.outcomes[0]).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE", inserted: 0 });
    expect((await call(draws, "/api/draws")).json.data.total).toBe(0);
  });

  it("an unknown source id is a client error", async () => {
    await setup({ "/robots.txt": robotsAllowAll });
    const r = await call(ingest, "/api/ingest", { method: "POST", headers: auth, body: JSON.stringify({ source: "does-not-exist" }) });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("UNKNOWN_SOURCE");
  });

  it("refuses to start a second run while one is in progress (409)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await setup({
      "/robots.txt": robotsAllowAll,
      "/en/lottery/lao-lottery": async (_q: unknown, res: { setHeader(k: string, v: string): void; end(b: string): void }) => {
        await gate;
        res.setHeader("content-type", "text/html");
        res.end(listPageHtml(rows, { page: 1, total: 1 }));
      },
    });
    const first = call(ingest, "/api/ingest", { method: "POST", headers: auth });
    await new Promise((r) => setTimeout(r, 150));
    const second = await call(ingest, "/api/ingest", { method: "POST", headers: auth });
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    // and the lock is released afterwards
    const third = await call(ingest, "/api/ingest", { method: "POST", headers: auth });
    expect(third.status).toBe(200);
  });
});

describe("transport security headers", () => {
  it("next.config sets CSP, frame and sniffing protections on every route", async () => {
    const groups = await nextConfig.headers!();
    const all = groups.find((g) => g.source === "/:path*")!.headers;
    const get = (k: string) => all.find((h) => h.key === k)?.value ?? "";
    expect(get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("Referrer-Policy")).toBeTruthy();
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
