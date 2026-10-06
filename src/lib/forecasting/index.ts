import type { DrawRecord } from "../domain";
import { FORECAST_PURPOSE, INDEPENDENCE_NOTE, REQUIRED_WARNING } from "../disclaimer";
import { runBacktest } from "./backtest";
import { baselineLogLoss, expectedRandomAbsError, scoreModel } from "./metrics";
import { MODEL_SPECS } from "./models";
import { buildNextDraw, DEFAULT_NEXT_DRAW, type NextDrawOptions } from "./nextdraw";
import { holmAdjust } from "./significance";
import {
  DEFAULT_BACKTEST,
  type BacktestConfig,
  type ForecastReport,
  type ModelResult,
  type ModelSpec,
  type TargetId,
  type TargetReport,
  type Verdict,
} from "./types";

export * from "./types";
export { MODEL_SPECS, getModelSpec } from "./models";
export { runBacktest } from "./backtest";
export { holmAdjust, signFlipPValue, blockBootstrapMeanCI } from "./significance";
export { buildNextDraw, trimNextDraw, nextScheduledDate, DEFAULT_NEXT_DRAW, type NextDrawOptions } from "./nextdraw";
export { orderByProbability, positionOf, competitionRanks, shortlistSize, rankCutoffs, valueLabel } from "./ranking";

export const TARGETS: { id: TargetId; label: string; classes: number; project: (v: number) => number }[] = [
  { id: "last2", label: "เลข 2 ตัวท้าย (100 ค่า)", classes: 100, project: (v) => v },
  { id: "tens", label: "หลักสิบของเลข 2 ตัว (0–9)", classes: 10, project: (v) => Math.floor(v / 10) },
  { id: "units", label: "หลักหน่วยของเลข 2 ตัว (0–9)", classes: 10, project: (v) => v % 10 },
];

export const MODEL_LIMITATIONS: string[] = [
  "จำนวนงวดที่มีน้อย (ประมาณร้อยงวด) ทำให้กำลังการทดสอบทางสถิติต่ำ — ความแตกต่างเล็กๆ ตรวจจับไม่ได้ และความแตกต่างที่ “ดูดี” อาจเกิดจากโชคได้ง่าย",
  "การไม่พบหลักฐานว่าโมเดลดีกว่าการสุ่ม ไม่ใช่การพิสูจน์ว่าไม่มีรูปแบบใดๆ — แต่เป็นสิ่งที่คาดได้หากผลเป็นการสุ่มที่ไม่ขึ้นต่อกัน",
  "การทดสอบหลายโมเดลหลายเป้าหมายพร้อมกันทำให้มีโอกาสเจอผลที่ “ดูมีนัยสำคัญ” โดยบังเอิญ ระบบจึงปรับค่า p ด้วยวิธี Holm–Bonferroni",
  "ขั้นตอนทดสอบค่อนข้างอนุรักษ์: โมเดลที่ประมาณจากข้อมูลจำกัดมักแย่กว่าการสุ่มเมื่อผลเป็นสุ่มจริง จึงตรวจจับได้เฉพาะรูปแบบที่ชัดเจนมาก ไม่ใช่ความเอนเอียงเล็กน้อย",
  "การทดสอบย้อนหลังประเมินเฉพาะความสามารถบนข้อมูลที่ผ่านมา ไม่ใช่การรับประกันผลในอนาคต",
  "ช่วงความเชื่อมั่นจาก block bootstrap เป็นการประมาณ และอาจแคบเกินไปเมื่อข้อมูลน้อย",
  INDEPENDENCE_NOTE,
];

export interface ExperimentOptions {
  config?: Partial<BacktestConfig>;
  targets?: TargetId[];
  models?: ModelSpec["id"][];
  /**
   * Opt-in: also fit the models on all known draws and rank the values for the next draw (`report.nextDraw`).
   * Omitted → `nextDraw` is null and the report contains scores only.
   */
  nextDraw?: Partial<NextDrawOptions>;
}

function verdictFor(r: Pick<ModelResult, "status" | "nTest" | "logLossAdvantage" | "logLossAdvantageCI" | "logLossAdjustedPValue">, cfg: BacktestConfig): Verdict {
  if (r.status !== "ok" || r.nTest < cfg.minTestSteps) return "insufficient_data";
  const ci = r.logLossAdvantageCI as [number, number];
  const adj = r.logLossAdjustedPValue ?? 1;
  if (adj < cfg.alpha && ci[0] > 0) return "evidence_better_than_random";
  if ((r.logLossAdvantage ?? 0) < 0 && ci[1] < 0) return "worse_than_random";
  return "no_evidence";
}

/**
 * Runs the full walk-forward evaluation on stored historical draws. `targets` holds scores and uncertainty
 * only; numbers for the next draw exist solely in `nextDraw` (opt-in), each ranking tied to its backtest verdict.
 */
