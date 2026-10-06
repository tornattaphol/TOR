import type { PrizeType } from "../domain";

export interface ValuePoint {
  date: string;
  /** Fixed-length digit string for the selected prize type ("07", "702", "0702"). */
  value: string;
}

export interface Selection {
  prize: PrizeType;
  /** Keep only the most recent N draws (applied after the date range). */
  last?: number;
  from?: string;
  to?: string;
}

export interface FrequencyEntry {
  value: string;
  count: number;
  share: number;
}

export interface FrequencyTable {
  digits: number;
  total: number;
  /** Size of the space (10^digits). */
  possible: number;
  distinct: number;
  /** Observed numbers, count desc then value asc. Descriptive history only. */
  entries: FrequencyEntry[];
  mostFrequent: FrequencyEntry[];
  /** Among observed numbers: lowest counts first. */
  leastFrequent: FrequencyEntry[];
  /** 2-digit only: numbers never observed in the selection. */
  unobserved: string[] | null;
  /** 2-digit only: counts indexed by numeric value 0..99. */
  grid: number[] | null;
}

export interface ChiSquare {
  statistic: number;
  df: number;
  pValue: number;
  /** false when expected counts are < 5 and the χ² approximation is not reliable. */
  approximationValid: boolean;
}

export interface PositionDistribution {
  position: number;
  label: string;
  counts: number[];
  shares: number[];
  total: number;
  chiSquare: ChiSquare;
}

export interface DigitDistribution {
  positions: PositionDistribution[];
  overall: { counts: number[]; shares: number[]; total: number };
}

export interface RepeatStats {
  consecutive: {
    count: number;
    opportunities: number;
    rate: number;
    /** Rate if every draw were independent and uniform: 1 / 10^digits. */
    expectedRate: number;
    examples: { date: string; previousDate: string; value: string }[];
  };
  repeatedValues: { value: string; count: number; dates: string[] }[];
  distinctRepeated: number;
  doubleDigits: { count: number; share: number; expectedShare: number } | null;
  gaps: { count: number; min: number; median: number; mean: number; max: number } | null;
}

export interface DifferenceStats {
  series: { date: string; value: number; diff: number | null; absDiff: number | null }[];
  summary: { count: number; meanAbs: number; medianAbs: number; maxAbs: number; meanSigned: number; expectedMeanAbsUniform: number } | null;
  histogram: { label: string; from: number; to: number; count: number }[];
}

export interface WindowStat {
  size: number;
  /** false when fewer draws exist than the window size (stats then use all available draws). */
  complete: boolean;
  count: number;
  from: string | null;
  to: string | null;
  distinct: number;
  top: FrequencyEntry[];
  positions: PositionDistribution[];
}

export interface MovingSeries {
  window: number;
  positions: { position: number; label: string; points: ({ date: string } & Record<string, number | string>)[] }[];
}

export interface AnalyticsBundle {
  selection: {
    prize: PrizeType;
    digits: number;
    drawCount: number;
    firstDate: string | null;
    lastDate: string | null;
    last: number | null;
    from: string | null;
    to: string | null;
  };
  frequency: FrequencyTable;
  digitDistribution: DigitDistribution;
  repeats: RepeatStats;
  differences: DifferenceStats;
  windows: WindowStat[];
  moving: MovingSeries;
  histogram: { label: string; from: number; to: number; count: number; expected: number }[];
  trend: { date: string; value: number; movingAverage: number | null }[];
}
