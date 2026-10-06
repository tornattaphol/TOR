import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as analytics } from "../../src/app/api/analytics/route";
import { GET as draws } from "../../src/app/api/draws/route";
import { GET as health } from "../../src/app/api/health/route";
import { GET as meta } from "../../src/app/api/meta/route";
import { GET as runs } from "../../src/app/api/ingest/runs/route";
import { GET as sources } from "../../src/app/api/sources/route";
import { GET as forecast } from "../../src/app/api/forecast/backtest/route";
import { GET as nextDraw } from "../../src/app/api/forecast/next-draw/route";
import { parseSourcesConfig } from "../../src/lib/config/sources";
import { REQUIRED_WARNING } from "../../src/lib/disclaimer";
import { call, freshApiEnv, seed, standardDraws } from "../helpers/api";
import { pseudoValues, scheduleDraws } from "../helpers/fixtures";

let env: ReturnType<typeof freshApiEnv>;
const cfg = parseSourcesConfig({
  sources: [
    { id: "main", type: "html-thelotterytoday", baseUrl: "https://example.test", listPath: "/x", description: "primary" },
    { id: "api", type: "json", priority: 2, enabled: false, url: "https://api.example.test/v1?token=abc", fields: { date: "d" }, apiKey: { env: "SECRET_API_KEY_NAME" } },
  ],
});

beforeEach(() => {
  env = freshApiEnv({}, cfg);
});
afterEach(() => env.restore());

describe("GET /api/draws", () => {
  it("returns paginated rows newest-first with provenance and meta", async () => {
    await seed(env.store, standardDraws(40));
    const r = await call(draws, "/api/draws?limit=5");
    expect(r.status).toBe(200);
    expect(r.json.data.total).toBe(40);
    expect(r.json.data.rows).toHaveLength(5);
    const dates = r.json.data.rows.map((x: any) => x.drawDate);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(r.json.data.rows[0]).toMatchObject({ source: "test", hasConflict: false });
    expect(r.json.data.rows[0]).toHaveProperty("sourceUrl");
    expect(r.json.data.rows[0]).toHaveProperty("fetchedAt");
    expect(r.json.meta.disclaimer).toBe(REQUIRED_WARNING);
    expect(r.json.meta.lastUpdated).toBeTruthy();
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("supports offset, ascending order and date filters", async () => {
    const d = standardDraws(30);
    await seed(env.store, d);
    const page2 = await call(draws, "/api/draws?limit=10&offset=10&order=asc");
    expect(page2.json.data.rows[0].drawDate).toBe(d[10].drawDate);
    const ranged = await call(draws, `/api/draws?from=${d[5].drawDate}&to=${d[9].drawDate}&order=asc`);
    expect(ranged.json.data.total).toBe(5);
    expect(ranged.json.data.rows.map((x: any) => x.drawDate)).toEqual(d.slice(5, 10).map((x) => x.drawDate));
  });

  it("rejects malformed parameters with a 400 and field-level details", async () => {
    for (const q of ["from=2026-13-40", "limit=0", "limit=9999", "offset=-1", "order=sideways", "from=2026-12-01&to=2026-01-01", "limit=abc"]) {
      const r = await call(draws, `/api/draws?${q}`);
      expect(r.status, q).toBe(400);
      expect(r.json.error.code).toBe("BAD_REQUEST");
      expect(Array.isArray(r.json.error.details)).toBe(true);
    }
  });

  it("treats injection-style input as invalid, never as query text", async () => {
    await seed(env.store, standardDraws(5));
    const r = await call(draws, `/api/draws?from=${encodeURIComponent("2026-01-01'; DROP TABLE draws;--")}`);
    expect(r.status).toBe(400);
    expect((await env.store.countDraws())).toBe(5);
  });

  it("returns an empty list (not an error) when there is no data", async () => {
    const r = await call(draws, "/api/draws");
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ rows: [], total: 0 });
  });
});

