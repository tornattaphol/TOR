import { describe, expect, it } from "vitest";
import { ConfigError, enabledSources, parseSourcesConfig } from "../../src/lib/config/sources";
import { getEnv } from "../../src/lib/config/env";
import { conflicts, reconcile, sameValues, type Observation } from "../../src/lib/ingestion/reconcile";
import { RobotsPolicy } from "../../src/lib/http/robots";
import { RateLimiter } from "../../src/lib/http/rate-limit";
import { planBatch } from "../../src/lib/db/plan";
import { createLogger } from "../../src/lib/logger";
import { rec } from "../helpers/store-contract";

describe("environment config", () => {
  it("applies safe defaults", () => {
    const e = getEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(e.INGEST_REQUEST_DELAY_MS).toBe(1500);
    expect(e.SOURCES_CONFIG_PATH).toBe("config/sources.json");
    expect(e.INGEST_USER_AGENT).toMatch(/robots/i);
    expect(e.DATABASE_URL).toBeUndefined();
  });
  it("treats empty variables (FOO=) as unset rather than as invalid values", () => {
    const e = getEnv({ NODE_ENV: "test", INGEST_TOKEN: "", DATABASE_URL: "", SOURCES_ENABLED: "", INGEST_REQUEST_DELAY_MS: "" } as NodeJS.ProcessEnv);
    expect(e.INGEST_TOKEN).toBeUndefined();
    expect(e.DATABASE_URL).toBeUndefined();
    expect(e.INGEST_REQUEST_DELAY_MS).toBe(1500);
  });
  it("coerces numbers and rejects invalid values with a readable message that never echoes secrets", () => {
    expect(getEnv({ NODE_ENV: "test", INGEST_REQUEST_DELAY_MS: "250" } as NodeJS.ProcessEnv).INGEST_REQUEST_DELAY_MS).toBe(250);
    expect(() => getEnv({ NODE_ENV: "test", INGEST_TIMEOUT_MS: "5" } as NodeJS.ProcessEnv)).toThrow(/INGEST_TIMEOUT_MS/);
    try {
      getEnv({ NODE_ENV: "test", INGEST_TOKEN: "short-secret" } as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/INGEST_TOKEN/);
      expect((e as Error).message).not.toContain("short-secret");
    }
  });
});

describe("sources config", () => {
  const html = { id: "main", type: "html-thelotterytoday", baseUrl: "https://example.test", listPath: "/en/lottery/lao-lottery" };
  it("parses and applies defaults", () => {
    const c = parseSourcesConfig({ sources: [html] });
    expect(c.lotteryCode).toBe("LAO_DEV");
    expect(c.sources[0]).toMatchObject({ enabled: true, priority: 10, expectedWeekdays: [1, 3, 5], maxPages: 20 });
  });
  it("rejects bad ids, non-http URLs, empty lists and unknown types", () => {
    expect(() => parseSourcesConfig({ sources: [{ ...html, id: "Bad Id" }] })).toThrow(ConfigError);
    expect(() => parseSourcesConfig({ sources: [{ ...html, baseUrl: "file:///etc/passwd" }] })).toThrow(ConfigError);
    expect(() => parseSourcesConfig({ sources: [] })).toThrow(ConfigError);
    expect(() => parseSourcesConfig({ sources: [{ id: "x1", type: "ftp" }] })).toThrow(ConfigError);
    expect(() => parseSourcesConfig({ sources: [{ ...html, expectedWeekdays: [7] }] })).toThrow(ConfigError);
  });
  it("rejects duplicate ids", () => {
    expect(() => parseSourcesConfig({ sources: [html, html] })).toThrow(/Duplicate source id/);
  });
  it("requires exactly one of url/path for CSV sources", () => {
    const csv = { id: "c1", type: "csv", columns: { date: "d", result2: "r" } };
    expect(() => parseSourcesConfig({ sources: [csv] })).toThrow(/exactly one of url or path/);
    expect(() => parseSourcesConfig({ sources: [{ ...csv, url: "https://example.test/a.csv", path: "a.csv" }] })).toThrow(/exactly one/);
    expect(parseSourcesConfig({ sources: [{ ...csv, path: "data/a.csv" }] }).sources).toHaveLength(1);
  });
  it("API keys are referenced by env-var name only", () => {
    const j = { id: "j1", type: "json", url: "https://example.test/api", fields: { date: "d" }, apiKey: { env: "my_key" } };
    expect(() => parseSourcesConfig({ sources: [j] })).toThrow(ConfigError);
    expect(parseSourcesConfig({ sources: [{ ...j, apiKey: { env: "MY_KEY" } }] }).sources).toHaveLength(1);
  });
  it("SOURCES_ENABLED overrides the enabled flags and validates names", () => {
    const cfg = { sources: [html, { ...html, id: "second", priority: 2 }] };
    const only = parseSourcesConfig(cfg, "second");
    expect(enabledSources(only).map((s) => s.id)).toEqual(["second"]);
    expect(() => parseSourcesConfig(cfg, "nope")).toThrow(/unknown source/);
  });
  it("orders enabled sources by priority", () => {
    const c = parseSourcesConfig({ sources: [{ ...html, id: "low", priority: 5 }, { ...html, id: "high", priority: 1 }, { ...html, id: "off", enabled: false }] });
    expect(enabledSources(c).map((s) => s.id)).toEqual(["high", "low"]);
  });
});

