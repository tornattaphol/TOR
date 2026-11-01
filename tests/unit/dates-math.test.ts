import { describe, expect, it } from "vitest";
import { addDays, daysBetween, expectedDrawDates, formatThaiDate, isValidIsoDate, parseDateWithFormat, parseEnglishDate, todayIn, weekdayOf } from "../../src/lib/dates";
import { binomialUpperTail, chiSquareSurvival, logGamma, mean, median, mulberry32, normalCdf, quantile, stdev, variance, wilsonInterval } from "../../src/lib/math";

describe("dates", () => {
  it("validates ISO dates strictly", () => {
    expect(isValidIsoDate("2026-10-02")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "26-10-02", "2026/10/02", "", "abcd-ef-gh", "2026-10-02T00:00"]) {
      expect(isValidIsoDate(bad), bad).toBe(false);
    }
    expect(isValidIsoDate("2023-02-29")).toBe(false);
  });

  it("computes weekdays, offsets and gaps", () => {
    expect(weekdayOf("2026-10-02")).toBe(5); // Friday
    expect(weekdayOf("2026-09-28")).toBe(1); // Monday
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-28", "2026-10-02")).toBe(4);
  });

  it("lists scheduled draw dates", () => {
    expect(expectedDrawDates("2026-09-28", "2026-10-05", [1, 3, 5])).toEqual(["2026-09-28", "2026-09-30", "2026-10-02", "2026-10-05"]);
    expect(expectedDrawDates("2026-10-03", "2026-10-04", [1, 3, 5])).toEqual([]);
  });

  it("parses English dates as shown on the source", () => {
    expect(parseEnglishDate("2 October 2026")).toBe("2026-10-02");
    expect(parseEnglishDate(" 02 Oct 2026 ")).toBe("2026-10-02");
    expect(parseEnglishDate("31 February 2026")).toBeNull();
    expect(parseEnglishDate("October 2 2026")).toBeNull();
    expect(parseEnglishDate("2 Octember 2026")).toBeNull();
  });

  it("parses configured formats, including Buddhist era", () => {
    expect(parseDateWithFormat("2026-10-02", "YYYY-MM-DD")).toBe("2026-10-02");
    expect(parseDateWithFormat("02/10/2026", "DD/MM/YYYY")).toBe("2026-10-02");
    expect(parseDateWithFormat("02-10-2569", "DD-MM-YYYY", true)).toBe("2026-10-02");
    expect(parseDateWithFormat("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseDateWithFormat("2026-10-02", "DD/MM/YYYY")).toBeNull();
  });

  it("formats Thai Buddhist-era dates for display", () => {
    expect(formatThaiDate("2026-10-02")).toContain("2569");
    expect(formatThaiDate("not-a-date")).toBe("not-a-date");
  });

  it("derives today's date in a time zone", () => {
    // 2026-10-02 20:30 UTC is already 03:30 on 10-03 in Vientiane (UTC+7)
    expect(todayIn("Asia/Vientiane", new Date("2026-10-02T20:30:00Z"))).toBe("2026-10-03");
    expect(todayIn("UTC", new Date("2026-10-02T20:30:00Z"))).toBe("2026-10-02");
  });
});

describe("math", () => {
  it("descriptive statistics", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4.5714, 3);
    expect(stdev([1, 1, 1])).toBe(0);
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(mean([])).toBeNaN();
  });

  it("log-gamma and chi-square survival match reference values", () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 8);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8);
    expect(chiSquareSurvival(3.841458820694124, 1)).toBeCloseTo(0.05, 6);
    expect(chiSquareSurvival(16.918977604620448, 9)).toBeCloseTo(0.05, 6);
    expect(chiSquareSurvival(21.665994333461924, 9)).toBeCloseTo(0.01, 6);
    expect(chiSquareSurvival(0, 5)).toBe(1);
    expect(chiSquareSurvival(500, 9)).toBeLessThan(1e-50);
  });

  it("normal CDF", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 5);
  });

  it("exact binomial upper tail", () => {
    // P(X >= 8), X ~ Bin(10, .5) = 56/1024
    expect(binomialUpperTail(8, 10, 0.5)).toBeCloseTo(56 / 1024, 10);
    expect(binomialUpperTail(0, 10, 0.5)).toBe(1);
    expect(binomialUpperTail(11, 10, 0.5)).toBe(0);
    expect(binomialUpperTail(1, 96, 0.01)).toBeCloseTo(1 - 0.99 ** 96, 10);
  });

  it("Wilson interval contains the estimate and respects bounds", () => {
    const [lo, hi] = wilsonInterval(5, 96);
    expect(lo).toBeGreaterThan(0.01);
    expect(hi).toBeLessThan(0.15);
    expect(lo).toBeLessThan(5 / 96);
    expect(hi).toBeGreaterThan(5 / 96);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
    expect(wilsonInterval(10, 10)[1]).toBe(1);
  });

  it("seeded RNG is reproducible and in [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mean(xs)).toBeCloseTo(0.5, 1);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
