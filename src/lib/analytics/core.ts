import type { DrawRecord, PrizeType } from "../domain";
import { resultOf } from "../domain";
import { chiSquareSurvival, mean, median } from "../math";
import type {
  ChiSquare,
  DifferenceStats,
  DigitDistribution,
  FrequencyEntry,
  FrequencyTable,
  PositionDistribution,
  RepeatStats,
  Selection,
  ValuePoint,
} from "./types";

export const digitsOf = (prize: PrizeType): number => Number(prize);

const POSITION_LABELS: Record<number, string[]> = {
  2: ["หลักสิบ", "หลักหน่วย"],
  3: ["หลักร้อย", "หลักสิบ", "หลักหน่วย"],
  4: ["หลักพัน", "หลักร้อย", "หลักสิบ", "หลักหน่วย"],
};
export const positionLabels = (digits: number): string[] => POSITION_LABELS[digits] ?? [];

/** Filters by date range, then keeps the most recent `last` draws. Always returns ascending order. */
export function selectDraws(draws: DrawRecord[], sel: Pick<Selection, "last" | "from" | "to">): DrawRecord[] {
  let out = draws.filter((d) => (!sel.from || d.drawDate >= sel.from) && (!sel.to || d.drawDate <= sel.to));
  out = [...out].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  if (sel.last !== undefined && sel.last > 0 && out.length > sel.last) out = out.slice(out.length - sel.last);
  return out;
}

/** Result strings for a prize type; draws where the source did not publish it are skipped. */
export function toPoints(draws: DrawRecord[], prize: PrizeType): ValuePoint[] {
  const pts: ValuePoint[] = [];
  for (const d of draws) {
    const v = resultOf(d, prize);
    if (v !== null) pts.push({ date: d.drawDate, value: v });
  }
  return pts;
}

const byCountThenValue = (a: FrequencyEntry, b: FrequencyEntry) => b.count - a.count || a.value.localeCompare(b.value);

export function frequencyTable(points: ValuePoint[], digits: number, topN = 10): FrequencyTable {
  const counts = new Map<string, number>();
  for (const p of points) counts.set(p.value, (counts.get(p.value) ?? 0) + 1);
  const total = points.length;
  const entries: FrequencyEntry[] = [...counts.entries()]
    .map(([value, count]) => ({ value, count, share: total ? count / total : 0 }))
    .sort(byCountThenValue);
  const leastFrequent = [...entries].sort((a, b) => a.count - b.count || a.value.localeCompare(b.value)).slice(0, topN);

  let grid: number[] | null = null;
  let unobserved: string[] | null = null;
  if (digits === 2) {
    grid = Array.from({ length: 100 }, (_, i) => counts.get(String(i).padStart(2, "0")) ?? 0);
    unobserved = grid.map((c, i) => (c === 0 ? String(i).padStart(2, "0") : null)).filter((v): v is string => v !== null);
  }
  return {
    digits,
    total,
    possible: 10 ** digits,
    distinct: entries.length,
    entries,
    mostFrequent: entries.slice(0, topN),
    leastFrequent,
    unobserved,
    grid,
  };
}

export function chiSquareUniform(counts: number[]): ChiSquare {
  const n = counts.reduce((a, b) => a + b, 0);
  const k = counts.length;
  const expected = n / k;
  if (n === 0) return { statistic: 0, df: k - 1, pValue: 1, approximationValid: false };
  let stat = 0;
  for (const c of counts) stat += (c - expected) ** 2 / expected;
  return { statistic: stat, df: k - 1, pValue: chiSquareSurvival(stat, k - 1), approximationValid: expected >= 5 };
}

export function digitDistribution(points: ValuePoint[], digits: number): DigitDistribution {
  const labels = positionLabels(digits);
  const positions: PositionDistribution[] = [];
  const overall = new Array<number>(10).fill(0);
  for (let pos = 0; pos < digits; pos++) {
    const counts = new Array<number>(10).fill(0);
    for (const p of points) {
      const d = p.value.charCodeAt(pos) - 48;
      if (d >= 0 && d <= 9) {
        counts[d]++;
        overall[d]++;
      }
    }
    const total = counts.reduce((a, b) => a + b, 0);
    positions.push({
      position: pos,
      label: labels[pos] ?? `หลักที่ ${pos + 1}`,
      counts,
      shares: counts.map((c) => (total ? c / total : 0)),
      total,
      chiSquare: chiSquareUniform(counts),
    });
  }
  const overallTotal = overall.reduce((a, b) => a + b, 0);
  return { positions, overall: { counts: overall, shares: overall.map((c) => (overallTotal ? c / overallTotal : 0)), total: overallTotal } };
}

