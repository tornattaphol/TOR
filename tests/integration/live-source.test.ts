import { describe, expect, it } from "vitest";
import { MemoryDrawStore } from "../../src/lib/db/memory-store";
import { loadSourcesConfig, enabledSources } from "../../src/lib/config/sources";
import { addDays, todayIn, weekdayOf } from "../../src/lib/dates";
import { createHttpClientFromEnv, ingestSource } from "../../src/lib/ingestion/pipeline";

/**
 * Opt-in smoke test against the REAL configured source (network required).
 *   bash:        LIVE_SOURCE_TEST=1 npm run test:integration
 *   PowerShell:  $env:LIVE_SOURCE_TEST=1; npm run test:integration
 * It fetches one page (politely, honouring robots.txt) and checks that the parser still understands the site.
 */
describe.skipIf(!process.env.LIVE_SOURCE_TEST)("live source smoke test", () => {
  it("the primary configured source is reachable and its layout is still understood", async () => {
    const config = loadSourcesConfig();
    const [primary] = enabledSources(config);
    const store = new MemoryDrawStore();
    const out = await ingestSource(primary, { store, config, http: createHttpClientFromEnv(), maxPages: 1, trigger: "live-test" });
    expect(out.errorCode).toBeNull();
    expect(["SUCCESS", "PARTIAL"]).toContain(out.status);
    expect(out.recordsValid).toBeGreaterThanOrEqual(8);
    const rows = await store.findDraws({ order: "desc" });
    for (const r of rows) expect(primary.expectedWeekdays).toContain(weekdayOf(r.drawDate));
    // the newest stored draw should be recent (draws happen every 2–3 days)
    expect(rows[0].drawDate >= addDays(todayIn("Asia/Vientiane"), -10)).toBe(true);
    for (const r of rows) {
      expect(r.result4).toMatch(/^\d{4}$/);
      expect(r.result3).toBe(r.result4?.slice(1));
      expect(r.result2).toBe(r.result4?.slice(2));
    }
  });
});
