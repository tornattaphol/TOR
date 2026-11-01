/**
 * Ranking helpers shared by the backtest (which scores how often the truth was in a model's top-n) and the
 * next-draw report (which displays that same ranking). Using one implementation guarantees that the hit rates
 * we report describe exactly the lists we show.
 */

/** Probabilities are compared at 1e-12 resolution so equal counts (equal floats) are exact ties. */
const SCALE = 1e12;

const keyOf = (p: readonly number[]): number[] => p.map((v) => Math.round(v * SCALE));

/** Class indices ordered best-first; equal probabilities are ordered by value, ascending. */
export function orderByProbability(p: readonly number[]): number[] {
  const key = keyOf(p);
  return p.map((_, i) => i).sort((a, b) => key[b] - key[a] || a - b);
}

/** 1-based position of `value` in {@link orderByProbability}`(p)` — O(K), no sort. */
export function positionOf(p: readonly number[], value: number): number {
  const key = keyOf(p);
  const target = key[value];
  let pos = 1;
  for (let k = 0; k < key.length; k++) if (key[k] > target || (key[k] === target && k < value)) pos++;
  return pos;
}

/** Competition ranks (1,2,2,4…) for an ordered list; `tied` marks members of a tie group. */
export function competitionRanks(p: readonly number[], order: readonly number[]): { rank: number; tied: boolean }[] {
  const key = keyOf(p);
  const out: { rank: number; tied: boolean }[] = [];
  let rank = 1;
  for (let i = 0; i < order.length; i++) {
    if (i > 0 && key[order[i]] !== key[order[i - 1]]) rank = i + 1;
    out.push({ rank, tied: false });
  }
  for (let i = 0; i < order.length; i++) {
    const t = (i > 0 && out[i - 1].rank === out[i].rank) || (i < order.length - 1 && out[i + 1].rank === out[i].rank);
    out[i].tied = t;
  }
  return out;
}

/** Size of a model's "shortlist": the top 10 of 100 values, or the top 3 of 10 digits. */
export const shortlistSize = (K: number): number => (K >= 50 ? 10 : 3);

/** Cut-offs n for which the backtest reports the top-n hit rate. */
export const rankCutoffs = (K: number): number[] => (K >= 50 ? [1, 5, 10, 20] : [1, 3, 5]).filter((n) => n < K);

/** Display form of a value: two digits for the 100-value target, one digit otherwise. */
export const valueLabel = (value: number, K: number): string => String(value).padStart(K >= 100 ? 2 : 1, "0");