describe("robots.txt policy", () => {
  const txt = `
# comment
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /api
Disallow: /private/
Allow: /private/public
Disallow: /*.json$
`;
  const p = new RobotsPolicy(txt);
  it("applies the wildcard group and longest-match precedence", () => {
    expect(p.isAllowed("MyBot/1.0", "/en/lottery")).toBe(true);
    expect(p.isAllowed("MyBot/1.0", "/api/x")).toBe(false);
    expect(p.isAllowed("MyBot/1.0", "/private/secret")).toBe(false);
    expect(p.isAllowed("MyBot/1.0", "/private/public/page")).toBe(true);
    expect(p.isAllowed("MyBot/1.0", "/data.json")).toBe(false);
    expect(p.isAllowed("MyBot/1.0", "/data.json5")).toBe(true);
  });
  it("applies a specific group to a matching user agent", () => {
    expect(p.isAllowed("Mozilla BadBot/2", "/anything")).toBe(false);
  });
  it("allows everything with no or empty rules, and nothing when robots is unreachable (5xx)", () => {
    expect(RobotsPolicy.allowAll().isAllowed("x", "/a")).toBe(true);
    expect(new RobotsPolicy("User-agent: *\nDisallow:\n").isAllowed("x", "/a")).toBe(true);
    expect(RobotsPolicy.denyAll().isAllowed("x", "/a")).toBe(false);
  });
  it("matches the behaviour of the real source's robots.txt (named bots blocked, others allowed)", () => {
    const real = new RobotsPolicy("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n");
    expect(real.isAllowed("LaoLotteryStatsBot/0.1 (+educational)", "/en/lottery/lao-lottery?page=2")).toBe(true);
    expect(real.isAllowed("ClaudeBot/1.0", "/en/lottery/lao-lottery")).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per window then blocks with Retry-After", () => {
    let t = 1_000;
    const rl = new RateLimiter(3, 60_000, () => t);
    expect([1, 2, 3].map(() => rl.check("ip").allowed)).toEqual([true, true, true]);
    const blocked = rl.check("ip");
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(59);
    t += 61_000;
    expect(rl.check("ip").allowed).toBe(true);
  });
  it("tracks keys independently and bounds memory", () => {
    const rl = new RateLimiter(1, 60_000, () => 1, 100);
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    for (let i = 0; i < 1000; i++) rl.check(`k${i}`);
    expect((rl as unknown as { hits: Map<string, number[]> }).hits.size).toBeLessThanOrEqual(101);
  });
});

describe("reconcile & batch planning", () => {
  const ob = (sourceId: string, priority: number, r4: string | null, r3: string | null, r2: string, fetchedAt = "2026-01-01T00:00:00Z"): Observation => ({ sourceId, priority, drawId: "d", result4: r4, result3: r3, result2: r2, sourceUrl: `u/${sourceId}`, fetchedAt, extra: null });
  it("detects conflicts only on fields both sources publish", () => {
    expect(conflicts({ result4: "1234", result3: "234", result2: "34" }, { result4: null, result3: null, result2: "34" })).toBe(false);
    expect(conflicts({ result4: "1234", result3: "234", result2: "34" }, { result4: null, result3: null, result2: "35" })).toBe(true);
    expect(conflicts({ result4: "1234", result3: "234", result2: "34" }, { result4: "9234", result3: "234", result2: "34" })).toBe(true);
    expect(sameValues({ result4: "1", result3: "2", result2: "3" } as never, { result4: "1", result3: "2", result2: "3" } as never)).toBe(true);
  });
  it("picks the lowest priority number; ties go to the freshest fetch", () => {
    expect(reconcile([ob("b", 2, "1234", "234", "34"), ob("a", 1, "1234", "234", "34")]).canonical.sourceId).toBe("a");
    expect(reconcile([ob("a", 1, "1234", "234", "34", "2026-01-01"), ob("b", 1, "1234", "234", "34", "2026-02-01")]).canonical.sourceId).toBe("b");
  });
  it("fills missing digits from agreeing sources but never across a conflict", () => {
    const filled = reconcile([ob("a", 1, null, null, "34"), ob("b", 2, "1234", "234", "34")]);
    expect(filled).toMatchObject({ result4: "1234", result3: "234", result2: "34", hasConflict: false, sourceCount: 2 });
    const clash = reconcile([ob("a", 1, null, null, "34"), ob("b", 2, "1299", "299", "99")]);
    expect(clash).toMatchObject({ result4: null, result3: null, result2: "34", hasConflict: true });
  });
  it("planBatch has no side effects on the state it is given", () => {
    const state = { observations: new Map(), draws: new Map() };
    const plan = planBatch({ sourceId: "a", lotteryCode: "LAO_DEV", priorities: { a: 1 }, records: [rec("2026-01-05", "1234")] }, state);
    expect(plan.result.inserted).toBe(1);
    expect(state.draws.size).toBe(0);
    expect(state.observations.size).toBe(0);
  });
});

describe("logger", () => {
  it("redacts sensitive fields", () => {
    const lines: string[] = [];
    const orig = console.log;
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";
    console.log = (l: string) => lines.push(l);
    try {
      createLogger("t").info("evt", { token: "abc", password: "p", authorization: "Bearer x", DATABASE_URL: "postgres://u:p@h/db", ok: 1 });
    } finally {
      console.log = orig;
      process.env.LOG_LEVEL = prev;
    }
    const out = JSON.parse(lines[0]);
    expect(out).toMatchObject({ token: "[redacted]", password: "[redacted]", authorization: "[redacted]", DATABASE_URL: "[redacted]", ok: 1 });
  });
});
