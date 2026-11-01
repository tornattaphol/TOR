import { describe, expect, it } from "vitest";
import { buildHealthReport, type HealthInputs } from "../../src/lib/quality";
import type { DataIssueRecord, IngestionRunRecord } from "../../src/lib/domain";
import { mkDraw, scheduleDraws } from "../helpers/fixtures";

const issue = (over: Partial<DataIssueRecord>): DataIssueRecord => ({
  id: 1,
  fingerprint: "f",
  kind: "INVALID_NUMBER_FORMAT",
  severity: "ERROR",
  sourceId: "s",
  drawDate: null,
  message: "m",
  details: null,
  occurrences: 1,
  firstSeenAt: "2026-10-01T00:00:00Z",
  lastSeenAt: "2026-10-01T00:00:00Z",
  ...over,
});

const run = (over: Partial<IngestionRunRecord> = {}): IngestionRunRecord => ({
  id: 1, sourceId: "s", trigger: "cli", status: "SUCCESS", startedAt: "2026-10-04T00:00:00Z", finishedAt: "2026-10-04T00:01:00Z",
  pagesFetched: 1, recordsParsed: 10, recordsValid: 10, inserted: 10, updated: 0, unchanged: 0, quarantined: 0, invalid: 0, duplicates: 0, conflicts: 0, errorCode: null, errorMessage: null, ...over,
});

function inputs(over: Partial<HealthInputs> = {}): HealthInputs {
  return { draws: [], issues: [], issueCounts: {}, runs: [], lastSuccessfulRunAt: null, expectedWeekdays: [1, 3, 5], today: "2026-10-04", now: new Date("2026-10-04T12:00:00Z"), ...over };
}

describe("data health report", () => {
  it("reports an empty database explicitly", () => {
    const h = buildHealthReport(inputs());
    expect(h.status).toBe("empty");
    expect(h.totals).toMatchObject({ records: 0, firstDate: null, latestDate: null });
    expect(h.schedule.coveragePercent).toBeNull();
    expect(h.reasons[0]).toMatch(/ingest/);
  });

  it("is healthy when the schedule is fully covered", () => {
    // Mon 2026-09-21 … Fri 2026-10-02 are 6 consecutive scheduled draws
    const draws = scheduleDraws("2026-09-21", ["1111", "2222", "3333", "4444", "5555", "6666"]);
    const h = buildHealthReport(inputs({ draws, runs: [run()], lastSuccessfulRunAt: "2026-10-04T00:01:00Z" }));
    expect(draws.at(-1)?.drawDate).toBe("2026-10-02");
    expect(h.status).toBe("healthy");
    expect(h.schedule).toMatchObject({ expectedDraws: 6, presentDraws: 6, missingCount: 0, coveragePercent: 100, overdue: [] });
    expect(h.freshness).toMatchObject({ latestDrawDate: "2026-10-02", daysSinceLatestDraw: 2, lastRunStatus: "SUCCESS" });
    expect(h.totals.bySource).toEqual([{ source: "test", count: 6 }]);
  });

  it("finds missing draws and tells validation rejects apart from absent records", () => {
    const all = scheduleDraws("2026-09-21", ["1111", "2222", "3333", "4444", "5555", "6666"]);
    const draws = all.filter((_, i) => i !== 1 && i !== 3); // drop 09-23 and 09-28
    const h = buildHealthReport(inputs({ draws, issues: [issue({ kind: "DERIVED_DIGIT_MISMATCH", drawDate: "2026-09-23" })], issueCounts: { DERIVED_DIGIT_MISMATCH: 1 } }));
    expect(h.schedule.missing).toEqual([
      { date: "2026-09-23", reason: "rejected_by_validation" },
      { date: "2026-09-28", reason: "not_in_source" },
    ]);
    expect(h.schedule.coveragePercent).toBeCloseTo(66.7, 1);
    expect(h.status).toBe("warning");
    expect(h.issues).toMatchObject({ derivedMismatch: 1, abnormalRecords: 1 });
  });

  it("flags stale data: scheduled draws after the latest stored one", () => {
    const draws = scheduleDraws("2026-09-21", ["1111", "2222", "3333"]); // latest 09-25 (Fri)
    const h = buildHealthReport(inputs({ draws, today: "2026-10-04" }));
    expect(h.schedule.overdue).toEqual(["2026-09-28", "2026-09-30", "2026-10-02"]);
    expect(h.status).toBe("warning");
  });

  it("does not count today's draw as overdue", () => {
    const draws = scheduleDraws("2026-09-28", ["1111", "2222"]); // Mon, Wed → latest 09-30
    expect(buildHealthReport(inputs({ draws, today: "2026-10-02" })).schedule.overdue).toEqual([]);
    expect(buildHealthReport(inputs({ draws, today: "2026-10-03" })).schedule.overdue).toEqual(["2026-10-02"]);
  });

  it("escalates source conflicts to critical", () => {
    const draws = [mkDraw("2026-10-02", "4693", { hasConflict: true, sourceCount: 2 })];
    const h = buildHealthReport(inputs({ draws, issueCounts: { SOURCE_CONFLICT: 1 }, issues: [issue({ kind: "SOURCE_CONFLICT", drawDate: "2026-10-02" })] }));
    expect(h.status).toBe("critical");
    expect(h.totals.recordsWithConflict).toBe(1);
    expect(h.issues.sourceConflict).toBe(1);
  });

  it("summarises issue counters (duplicates, invalid dates/numbers, quarantine)", () => {
    const draws = [mkDraw("2026-10-02", "4693")];
    const issues = [
      issue({ id: 1, kind: "DUPLICATE_IN_SOURCE", severity: "INFO", occurrences: 4, drawDate: "2026-10-02" }),
      issue({ id: 2, kind: "DUPLICATE_IN_SOURCE", severity: "INFO", occurrences: 2, drawDate: "2026-09-30" }),
      issue({ id: 3, kind: "INVALID_DATE" }),
      issue({ id: 4, kind: "FUTURE_DATE" }),
      issue({ id: 5, kind: "INVALID_NUMBER_FORMAT" }),
      issue({ id: 6, kind: "UNEXPECTED_WEEKDAY", severity: "WARNING" }),
    ];
    const h = buildHealthReport(inputs({ draws, issues, issueCounts: { DUPLICATE_IN_SOURCE: 2, INVALID_DATE: 1, FUTURE_DATE: 1, INVALID_NUMBER_FORMAT: 1, UNEXPECTED_WEEKDAY: 1 } }));
    expect(h.issues).toMatchObject({ distinct: 6, duplicateRows: 6, invalidDate: 2, invalidNumberFormat: 1, quarantined: 1 });
    expect(h.issues.recent).toHaveLength(6);
  });

  it("surfaces a failed last run", () => {
    const draws = scheduleDraws("2026-09-28", ["1111", "2222", "3333"]);
    const h = buildHealthReport(inputs({ draws, today: "2026-10-03", runs: [run({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" })] }));
    expect(h.status).toBe("warning");
    expect(h.reasons.join(" ")).toContain("SOURCE_UNAVAILABLE");
    expect(h.freshness.lastRunStatus).toBe("FAILED");
  });
});
