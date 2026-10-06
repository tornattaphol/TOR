import { addDays, weekdayOf } from "../dates";
import { mulberry32 } from "../math";
import { competitionRanks, orderByProbability, shortlistSize, valueLabel } from "./ranking";
import type { BacktestConfig, ModelNextDraw, ModelResult, ModelSpec, NextDrawReport, RankedValue, TargetId, TargetNextDraw, TargetReport } from "./types";

export interface TargetDef {
  id: TargetId;
  label: string;
  classes: number;
  project: (v: number) => number;
}

export interface NextDrawOptions {
  /** Block-bootstrap resamples used for the uncertainty of each ranked value (min 20). */
  resamples: number;
  /** Weekdays (0 = Sunday) on which draws are scheduled; used only to label the next scheduled date. */
  expectedWeekdays: number[];
  /** Calendar "today" (for flagging a stale dataset); null = don't check. */
  today: string | null;
}

export const DEFAULT_NEXT_DRAW: NextDrawOptions = { resamples: 200, expectedWeekdays: [1, 3, 5], today: null };

/** The ML model is refit on every resample, which is costly; cap its resamples. */
const ML_RESAMPLE_CAP = 30;

export const NEXT_DRAW_NOTES: string[] = [
  "อันดับนี้เป็นผลลัพธ์ของโมเดลทดลองที่ฝึกจากงวดที่ผ่านมาทั้งหมด ไม่ใช่การรับประกันหรือคำแนะนำให้ซื้อ/เดิมพัน",
  "ดูสถานะผลทดสอบย้อนหลัง (verdict) ของโมเดลที่สร้างอันดับนั้นเสมอ — ถ้าไม่พบหลักฐานว่าดีกว่าการสุ่ม อันดับนี้ไม่ต่างจากการเลือกเลขแบบสุ่มทางสถิติ",
  "ความน่าจะเป็นที่โมเดลให้เกือบเท่า 1/K ทุกค่า (distanceFromUniform ใกล้ 0) แปลว่าโมเดลแยกแยะแต่ละค่าไม่ได้ ลำดับที่เห็นมาจากความผันผวนของข้อมูลตัวอย่าง",
  "ค่าที่ความน่าจะเป็นเท่ากันจัดอันดับร่วมกัน (tied) และเรียงตามค่าตัวเลขเพื่อให้ผลคงที่เท่านั้น ไม่ได้มีนัยทางสถิติ",
  "การเลือก “โมเดลที่ได้ผลย้อนหลังดีที่สุด” เป็นการเลือกจากผลที่ผ่านมา จึงมีแนวโน้มดูดีเกินจริง (winner’s curse) โดยเฉพาะเมื่อทดสอบหลายโมเดล",
  "โมเดลที่ข้อมูลฝึกไม่พอจะไม่แสดงอันดับ (insufficient_data) แทนที่จะแสดงผลที่ไม่น่าเชื่อถือ",
];

export const SELECTION_RULE =
  "โมเดลที่มีค่า Δ log-loss ย้อนหลังสูงสุดในกลุ่มที่มีข้อมูลทดสอบเพียงพอ (เลือกจากผลย้อนหลัง จึงอาจดูดีเกินจริง — ดูสถานะหลักฐานประกอบเสมอ)";

/** First scheduled draw date strictly after `latest` (null when no weekdays are configured). */
export function nextScheduledDate(latest: string, weekdays: readonly number[]): string | null {
  if (weekdays.length === 0) return null;
  const set = new Set(weekdays);
  for (let i = 1; i <= 7; i++) {
    const d = addDays(latest, i);
    if (set.has(weekdayOf(d))) return d;
  }
  return null;
}

/**
 * Moving-block bootstrap of the TRAINING history. The two most recent real observations are kept verbatim at
 * the end so models that condition on the latest draws (Markov, AR, ML) predict from the true context; only
 * the data they learn from is resampled.
 */
function resampleHistory(h: readonly number[], rng: () => number): number[] {
  const tail = Math.min(2, h.length);
  const body = h.slice(0, h.length - tail);
  const m = body.length;
  if (m < 2) return h.slice();
  const L = Math.max(1, Math.min(m, Math.ceil(Math.cbrt(m))));
  const out: number[] = [];
  while (out.length < m) {
    const start = Math.floor(rng() * (m - L + 1));
    for (let j = 0; j < L && out.length < m; j++) out.push(body[start + j]);
  }
  return [...out, ...h.slice(h.length - tail)];
}