describe("GET /api/analytics", () => {
  it("returns the full historical bundle for the default selection (2-digit)", async () => {
    await seed(env.store, standardDraws(60));
    const r = await call(analytics, "/api/analytics");
    expect(r.status).toBe(200);
    const a = r.json.data;
    expect(a.selection).toMatchObject({ prize: "2", digits: 2, drawCount: 60 });
    expect(a.frequency.total).toBe(60);
    expect(a.digitDistribution.positions).toHaveLength(2);
    expect(a.windows.map((w: any) => w.size)).toEqual([10, 20, 50, 100]);
    expect(a.trend).toHaveLength(60);
    expect(r.json.meta).toMatchObject({ empty: false, totalDraws: 60, disclaimer: REQUIRED_WARNING });
    expect(r.json.meta.sources).toEqual([{ id: "test", draws: 60 }]);
  });

  it("applies prize, last-N and date-range filters", async () => {
    const d = standardDraws(60);
    await seed(env.store, d);
    const three = await call(analytics, "/api/analytics?prize=3&last=20");
    expect(three.json.data.selection).toMatchObject({ prize: "3", digits: 3, drawCount: 20, last: 20 });
    expect(three.json.data.digitDistribution.positions).toHaveLength(3);
    const four = await call(analytics, "/api/analytics?prize=4&last=all");
    expect(four.json.data.selection).toMatchObject({ digits: 4, drawCount: 60, last: null });
    const ranged = await call(analytics, `/api/analytics?from=${d[10].drawDate}&to=${d[19].drawDate}`);
    expect(ranged.json.data.selection).toMatchObject({ drawCount: 10, firstDate: d[10].drawDate, lastDate: d[19].drawDate });
    const both = await call(analytics, `/api/analytics?to=${d[29].drawDate}&last=10`);
    expect(both.json.data.selection.firstDate).toBe(d[20].drawDate);
  });

  it("changes the moving window", async () => {
    await seed(env.store, standardDraws(60));
    const r = await call(analytics, "/api/analytics?movingWindow=20");
    expect(r.json.data.moving.window).toBe(20);
    expect(r.json.data.moving.positions[0].points).toHaveLength(41);
  });

  it("returns an explicit empty result when no data matches", async () => {
    await seed(env.store, standardDraws(10));
    const r = await call(analytics, "/api/analytics?from=2099-01-01");
    expect(r.status).toBe(200);
    expect(r.json.meta.empty).toBe(true);
    expect(r.json.data.selection.drawCount).toBe(0);
  });

  it("returns empty (not 500) for an empty database", async () => {
    const r = await call(analytics, "/api/analytics");
    expect(r.status).toBe(200);
    expect(r.json.meta).toMatchObject({ empty: true, totalDraws: 0, lastUpdated: null });
  });

  it("validates every parameter", async () => {
    for (const q of ["prize=5", "prize=", "last=0", "last=-3", "last=banana", "last=99999", "movingWindow=1", "movingWindow=500", "from=yesterday", "to=2026-02-31"]) {
      const r = await call(analytics, `/api/analytics?${q}`);
      expect(r.status, q).toBe(400);
    }
  });

  it("never reflects raw user input in the response", async () => {
    const r = await call(analytics, `/api/analytics?prize=${encodeURIComponent("<script>alert(1)</script>")}`);
    expect(r.status).toBe(400);
    expect(r.text).not.toContain("<script>");
  });
});

describe("GET /api/meta", () => {
  it("summarises the dataset", async () => {
    const d = standardDraws(25);
    await seed(env.store, d);
    const r = await call(meta, "/api/meta");
    expect(r.json.data).toMatchObject({ totalDraws: 25, firstDate: d[0].drawDate, expectedWeekdays: [1, 3, 5] });
    expect(r.json.data.latestDraw.drawDate).toBe(d[24].drawDate);
    expect(r.json.data.lastUpdated).toBeTruthy();
  });
  it("has no latest draw for an empty database", async () => {
    const r = await call(meta, "/api/meta");
    expect(r.json.data).toMatchObject({ totalDraws: 0, latestDraw: null, lastUpdated: null });
  });
});

describe("GET /api/health", () => {
  it("reports the data-quality picture (records, anomalies, duplicates, latest date, missing dates)", async () => {
    const full = scheduleDraws("2025-10-13", pseudoValues(20, 2));
    const gap = full.filter((_, i) => i !== 7);
    await seed(env.store, gap);
    await env.store.saveIssues([{ kind: "DUPLICATE_IN_SOURCE", severity: "INFO", sourceId: "test", drawDate: full[3].drawDate, message: "dup" }], null);
    await env.store.saveIssues([{ kind: "INVALID_NUMBER_FORMAT", severity: "ERROR", sourceId: "test", drawDate: full[7].drawDate, message: "bad" }], null);
    const r = await call(health, "/api/health");
    expect(r.status).toBe(200);
    const h = r.json.data;
    expect(h.totals).toMatchObject({ records: 19, latestDate: full[19].drawDate });
    expect(h.schedule.missing).toEqual([{ date: full[7].drawDate, reason: "rejected_by_validation" }]);
    expect(h.issues).toMatchObject({ distinct: 2, duplicateRows: 1, invalidNumberFormat: 1 });
    expect(h.freshness.latestDrawDate).toBe(full[19].drawDate);
    expect(["warning", "critical"]).toContain(h.status);
  });
  it("reports 'empty' for an empty database", async () => {
    expect((await call(health, "/api/health")).json.data.status).toBe("empty");
  });
});

