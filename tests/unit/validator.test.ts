import { describe, expect, it } from "vitest";
import { canonicalDrawId, validateRecords } from "../../src/lib/ingestion/validator";
import type { RawRecord } from "../../src/lib/ingestion/types";

const opts = { sourceId: "src", lotteryCode: "LAO_DEV", expectedWeekdays: [1, 3, 5], today: "2026-10-04" };

function raw(date: string | null, r4: string | null | undefined, r3?: string | null, r2?: string | null, over: Partial<RawRecord> = {}): RawRecord {
  return { sourceUrl: `https://x.test/${date}`, fetchedAt: "2026-10-04T00:00:00Z", dateText: date ?? "garbage", isoDate: date, result4: r4, result3: r3, result2: r2, ...over };
}

describe("validator — valid data", () => {
  it("accepts a consistent record and builds a canonical id", () => {
    const v = validateRecords([raw("2026-10-02", "4693", "693", "93")], opts);
    expect(v.issues).toEqual([]);
    expect(v.valid).toHaveLength(1);
    expect(v.valid[0]).toMatchObject({ drawDate: "2026-10-02", drawId: "lao_dev_20261002", result4: "4693", result3: "693", result2: "93", sourceId: "src", sourceUrl: "https://x.test/2026-10-02" });
    expect(canonicalDrawId("LAO_DEV", "2026-10-02")).toBe("lao_dev_20261002");
  });

  it("keeps leading zeros", () => {
    const v = validateRecords([raw("2026-09-28", "0007", "007", "07")], opts);
    expect(v.valid[0]).toMatchObject({ result4: "0007", result3: "007", result2: "07" });
  });

  it("derives missing 3/2-digit results from the 4-digit number and records that fact", () => {
    const v = validateRecords([raw("2026-10-02", "4693", null, "")], opts);
    expect(v.valid[0]).toMatchObject({ result3: "693", result2: "93" });
    expect(v.valid[0].extra).toMatchObject({ derivedFields: ["result3", "result2"] });
  });

  it("accepts sources that only publish the 2-digit result", () => {
    const v = validateRecords([raw("2026-10-02", undefined, undefined, "93")], opts);
    expect(v.valid[0]).toMatchObject({ result4: null, result3: null, result2: "93" });
  });

  it("trims whitespace around numbers", () => {
    expect(validateRecords([raw("2026-10-02", " 4693 ", "693", "93")], opts).valid).toHaveLength(1);
  });
});

describe("validator — invalid date", () => {
  it("rejects unreadable dates", () => {
    const v = validateRecords([raw(null, "4693", "693", "93")], opts);
    expect(v.valid).toEqual([]);
    expect(v.counts.invalid).toBe(1);
    expect(v.issues[0]).toMatchObject({ kind: "INVALID_DATE", severity: "ERROR", drawDate: null });
  });
  it("rejects calendar-impossible dates even if the parser produced them", () => {
    const v = validateRecords([raw("2026-02-30", "4693", "693", "93")], opts);
    expect(v.issues[0].kind).toBe("INVALID_DATE");
  });
  it("rejects future dates", () => {
    const v = validateRecords([raw("2026-10-05", "4693", "693", "93")], opts);
    expect(v.valid).toEqual([]);
    expect(v.issues[0]).toMatchObject({ kind: "FUTURE_DATE", drawDate: "2026-10-05" });
  });
  it("accepts today's date", () => {
    expect(validateRecords([raw("2026-10-02", "4693", "693", "93")], { ...opts, today: "2026-10-02" }).valid).toHaveLength(1);
  });
});

describe("validator — invalid number format", () => {
  it.each([
    ["5 digits", "46931", "693", "93"],
    ["3 digits for 4", "469", "693", "93"],
    ["letters", "46x3", "6x3", "x3"],
    ["negative", "-693", "693", "93"],
    ["decimal", "46.3", "693", "93"],
    ["2-digit too long", "4693", "693", "093"],
    ["3-digit too short", "4693", "93", "93"],
  ])("rejects %s", (_n, r4, r3, r2) => {
    const v = validateRecords([raw("2026-10-02", r4, r3, r2)], opts);
    expect(v.valid).toEqual([]);
    expect(v.counts.invalid).toBe(1);
    expect(v.issues[0]).toMatchObject({ kind: "INVALID_NUMBER_FORMAT", severity: "ERROR" });
  });

  it("rejects records with no numbers at all", () => {
    const v = validateRecords([raw("2026-10-02", "", "", "")], opts);
    expect(v.issues[0].kind).toBe("MISSING_FIELD");
  });
});

