import { digitDistribution, frequencyTable, positionLabels } from "./core";
import type { MovingSeries, ValuePoint, WindowStat } from "./types";

export const WINDOW_SIZES = [10, 20, 50, 100] as const;

/** Statistics over the most recent N draws, for N in `sizes`. */
export function windowStats(points: ValuePoint[], digits: number, sizes: readonly number[] = WINDOW_SIZES): WindowStat[] {
  return sizes.map((size) => {
    const slice = points.slice(Math.max(0, points.length - size));
    const freq = frequencyTable(slice, digits, 5);
    return {
      size,
      complete: points.length >= size,
      count: slice.length,
      from: slice[0]?.date ?? null,
      to: slice[slice.length - 1]?.date ?? null,
      distinct: freq.distinct,
      top: freq.mostFrequent,
      positions: digitDistribution(slice, digits).positions,
    };
  });
}

/**
 * Rolling share of each digit 0–9 per position over a trailing window of `window` draws.
 * A point is emitted only once a full window is available (no look-ahead, no padding).
 */
export function movingDigitFrequency(points: ValuePoint[], digits: number, window: number): MovingSeries {
  const labels = positionLabels(digits);
  const positions: MovingSeries["positions"] = [];
  for (let pos = 0; pos < digits; pos++) {
    const counts = new Array<number>(10).fill(0);
    const rows: MovingSeries["positions"][number]["points"] = [];
    for (let i = 0; i < points.length; i++) {
      counts[points[i].value.charCodeAt(pos) - 48]++;
      if (i >= window) counts[points[i - window].value.charCodeAt(pos) - 48]--;
      if (i >= window - 1) {
        const row: { date: string } & Record<string, number | string> = { date: points[i].date };
        for (let d = 0; d < 10; d++) row[`d${d}`] = counts[d] / window;
        rows.push(row);
      }
    }
    positions.push({ position: pos, label: labels[pos] ?? `หลักที่ ${pos + 1}`, points: rows });
  }
  return { window, positions };
}

/** Trailing simple moving average; null until a full window exists. */
export function movingAverage(values: readonly number[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  let acc = 0;
  for (let i = 0; i < values.length; i++) {
    acc += values[i];
    if (i >= window) acc -= values[i - window];
    out.push(i >= window - 1 ? acc / window : null);
  }
  return out;
}