export function runForecastExperiment(draws: DrawRecord[], opts: ExperimentOptions = {}): ForecastReport {
  const cfg: BacktestConfig = { ...DEFAULT_BACKTEST, ...opts.config };
  const sorted = [...draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const dates = sorted.map((d) => d.drawDate);
  const base = {
    config: cfg,
    limitations: MODEL_LIMITATIONS,
    disclaimer: `${REQUIRED_WARNING}. ${FORECAST_PURPOSE}`,
    dataRange: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, draws: sorted.length },
  };

  if (sorted.length < cfg.minTrain + cfg.minTestSteps) {
    return {
      ...base,
      status: "insufficient_data",
      message: `ข้อมูลไม่เพียงพอสำหรับการทดสอบย้อนหลังที่เชื่อถือได้: ต้องมีอย่างน้อย ${cfg.minTrain + cfg.minTestSteps} งวด (ฝึก ${cfg.minTrain} + ทดสอบ ${cfg.minTestSteps}) แต่มี ${sorted.length} งวด`,
      targets: [],
      nextDraw: null,
      multipleComparisons: { method: "Holm-Bonferroni", testsCount: 0, alpha: cfg.alpha, expectedFalsePositivesUncorrected: 0 },
      conclusion: { evidenceCount: 0, testsCount: 0, summary: "ยังไม่สามารถสรุปได้เนื่องจากข้อมูลไม่เพียงพอ" },
    };
  }

  const wantedTargets = TARGETS.filter((t) => !opts.targets || opts.targets.includes(t.id));
  const wantedModels = MODEL_SPECS.filter((m) => !opts.models || opts.models.includes(m.id) || m.id === "uniform");

  const values2 = sorted.map((d) => Number(d.result2));
  const targetReports: TargetReport[] = [];
  // collect p-values for Holm across ALL (target × non-reference model) tests that have enough data
  const testRefs: { ti: number; mi: number; p: number }[] = [];

  wantedTargets.forEach((target, ti) => {
    const y = values2.map(target.project);
    const K = target.classes;
    const models: ModelResult[] = wantedModels.map((spec, mi) => {
      const run = runBacktest(spec, y, dates, K, cfg);
      if (run.status === "insufficient_data") {
        return {
          modelId: spec.id,
          name: spec.name,
          family: spec.family,
          description: spec.description,
          limitations: spec.limitations,
          status: "insufficient_data",
          reason: run.reason,
          nTest: 0,
          accuracy: null,
          accuracyCI: null,
          accuracyPValue: null,
          accuracyAdjustedPValue: null,
          logLoss: null,
          logLossAdvantage: null,
          logLossAdvantageCI: null,
          logLossPValue: null,
          logLossAdjustedPValue: null,
          mae: null,
          maeAdvantage: null,
          rankHits: [],
          verdict: "insufficient_data",
          series: { cumulativeLogLossAdvantage: [], rollingMae: [] },
          errorHistogram: [],
        } satisfies ModelResult;
      }
      const scored = scoreModel({ spec, K, steps: run.steps, cfg, seedOffset: (ti + 1) * 1000 + mi * 31 });
      const res: ModelResult = { ...scored, status: "ok", reason: null, logLossAdjustedPValue: null, accuracyAdjustedPValue: null, verdict: "reference" };
      if (spec.id !== "uniform" && res.nTest >= cfg.minTestSteps) testRefs.push({ ti, mi, p: res.logLossPValue ?? 1 });
      return res;
    });

    const testSteps = sorted.length - cfg.minTrain;
    const tgtActual = y.slice(cfg.minTrain);
    targetReports.push({
      target: target.id,
      label: target.label,
      classes: K,
      observations: y.length,
      initialTrain: cfg.minTrain,
      testSteps,
      baseline: {
        accuracy: 1 / K,
        logLoss: baselineLogLoss(K),
        mae: tgtActual.reduce((s, a) => s + expectedRandomAbsError(K, a), 0) / tgtActual.length,
      },
      models,
    });
  });

  // Holm–Bonferroni across every test, then verdicts
  const adjusted = holmAdjust(testRefs.map((t) => t.p));
  const adjustedAcc = holmAdjust(testRefs.map((t) => targetReports[t.ti].models[t.mi].accuracyPValue ?? 1));
  testRefs.forEach((ref, k) => {
    const model = targetReports[ref.ti].models[ref.mi];
    model.logLossAdjustedPValue = adjusted[k];
    model.accuracyAdjustedPValue = adjustedAcc[k];
  });
  let evidence = 0;
  for (const tr of targetReports) {
    for (const m of tr.models) {
      if (m.modelId === "uniform") {
        m.verdict = "reference";
        continue;
      }
      m.verdict = verdictFor(m, cfg);
      if (m.verdict === "evidence_better_than_random") evidence++;
    }
  }

  const tests = testRefs.length;
  const summary =
    evidence === 0
      ? `ทดสอบ ${tests} ชุด (โมเดล × เป้าหมาย) หลังปรับค่า p แบบ Holm ไม่พบโมเดลใดที่ทำได้ดีกว่าการสุ่มอย่างมีนัยสำคัญทางสถิติ — สอดคล้องกับสมมติฐานว่าผลแต่ละงวดเป็นเหตุการณ์สุ่มที่ไม่ขึ้นต่อกัน (แต่ไม่ใช่การพิสูจน์ เพราะกำลังการทดสอบถูกจำกัดด้วยจำนวนงวด)`
      : `ทดสอบ ${tests} ชุด พบ ${evidence} ชุดที่ผ่านเกณฑ์ทางสถิติหลังปรับค่า p — ควรตรวจสอบซ้ำด้วยข้อมูลช่วงอื่นก่อนตีความ และผลนี้ไม่ได้หมายความว่าสามารถใช้ทำนายงวดถัดไปได้`;

  return {
    ...base,
    status: "ok",
    message: null,
    targets: targetReports,
    nextDraw: opts.nextDraw
      ? buildNextDraw({ dates, values: values2, targets: wantedTargets, specs: wantedModels, reports: targetReports, cfg, opts: { ...DEFAULT_NEXT_DRAW, ...opts.nextDraw } })
      : null,
    multipleComparisons: {
      method: "Holm-Bonferroni",
      testsCount: tests,
      alpha: cfg.alpha,
      expectedFalsePositivesUncorrected: Number((tests * cfg.alpha).toFixed(2)),
    },
    conclusion: { evidenceCount: evidence, testsCount: tests, summary },
  };
}