describe("validator — inconsistent derived digits (real source anomaly, 2026-04-20)", () => {
  it("rejects last-2 that does not match the tail of the 4-digit result", () => {
    // observed on the live source: 4-digit 0599, 3-digit 599, 2-digit 59 (should be 99)
    const v = validateRecords([raw("2026-04-20", "0599", "599", "59")], opts);
    expect(v.valid).toEqual([]);
    expect(v.issues[0]).toMatchObject({ kind: "DERIVED_DIGIT_MISMATCH", severity: "ERROR", drawDate: "2026-04-20" });
    expect(v.issues[0].details).toMatchObject({ result4: "0599", result3: "599", result2: "59" });
  });
  it("rejects last-3 that does not match the 4-digit result", () => {
    const v = validateRecords([raw("2026-10-02", "4693", "793", "93")], opts);
    expect(v.issues[0].kind).toBe("DERIVED_DIGIT_MISMATCH");
  });
  it("checks 2-digit against 3-digit when there is no 4-digit result", () => {
    expect(validateRecords([raw("2026-10-02", null, "693", "93")], opts).valid).toHaveLength(1);
    expect(validateRecords([raw("2026-10-02", null, "693", "94")], opts).issues[0].kind).toBe("DERIVED_DIGIT_MISMATCH");
  });
});

describe("validator — schedule", () => {
  it("quarantines results dated on a non-draw weekday (not stored, but visible)", () => {
    // 2026-10-01 is a Thursday — an aggregator listed it; the schedule says Mon/Wed/Fri
    const v = validateRecords([raw("2026-10-01", "5609", "609", "09")], opts);
    expect(v.valid).toEqual([]);
    expect(v.counts.quarantined).toBe(1);
    expect(v.counts.invalid).toBe(0);
    expect(v.issues[0]).toMatchObject({ kind: "UNEXPECTED_WEEKDAY", severity: "WARNING", drawDate: "2026-10-01" });
    expect(v.issues[0].details).toMatchObject({ result4: "5609" });
  });
  it("honours a different configured schedule", () => {
    const v = validateRecords([raw("2026-10-01", "5609", "609", "09")], { ...opts, expectedWeekdays: [4] });
    expect(v.valid).toHaveLength(1);
  });
});

describe("validator — duplicates and conflicts inside one payload", () => {
  it("collapses identical duplicates (e.g. pagination overlap) into one and records an INFO issue", () => {
    const a = raw("2026-10-02", "4693", "693", "93");
    const v = validateRecords([a, { ...a }, { ...a }], opts);
    expect(v.valid).toHaveLength(1);
    expect(v.counts.duplicates).toBe(2);
    expect(v.issues).toHaveLength(1);
    expect(v.issues[0]).toMatchObject({ kind: "DUPLICATE_IN_SOURCE", severity: "INFO", drawDate: "2026-10-02" });
  });
  it("drops a date entirely when the same source gives two different results", () => {
    const v = validateRecords([raw("2026-10-02", "4693", "693", "93"), raw("2026-10-02", "1111", "111", "11"), raw("2026-09-30", "3653", "653", "53")], opts);
    expect(v.valid.map((r) => r.drawDate)).toEqual(["2026-09-30"]);
    expect(v.counts.conflicts).toBe(1);
    expect(v.issues.find((i) => i.kind === "SOURCE_CONFLICT")).toMatchObject({ severity: "ERROR", drawDate: "2026-10-02" });
  });
});

describe("validator — mixed batches", () => {
  it("keeps good rows and reports every bad one", () => {
    const v = validateRecords(
      [
        raw("2026-10-02", "4693", "693", "93"),
        raw("2026-09-30", "36x3", "653", "53"),
        raw(null, "1", "1", "1"),
        raw("2026-09-28", "4277", "277", "77"),
        raw("2026-09-29", "6616", "616", "16"), // Tuesday → quarantined
      ],
      opts,
    );
    expect(v.valid.map((r) => r.drawDate)).toEqual(["2026-10-02", "2026-09-28"]);
    expect(v.counts).toEqual({ invalid: 2, quarantined: 1, duplicates: 0, conflicts: 0 });
    expect(v.issues.map((i) => i.kind).sort()).toEqual(["INVALID_DATE", "INVALID_NUMBER_FORMAT", "UNEXPECTED_WEEKDAY"]);
  });
  it("handles an empty list", () => {
    expect(validateRecords([], opts)).toEqual({ valid: [], issues: [], counts: { invalid: 0, quarantined: 0, duplicates: 0, conflicts: 0 } });
  });
});