function percentile(sortedAsc: readonly number[], q: number): number {
  const idx = (sortedAsc.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function checkDistribution(specId: string, p: readonly number[], K: number): void {
  if (p.length !== K || p.some((v) => !Number.isFinite(v) || v < 0)) throw new Error(`Model ${specId} returned an invalid distribution for the next draw`);
  const total = p.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-6) throw new Error(`Model ${specId} next-draw distribution sums to ${total}, expected 1`);
}

function insufficient(spec: ModelSpec, bt: ModelResult | undefined, reason: string): ModelNextDraw {
  return {
    modelId: spec.id,
    name: spec.name,
    family: spec.family,
    status: "insufficient_data",
    reason,
    verdict: bt?.verdict ?? "insufficient_data",
    logLossAdvantage: bt?.logLossAdvantage ?? null,
    bootstrapResamples: 0,
    distanceFromUniform: null,
    ranking: [],
  };
}

function rankModel(spec: ModelSpec, history: readonly number[], K: number, cfg: BacktestConfig, bt: ModelResult | undefined, resamples: number, seed: number): ModelNextDraw {
  const need = Math.max(spec.minTrain(K), 0);
  if (history.length < need) return insufficient(spec, bt, `ต้องใช้ข้อมูลฝึกอย่างน้อย ${need} งวด แต่มี ${history.length} งวด (เป้าหมาย ${K} คลาส)`);

  const frozen = Object.freeze(history.slice());
  const learner = spec.create(K);
  learner.fit(frozen);
  const p = learner.predict(frozen, mulberry32(seed));
  checkDistribution(spec.id, p, K);

  // uncertainty: refit on block-bootstrap resamples of the training history
  const B = spec.family === "machine-learning" ? Math.min(resamples, ML_RESAMPLE_CAP) : resamples;
  const short = shortlistSize(K);
  const draws: number[][] = Array.from({ length: K }, () => []);
  const inShortlist = new Array<number>(K).fill(0);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  for (let b = 0; b < B; b++) {
    const h = resampleHistory(frozen, rng);
    const l = spec.create(K);
    l.fit(h);
    const pb = l.predict(h, mulberry32(seed + 1 + b));
    for (let k = 0; k < K; k++) draws[k].push(pb[k]);
    for (const k of orderByProbability(pb).slice(0, short)) inShortlist[k]++;
  }
  const intervals = draws.map((d) => {
    const s = d.slice().sort((a, b) => a - b);
    return [percentile(s, 0.05), percentile(s, 0.95)] as [number, number];
  });

  const order = orderByProbability(p);
  const ranks = competitionRanks(p, order);
  const ranking: RankedValue[] = order.map((value, i) => ({
    rank: ranks[i].rank,
    tied: ranks[i].tied,
    value,
    label: valueLabel(value, K),
    probability: p[value],
    vsRandom: p[value] * K,
    interval: intervals[value],
    shortlistShare: inShortlist[value] / B,
  }));

  return {
    modelId: spec.id,
    name: spec.name,
    family: spec.family,
    status: "ok",
    reason: null,
    verdict: bt?.verdict ?? "insufficient_data",
    logLossAdvantage: bt?.logLossAdvantage ?? null,
    bootstrapResamples: B,
    distanceFromUniform: 0.5 * p.reduce((s, v) => s + Math.abs(v - 1 / K), 0),
    ranking,
  };
}

/** Keeps only the best `top` values of every ranking (the full ranking stays in the cached report). */
export function trimNextDraw(nd: NextDrawReport, top: number): NextDrawReport {
  return { ...nd, targets: nd.targets.map((t) => ({ ...t, models: t.models.map((m) => ({ ...m, ranking: m.ranking.slice(0, top) })) })) };
}

/**
 * Fits every (non-reference) model on ALL known draws and ranks the values of each target for the next draw.
 * Deterministic for a given dataset/config (fixed seeds). Each model's ranking carries that model's backtest
 * verdict, so a ranking is never produced without its evidence status.
 */
export function buildNextDraw(args: {
  dates: readonly string[];
  /** 2-digit results as integers 0–99, aligned with `dates` */
  values: readonly number[];
  targets: readonly TargetDef[];
  specs: readonly ModelSpec[];
  /** backtest results (same targets) used for verdicts and for choosing the headline model */
  reports: readonly TargetReport[];
  cfg: BacktestConfig;
  opts: NextDrawOptions;
}): NextDrawReport {
  const { dates, values, targets, specs, reports, cfg, opts } = args;
  const resamples = Math.max(20, Math.floor(opts.resamples));
  const latest = dates[dates.length - 1];
  const next = nextScheduledDate(latest, opts.expectedWeekdays);

  const out: TargetNextDraw[] = targets.map((target, ti) => {
    const K = target.classes;
    const y = values.map(target.project);
    const history = cfg.trainWindow ? y.slice(Math.max(0, y.length - cfg.trainWindow)) : y;
    const report = reports.find((r) => r.target === target.id);
    const models: ModelNextDraw[] = specs
      .filter((s) => s.id !== "uniform")
      .map((spec, mi) => rankModel(spec, history, K, cfg, report?.models.find((m) => m.modelId === spec.id), resamples, cfg.seed + 777 + ti * 1009 + mi * 31));

    // headline model: best backtest Δ log-loss among models with a real verdict (enough test steps)
    let best: ModelNextDraw | null = null;
    for (const m of models) {
      if (m.status !== "ok" || m.verdict === "insufficient_data" || m.logLossAdvantage === null) continue;
      if (!best || m.logLossAdvantage > (best.logLossAdvantage as number)) best = m;
    }
    return { target: target.id, label: target.label, classes: K, shortlistSize: shortlistSize(K), recommendedModelId: best?.modelId ?? null, selectionRule: SELECTION_RULE, models };
  });

  return {
    basedOnDraws: dates.length,
    latestDrawDate: latest,
    nextScheduledDate: next,
    scheduledDatePassed: next !== null && opts.today !== null && next < opts.today,
    bootstrapResamples: resamples,
    targets: out,
    notes: NEXT_DRAW_NOTES,
  };
}