export function repeatStats(points: ValuePoint[], digits: number, topN = 15): RepeatStats {
  const possible = 10 ** digits;
  const examples: RepeatStats["consecutive"]["examples"] = [];
  let consecutive = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].value === points[i - 1].value) {
      consecutive++;
      if (examples.length < 10) examples.push({ date: points[i].date, previousDate: points[i - 1].date, value: points[i].value });
    }
  }
  const opportunities = Math.max(0, points.length - 1);

  const where = new Map<string, number[]>();
  points.forEach((p, i) => where.set(p.value, [...(where.get(p.value) ?? []), i]));
  const repeated = [...where.entries()].filter(([, idx]) => idx.length >= 2);
  const repeatedValues = repeated
    .map(([value, idx]) => ({ value, count: idx.length, dates: idx.map((i) => points[i].date) }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, topN);

  const gapList: number[] = [];
  for (const [, idx] of repeated) for (let k = 1; k < idx.length; k++) gapList.push(idx[k] - idx[k - 1]);

  let doubleDigits: RepeatStats["doubleDigits"] = null;
  if (digits >= 2 && points.length) {
    const c = points.filter((p) => new Set(p.value).size === 1).length;
    doubleDigits = { count: c, share: c / points.length, expectedShare: 10 ** (1 - digits) };
  }

  return {
    consecutive: { count: consecutive, opportunities, rate: opportunities ? consecutive / opportunities : 0, expectedRate: 1 / possible, examples },
    repeatedValues,
    distinctRepeated: repeated.length,
    doubleDigits,
    gaps: gapList.length
      ? { count: gapList.length, min: Math.min(...gapList), median: median(gapList), mean: mean(gapList), max: Math.max(...gapList) }
      : null,
  };
}

/** Differences between consecutive draws of the numeric value (descriptive; no predictive meaning). */
export function differenceStats(points: ValuePoint[], digits: number): DifferenceStats {
  const space = 10 ** digits;
  const series = points.map((p, i) => {
    const v = Number(p.value);
    const diff = i === 0 ? null : v - Number(points[i - 1].value);
    return { date: p.date, value: v, diff, absDiff: diff === null ? null : Math.abs(diff) };
  });
  const abs = series.map((s) => s.absDiff).filter((x): x is number => x !== null);
  const signed = series.map((s) => s.diff).filter((x): x is number => x !== null);
  const binWidth = space / 10;
  const histogram = Array.from({ length: 10 }, (_, i) => ({
    label: `${i * binWidth}–${(i + 1) * binWidth - 1}`,
    from: i * binWidth,
    to: (i + 1) * binWidth - 1,
    count: 0,
  }));
  for (const a of abs) histogram[Math.min(9, Math.floor(a / binWidth))].count++;
  return {
    series,
    summary: abs.length
      ? {
          count: abs.length,
          meanAbs: mean(abs),
          medianAbs: median(abs),
          maxAbs: Math.max(...abs),
          meanSigned: mean(signed),
          // E|X−Y| for X,Y iid uniform on {0..N-1}
          expectedMeanAbsUniform: (space * space - 1) / (3 * space),
        }
      : null,
    histogram,
  };
}

/** Histogram of the numeric value in 10 equal bins, with the count expected under a uniform spread. */
export function valueHistogram(points: ValuePoint[], digits: number) {
  const space = 10 ** digits;
  const binWidth = space / 10;
  const bins = Array.from({ length: 10 }, (_, i) => ({
    label: `${i * binWidth}–${(i + 1) * binWidth - 1}`,
    from: i * binWidth,
    to: (i + 1) * binWidth - 1,
    count: 0,
    expected: points.length / 10,
  }));
  for (const p of points) bins[Math.min(9, Math.floor(Number(p.value) / binWidth))].count++;
  return bins;
}
