import type { DrawRecord } from "../domain";
import { PRIZE_TYPES } from "../domain";
import { differenceStats, digitDistribution, digitsOf, frequencyTable, repeatStats, selectDraws, toPoints, valueHistogram } from "./core";
import type { AnalyticsBundle, Selection } from "./types";
import { movingAverage, movingDigitFrequency, windowStats } from "./windows";

export * from "./types";
export { selectDraws, toPoints, frequencyTable, digitDistribution, repeatStats, differenceStats, valueHistogram, chiSquareUniform } from "./core";
export { windowStats, movingDigitFrequency, movingAverage, WINDOW_SIZES } from "./windows";

export interface BundleOptions {
  /** Rolling window for moving frequency / moving average (default 10). */
  movingWindow?: number;
  topN?: number;
}

/**
 * Historical statistical summary of the selected draws. Everything here is descriptive:
 * it says what occurred in the past and carries no information about any future draw.
 */
export function buildAnalytics(draws: DrawRecord[], sel: Selection, opts: BundleOptions = {}): AnalyticsBundle {
  if (!PRIZE_TYPES.includes(sel.prize)) throw new RangeError(`Unknown prize type: ${sel.prize}`);
  const digits = digitsOf(sel.prize);
  const selected = selectDraws(draws, sel);
  const points = toPoints(selected, sel.prize);
  const mw = Math.max(2, opts.movingWindow ?? 10);
  const numeric = points.map((p) => Number(p.value));
  const ma = movingAverage(numeric, mw);

  return {
    selection: {
      prize: sel.prize,
      digits,
      drawCount: points.length,
      firstDate: points[0]?.date ?? null,
      lastDate: points[points.length - 1]?.date ?? null,
      last: sel.last ?? null,
      from: sel.from ?? null,
      to: sel.to ?? null,
    },
    frequency: frequencyTable(points, digits, opts.topN ?? 10),
    digitDistribution: digitDistribution(points, digits),
    repeats: repeatStats(points, digits),
    differences: differenceStats(points, digits),
    windows: windowStats(points, digits),
    moving: movingDigitFrequency(points, digits, mw),
    histogram: valueHistogram(points, digits),
    trend: points.map((p, i) => ({ date: p.date, value: numeric[i], movingAverage: ma[i] })),
  };
}