describe("GET /api/sources", () => {
  it("lists configured sources and last-run status without leaking secrets or full URLs", async () => {
    const run = await env.store.startRun("main", "test");
    await env.store.finishRun(run.id, { status: "FAILED", errorCode: "SOURCE_UNAVAILABLE", errorMessage: "HTTP 503 from example.test" });
    process.env.SECRET_API_KEY_NAME = "top-secret-value";
    const r = await call(sources, "/api/sources");
    delete process.env.SECRET_API_KEY_NAME;
    expect(r.status).toBe(200);
    const s = r.json.data.sources;
    expect(s.map((x: any) => x.id)).toEqual(["main", "api"]);
    expect(s[0]).toMatchObject({ enabled: true, host: "example.test", lastRun: { status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" } });
    expect(s[1]).toMatchObject({ enabled: false, requiresApiKey: true, lastRun: null });
    expect(r.text).not.toContain("top-secret-value");
    expect(r.text).not.toContain("SECRET_API_KEY_NAME");
    expect(r.text).not.toContain("token=abc");
  });
});

describe("GET /api/ingest/runs", () => {
  it("lists recent runs and validates the limit", async () => {
    for (let i = 0; i < 3; i++) await env.store.finishRun((await env.store.startRun("main", "test")).id, { status: "SUCCESS" });
    const r = await call(runs, "/api/ingest/runs?limit=2");
    expect(r.json.data.runs).toHaveLength(2);
    expect((await call(runs, "/api/ingest/runs?limit=0")).status).toBe(400);
  });
});

describe("GET /api/forecast/backtest", () => {
  it("returns model performance, uncertainty and the baseline comparison — never a future number", async () => {
    await seed(env.store, scheduleDraws("2025-10-13", pseudoValues(120, 4)));
    const r = await call(forecast, "/api/forecast/backtest?target=tens");
    expect(r.status).toBe(200);
    const rep = r.json.data;
    expect(rep.status).toBe("ok");
    expect(rep.targets).toHaveLength(1);
    expect(rep.targets[0].baseline).toMatchObject({ accuracy: 0.1 });
    expect(rep.targets[0].models.length).toBeGreaterThanOrEqual(7);
    expect(rep.targets[0].models[1]).toHaveProperty("logLossAdvantageCI");
    expect(rep.disclaimer).toContain(REQUIRED_WARNING);
    expect(r.json.meta).toMatchObject({ experimental: true });
    const lower = r.text.toLowerCase();
    for (const bad of ["nextdraw", "prediction", "recommend", "luckynumber", "hotnumber", "ranking"]) expect(lower).not.toContain(bad);
    expect(rep).not.toHaveProperty("nextDraw");
  });

  it("says so plainly when there is not enough data", async () => {
    await seed(env.store, standardDraws(40));
    const r = await call(forecast, "/api/forecast/backtest");
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ status: "insufficient_data", targets: [] });
    expect(r.json.data.message).toMatch(/ข้อมูลไม่เพียงพอ/);
  });

  it("validates parameters", async () => {
    for (const q of ["target=next", "minTrain=5", "minTrain=999", "window=3", "window=banana"]) {
      expect((await call(forecast, `/api/forecast/backtest?${q}`)).status, q).toBe(400);
    }
  });

  it("accepts a rolling window and a shorter history", async () => {
    await seed(env.store, scheduleDraws("2025-10-13", pseudoValues(120, 4)));
    const r = await call(forecast, "/api/forecast/backtest?target=units&window=60&minTrain=40");
    expect(r.json.data.config).toMatchObject({ trainWindow: 60, minTrain: 40 });
  });

  it("serves repeated identical requests from cache and recomputes when the data changes", async () => {
    await seed(env.store, scheduleDraws("2025-10-13", pseudoValues(110, 4)));
    const a = await call(forecast, "/api/forecast/backtest?target=tens");
    const b = await call(forecast, "/api/forecast/backtest?target=tens");
    expect(b.json.data).toEqual(a.json.data);
    await seed(env.store, scheduleDraws("2027-01-04", ["1357"]), { successfulRun: false });
    const c = await call(forecast, "/api/forecast/backtest?target=tens");
    expect(c.json.data.dataRange.draws).toBe(111);
  });
});

describe("GET /api/forecast/next-draw", () => {
  it("ranks every value per model, trimmed to `top`, always with the model's backtest verdict", async () => {
    await seed(env.store, scheduleDraws("2025-10-13", pseudoValues(120, 4)));
    const r = await call(nextDraw, "/api/forecast/next-draw?target=tens&top=4");
    expect(r.status).toBe(200);
    expect(r.json.meta).toMatchObject({ experimental: true });
    expect(r.json.meta.disclaimer).toBe(REQUIRED_WARNING);
    const nd = r.json.data.nextDraw;
    expect(nd.targets).toHaveLength(1);
    const t = nd.targets[0];
    expect(t).toMatchObject({ target: "tens", classes: 10, shortlistSize: 3 });
    expect(t.models.length).toBeGreaterThanOrEqual(6);
    for (const m of t.models) {
      expect(m).toHaveProperty("verdict");
      if (m.status === "ok") {
        expect(m.ranking).toHaveLength(4);
        expect(m.ranking[0]).toMatchObject({ rank: 1 });
        for (const row of m.ranking) expect(Object.keys(row).sort()).toEqual(["interval", "label", "probability", "rank", "shortlistShare", "tied", "value", "vsRandom"]);
      }
    }
    // the headline model is one of the listed models
    expect(t.models.map((m: any) => m.modelId)).toContain(t.recommendedModelId);
    expect(nd.latestDrawDate).toBe(r.json.data.dataRange.to);
    expect(nd.nextScheduledDate > nd.latestDrawDate).toBe(true);
  });

  it("returns the complete ranking by default size 10 and up to 100 on request", async () => {
    await seed(env.store, scheduleDraws("2025-10-13", pseudoValues(120, 4)));
    const a = await call(nextDraw, "/api/forecast/next-draw?target=last2");
    const freq = (r: any) => r.json.data.nextDraw.targets[0].models.find((m: any) => m.modelId === "frequency");
    expect(freq(a).ranking).toHaveLength(10);
    const b = await call(nextDraw, "/api/forecast/next-draw?target=last2&top=100");
    expect(freq(b).ranking).toHaveLength(100);
    expect(new Set(freq(b).ranking.map((x: any) => x.value)).size).toBe(100);
    // the larger request must not change what the model says about the top of the list
    expect(freq(b).ranking.slice(0, 10)).toEqual(freq(a).ranking);
  });

  it("states insufficient data instead of fabricating a ranking", async () => {
    await seed(env.store, standardDraws(40));
    const r = await call(nextDraw, "/api/forecast/next-draw");
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ status: "insufficient_data", nextDraw: null });
    expect(r.json.data.message).toMatch(/ข้อมูลไม่เพียงพอ/);
    const empty = await call(nextDraw, "/api/forecast/next-draw");
    expect(empty.json.data.nextDraw).toBeNull();
  });

  it("returns no ranking for an empty database", async () => {
    const r = await call(nextDraw, "/api/forecast/next-draw");
    expect(r.status).toBe(200);
    expect(r.json.data.nextDraw).toBeNull();
  });

  it("validates parameters", async () => {
    for (const q of ["top=0", "top=101", "top=abc", "top=1.5", "target=next", "minTrain=5", "window=banana"]) {
      expect((await call(nextDraw, `/api/forecast/next-draw?${q}`)).status, q).toBe(400);
    }
  });

  it("is deterministic and shares the cache with the backtest request", async () => {
    await seed(env.store, scheduleDraws("2025-10-13", pseudoValues(110, 4)));
    const a = await call(nextDraw, "/api/forecast/next-draw?target=units");
    const b = await call(nextDraw, "/api/forecast/next-draw?target=units");
    expect(b.json.data).toEqual(a.json.data);
    // the verdict attached to each ranking is the same one the backtest endpoint reports
    const bt = await call(forecast, "/api/forecast/backtest?target=units");
    for (const m of a.json.data.nextDraw.targets[0].models) {
      const same = bt.json.data.targets[0].models.find((x: any) => x.modelId === m.modelId);
      expect(m.verdict).toBe(same.verdict);
    }
  });
});
