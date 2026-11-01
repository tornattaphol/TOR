import { mulberry32 } from "../math";
import { positionOf } from "./ranking";
import type { BacktestConfig, ModelSpec } from "./types";

export interface ScoredStep {
  /** index into the observation sequence of the draw being scored (its outcome is already known) */
  index: number;
  date: string;
  actual: number;
  /** probability the model assigned to the actual outcome, before seeing it */
  pActual: number;
  /** most probable class according to the model (ties → smallest value) */
  argmax: number;
  /** 1-based position of the actual outcome in the model's ranking, computed before seeing it */
  rank: number;
}

export interface BacktestRun {
  status: "ok" | "insufficient_data";
  reason: string | null;
  steps: ScoredStep[];
}

/** Rank-1 class — same tie resolution as {@link positionOf}, so `argmax === actual` ⇔ `rank === 1`. */
function argmax(p: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < p.length; i++) if (Math.round(p[i] * 1e12) > Math.round(p[best] * 1e12)) best = i;
  return best;
}

/**
 * Walk-forward backtest. For each test index t the model sees ONLY y[0..t-1] (expanding window, or the last
 * `trainWindow` observations). It is then scored against the realised y[t]. Because the slice handed to the
 * model physically excludes y[t..], leakage of future data is impossible by construction.
 */
export function runBacktest(spec: ModelSpec, y: readonly number[], dates: readonly string[], K: number, cfg: BacktestConfig): BacktestRun {
  const need = Math.max(spec.minTrain(K), 0);
  const learner = spec.create(K);
  const steps: ScoredStep[] = [];
  let lastFit = -Infinity;

  for (let t = cfg.minTrain; t < y.length; t++) {
    const start = cfg.trainWindow ? Math.max(0, t - cfg.trainWindow) : 0;
    const history = Object.freeze(y.slice(start, t));
    if (history.length < need) continue; // abstain: not enough training data for this model yet

    if (t - lastFit >= cfg.refitEvery) {
      learner.fit(history);
      lastFit = t;
    }
    const rng = mulberry32(cfg.seed + t * 7919);
    const p = learner.predict(history, rng);
    if (p.length !== K || p.some((v) => !Number.isFinite(v) || v < 0)) {
      throw new Error(`Model ${spec.id} returned an invalid distribution at step ${t}`);
    }
    const total = p.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > 1e-6) throw new Error(`Model ${spec.id} distribution sums to ${total}, expected 1`);
    steps.push({ index: t, date: dates[t], actual: y[t], pActual: Math.max(p[y[t]], 1e-12), argmax: argmax(p), rank: positionOf(p, y[t]) });
  }

  if (steps.length === 0) {
    return {
      status: "insufficient_data",
      reason: `ต้องใช้ข้อมูลฝึกอย่างน้อย ${need} งวด แต่มีเพียง ${Math.max(0, y.length - 1)} งวด (เป้าหมาย ${K} คลาส)`,
      steps,
    };
  }
  return { status: "ok", reason: null, steps };
}
