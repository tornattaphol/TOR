import { beforeEach, describe, expect, it } from "vitest";
import type { DrawStore } from "../../src/lib/db/store";
import type { ValidRecord } from "../../src/lib/ingestion/types";

export function rec(date: string, r4: string, over: Partial<ValidRecord> = {}): ValidRecord {
  return {
    drawDate: date,
    drawId: `lao_dev_${date.replaceAll("-", "")}`,
    result4: r4,
    result3: r4.slice(1),
    result2: r4.slice(2),
    sourceId: "a",
    sourceUrl: `https://a.test/${date}`,
    fetchedAt: "2026-02-01T00:00:00.000Z",
    extra: null,
    rawPayload: { raw: r4 },
    ...over,
  };
}

const PRI = { a: 1, b: 2 };
const base = { lotteryCode: "LAO_DEV", priorities: PRI };

/**
 * Behavioural contract every DrawStore must satisfy. Run against the in-memory store (unit tests) and the
 * PostgreSQL store (integration tests) so they can never drift apart.
 */
export function runStoreContract(name: string, factory: () => Promise<DrawStore>) {
  describe(`DrawStore contract: ${name}`, () => {
    let store: DrawStore;
    beforeEach(async () => {
      store = await factory();
    });

    it("inserts new draws and returns them ordered", async () => {
      const res = await store.ingestBatch({ ...base, sourceId: "a", records: [rec("2026-01-05", "1234"), rec("2026-01-02", "0702")] });
      expect(res).toMatchObject({ inserted: 2, updated: 0, unchanged: 0 });
      const rows = await store.findDraws();
      expect(rows.map((r) => r.drawDate)).toEqual(["2026-01-02", "2026-01-05"]);
      expect(rows[0]).toMatchObject({ result4: "0702", result3: "702", result2: "02", source: "a", sourceCount: 1, hasConflict: false });
      expect(await store.countDraws()).toBe(2);
    });

    it("preserves leading zeros", async () => {
      await store.ingestBatch({ ...base, sourceId: "a", records: [rec("2026-01-05", "0007")] });
      const [d] = await store.findDraws();
      expect([d.result4, d.result3, d.result2]).toEqual(["0007", "007", "07"]);
    });

    it("is idempotent: re-ingesting identical data changes nothing", async () => {
      const records = [rec("2026-01-05", "1234"), rec("2026-01-07", "5678")];
      await store.ingestBatch({ ...base, sourceId: "a", records });
      const again = await store.ingestBatch({ ...base, sourceId: "a", records });
      expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 2, conflicts: [] });
      expect(await store.countDraws()).toBe(2);
    });

    it("reports (and applies) a revision made by the same source", async () => {
      await store.ingestBatch({ ...base, sourceId: "a", records: [rec("2026-01-05", "1234")] });
      const res = await store.ingestBatch({ ...base, sourceId: "a", records: [rec("2026-01-05", "1299")] });
      expect(res.updated).toBe(1);
      expect(res.conflicts).toHaveLength(1);
      expect(res.conflicts[0]).toMatchObject({ reason: "revised_by_source", drawDate: "2026-01-05" });
      const [d] = await store.findDraws();
      expect(d.result4).toBe("1299");
      expect(d.hasConflict).toBe(false);
    });

    it("flags a cross-source conflict and keeps the higher-priority source as canonical", async () => {
      await store.ingestBatch({ ...base, sourceId: "a", records: [rec("2026-01-05", "1234")] });
      const res = await store.ingestBatch({ ...base, sourceId: "b", records: [rec("2026-01-05", "9999", { sourceId: "b", sourceUrl: "https://b.test/x" })] });
      expect(res.conflicts.map((c) => c.reason)).toContain("cross_source");
      const [d] = await store.findDraws();
      expect(d).toMatchObject({ result4: "1234", source: "a", sourceCount: 2, hasConflict: true });
    });

    it("lets agreeing sources co-exist (sourceCount 2, no conflict)", async () => {
      await store.ingestBatch({ ...base, sourceId: "a", records: [rec("2026-01-05", "1234")] });
      const res = await store.ingestBatch({ ...base, sourceId: "b", records: [rec("2026-01-05", "1234", { sourceId: "b" })] });
      expect(res.conflicts).toEqual([]);
      const [d] = await store.findDraws();
      expect(d).toMatchObject({ sourceCount: 2, hasConflict: false, source: "a" });
    });

    it("filters by date range and paginates", async () => {
      const records = ["2026-01-02", "2026-01-05", "2026-01-07", "2026-01-09"].map((d, i) => rec(d, `00${i}0`));
      await store.ingestBatch({ ...base, sourceId: "a", records });
      expect((await store.findDraws({ from: "2026-01-05", to: "2026-01-07" })).map((d) => d.drawDate)).toEqual(["2026-01-05", "2026-01-07"]);
      expect(await store.countDraws({ from: "2026-01-06" })).toBe(2);
      const page = await store.findDraws({ order: "desc", limit: 2, offset: 1 });
      expect(page.map((d) => d.drawDate)).toEqual(["2026-01-07", "2026-01-05"]);
      expect((await store.getLatestDraw())?.drawDate).toBe("2026-01-09");
    });

    it("de-duplicates data issues by fingerprint and counts occurrences", async () => {
      const issue = { kind: "INVALID_NUMBER_FORMAT" as const, severity: "ERROR" as const, sourceId: "a", drawDate: "2026-01-05", message: "bad number" };
      await store.saveIssues([issue], null);
      await store.saveIssues([issue, { ...issue, kind: "DUPLICATE_IN_SOURCE", severity: "INFO", message: "dup" }], null);
      const issues = await store.listIssues();
      expect(issues).toHaveLength(2);
      expect(issues.find((i) => i.kind === "INVALID_NUMBER_FORMAT")?.occurrences).toBe(2);
      expect(await store.issueCounts()).toEqual({ INVALID_NUMBER_FORMAT: 1, DUPLICATE_IN_SOURCE: 1 });
      expect(await store.listIssues({ kind: "DUPLICATE_IN_SOURCE" })).toHaveLength(1);
    });

    it("tracks ingestion runs", async () => {
      const run = await store.startRun("a", "test");
      expect(run).toMatchObject({ status: "RUNNING", sourceId: "a", finishedAt: null });
      expect(await store.lastSuccessfulRunAt()).toBeNull();
      const done = await store.finishRun(run.id, { status: "SUCCESS", inserted: 3, recordsParsed: 3, recordsValid: 3 });
      expect(done).toMatchObject({ status: "SUCCESS", inserted: 3 });
      expect(done.finishedAt).not.toBeNull();
      const failed = await store.startRun("a", "test");
      await store.finishRun(failed.id, { status: "FAILED", errorCode: "SOURCE_UNAVAILABLE", errorMessage: "down" });
      const runs = await store.listRuns(10);
      expect(runs[0]).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });
      expect(await store.lastSuccessfulRunAt()).toBe(done.finishedAt);
    });

  });
}
