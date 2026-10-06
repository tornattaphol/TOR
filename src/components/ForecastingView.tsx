"use client";

import { useMemo, useState } from "react";
import type { ForecastReport, ModelResult, TargetReport } from "@/lib/forecasting/types";
import { FORECAST_PURPOSE, REQUIRED_WARNING } from "@/lib/disclaimer";
import { fmtInt, fmtNumber, fmtP, fmtPercent, formatThaiDate } from "@/lib/format";
import { ChartCard, CumulativeAdvantageChart, ErrorHistogram, MODEL_COLORS, RollingMaeChart } from "./charts";
import { NextDrawSection } from "./NextDrawSection";
import { Async, Card, EmptyState, Pill, StatCard } from "./ui";
import { useApi } from "./useApi";
import { VERDICT } from "./verdict";

/** The backtest endpoint returns scores only; next-draw rankings come from their own endpoint. */
type BacktestReport = Omit<ForecastReport, "nextDraw">;

const MIN_TRAIN_OPTIONS = [30, 50, 70, 100];
const WINDOW_OPTIONS: { v: string; label: string }[] = [
  { v: "expanding", label: "สะสม (expanding)" },
  { v: "60", label: "เลื่อน 60 งวด" },
  { v: "100", label: "เลื่อน 100 งวด" },
];
const DEFAULT_SHOWN = ["frequency", "markov1", "autoregressive"];

export function ForecastingView() {
  const [minTrain, setMinTrain] = useState(50);
  const [win, setWin] = useState("expanding");
  const [targetId, setTargetId] = useState<string>("last2");
  const state = useApi<BacktestReport>(`/api/forecast/backtest?target=all&minTrain=${minTrain}&window=${win}`);

  return (
    <div className="space-y-6">
      <div role="alert" className="rounded-xl border-2 border-warning bg-surface px-4 py-3">
        <p className="text-base font-bold text-fg">
          <span aria-hidden>⚠ </span>
          {REQUIRED_WARNING}
        </p>
        <p className="mt-1 text-sm text-fg-2">{FORECAST_PURPOSE}</p>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-fg">
          ประเมินโมเดลทางสถิติ <Pill tone="warning">ทดลอง</Pill>
        </h1>
        <p className="mt-1 text-fg-2">
          ทดสอบย้อนหลังแบบ walk-forward: ทุกงวดทดสอบ โมเดลเห็นเฉพาะข้อมูลก่อนหน้างวดนั้นเท่านั้น แล้วนำไปเทียบกับผลจริงและกับการสุ่ม หน้านี้แสดงประสิทธิภาพของโมเดล ความไม่แน่นอน และอันดับเลขสำหรับงวดถัดไปจากโมเดลทดลอง โดยทุกอันดับแสดงคู่กับสถานะผลทดสอบย้อนหลังของโมเดลนั้นเสมอ
        </p>
      </div>

      <form onSubmit={(e) => e.preventDefault()} aria-label="ตั้งค่าการทดสอบ" className="flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-4">
        <label className="flex flex-col gap-1 text-sm text-fg-2">
          จำนวนงวดเริ่มต้นสำหรับฝึก
          <select value={minTrain} onChange={(e) => setMinTrain(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-surface px-2 text-fg">
            {MIN_TRAIN_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v} งวด
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg-2">
          หน้าต่างข้อมูลฝึก
          <select value={win} onChange={(e) => setWin(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-fg">
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <p className="max-w-md text-xs text-fg-3">การเปลี่ยนค่าตั้งต้นหลายแบบแล้วเลือกผลที่ดูดีที่สุดเป็นการ “เลือกผลตามใจ” (p-hacking) — ควรกำหนดค่าก่อนดูผล และดูภาพรวมทั้งหมด</p>
      </form>

      <Async state={state} isEmpty={(r) => r.status === "insufficient_data" && r.dataRange.draws === 0} height={360}>
        {(r) => (r.status === "insufficient_data" ? <InsufficientNotice r={r} /> : <Report r={r} targetId={targetId} setTargetId={setTargetId} minTrain={minTrain} win={win} />)}
      </Async>
    </div>
  );
}

function InsufficientNotice({ r }: { r: BacktestReport }) {
  return (
    <EmptyState title="ข้อมูลไม่เพียงพอสำหรับการทดสอบย้อนหลังที่เชื่อถือได้">
      {r.message}
    </EmptyState>
  );
}

function Report({ r, targetId, setTargetId, minTrain, win }: { r: BacktestReport; targetId: string; setTargetId: (t: string) => void; minTrain: number; win: string }) {
  const target = r.targets.find((t) => t.target === targetId) ?? r.targets[0];
  return (
    <div className="space-y-6">
      <Card title="สรุปผลการทดสอบ" subtitle={`ข้อมูล ${fmtInt(r.dataRange.draws)} งวด (${r.dataRange.from ? formatThaiDate(r.dataRange.from) : "—"} – ${r.dataRange.to ? formatThaiDate(r.dataRange.to) : "—"})`}>
        <p className="text-fg">{r.conclusion.summary}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="จำนวนชุดที่ทดสอบ" value={r.conclusion.testsCount} hint="โมเดล × เป้าหมาย (ไม่นับเกณฑ์สุ่ม)" />
          <StatCard label="ชุดที่ผ่านเกณฑ์หลังปรับค่า p" value={r.conclusion.evidenceCount} hint={`${r.multipleComparisons.method}, α = ${r.multipleComparisons.alpha}`} />
          <StatCard label="ที่คาดว่าจะ “ผ่าน” โดยบังเอิญ (ก่อนปรับ)" value={fmtNumber(r.multipleComparisons.expectedFalsePositivesUncorrected, 1)} hint="= จำนวนชุด × α เมื่อไม่มีสัญญาณจริง" />
        </div>
      </Card>

      <div role="tablist" aria-label="เป้าหมายการทดสอบ" className="flex flex-wrap gap-2">
        {r.targets.map((t) => (
          <button key={t.target} role="tab" type="button" aria-selected={t.target === target?.target} onClick={() => setTargetId(t.target)} className={`rounded-lg border px-3 py-1.5 text-sm ${t.target === target?.target ? "border-accent bg-accent-soft font-medium text-fg" : "border-line bg-surface text-fg-2 hover:bg-surface-2"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {target && <NextDrawSection backtest={target} minTrain={minTrain} win={win} />}

      {target && <TargetSection t={target} />}

      <Card title="ข้อจำกัดของโมเดลและการทดสอบ">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-2">
          {r.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ci(a: [number, number] | null, d = 3) {
  return a ? `${fmtNumber(a[0], d)} – ${fmtNumber(a[1], d)}` : "—";
}

function TargetSection({ t }: { t: TargetReport }) {
  const real = t.models.filter((m) => m.modelId !== "uniform");
  const [shown, setShown] = useState<string[]>(DEFAULT_SHOWN);
  const [focus, setFocus] = useState<string>("frequency");
  const okModels = real.filter((m) => m.status === "ok");
  const focusModel: ModelResult | undefined = okModels.find((m) => m.modelId === focus) ?? okModels[0];

  const cumRows = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string>>();
    for (const m of okModels) {
      if (!shown.includes(m.modelId)) continue;
      for (const p of m.series.cumulativeLogLossAdvantage) {
        const row = byDate.get(p.date) ?? { date: p.date };
        row[m.modelId] = p.value;
        byDate.set(p.date, row);
      }
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [okModels, shown]);

  const toggle = (id: string) => setShown((cur) => (cur.includes(id) ? (cur.length > 1 ? cur.filter((x) => x !== id) : cur) : cur.length >= 3 ? [...cur.slice(1), id] : [...cur, id]));

  return (
    <div className="space-y-6">
      <Card title={`ผลการทดสอบ: ${t.label}`} subtitle={`ทดสอบย้อนหลัง ${t.testSteps} งวด (ฝึกเริ่มต้น ${t.initialTrain} งวด) · เกณฑ์สุ่ม: accuracy ${fmtPercent(t.baseline.accuracy, 1)}, log-loss ${fmtNumber(t.baseline.logLoss, 3)}, MAE ${fmtNumber(t.baseline.mae, 2)}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <caption className="sr-only">ประสิทธิภาพของแต่ละโมเดลเทียบกับการสุ่ม</caption>
            <thead>
              <tr className="border-b border-line text-left text-fg-2">
                {["โมเดล", "งวดที่ทดสอบ", "Accuracy (ช่วงเชื่อมั่น 95%)", "Log-loss", "ได้เปรียบสุ่ม Δ log-loss (ช่วงเชื่อมั่น 95%)", "p ปรับ Holm", "MAE", "สรุป"].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.models.map((m) => {
                const v = VERDICT[m.verdict];
                return (
                  <tr key={m.modelId} className="border-b border-line/60 align-top last:border-0">
                    <th scope="row" className="px-2 py-2 text-left font-medium text-fg">
                      <span className="inline-flex items-center gap-2">
                        {m.modelId !== "uniform" && <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MODEL_COLORS[m.modelId] }} />}
                        {m.name}
                      </span>
                    </th>
                    {m.status === "ok" ? (
                      <>
                        <td className="tabular px-2 py-2">{m.nTest}</td>
                        <td className="tabular px-2 py-2">
                          {fmtPercent(m.accuracy, 1)}
                          {m.modelId !== "uniform" && <span className="block text-xs text-fg-3">{ci(m.accuracyCI ? [m.accuracyCI[0] * 100, m.accuracyCI[1] * 100] : null, 1)}% · p ปรับ {fmtP(m.accuracyAdjustedPValue)}</span>}
                        </td>
                        <td className="tabular px-2 py-2">{fmtNumber(m.logLoss, 3)}</td>
                        <td className="tabular px-2 py-2">
                          {m.modelId === "uniform" ? "0 (อ้างอิง)" : fmtNumber(m.logLossAdvantage, 3)}
                          {m.modelId !== "uniform" && <span className="block text-xs text-fg-3">{ci(m.logLossAdvantageCI)}</span>}
                        </td>
                        <td className="tabular px-2 py-2">{m.modelId === "uniform" ? "—" : fmtP(m.logLossAdjustedPValue)}</td>
                        <td className="tabular px-2 py-2">{fmtNumber(m.mae, 2)}</td>
                      </>
                    ) : (
                      <td colSpan={6} className="px-2 py-2 text-xs text-fg-3">
                        {m.reason}
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <Pill tone={v.tone}>
                        <span aria-hidden className="mr-1">{v.icon}</span>
                        {v.label}
                      </Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-fg-3">
          Δ log-loss = log-loss ของการสุ่ม − log-loss ของโมเดล (ค่าบวก = ดีกว่าสุ่ม). ช่วงเชื่อมั่นจาก block bootstrap; ค่า p จาก sign-flip permutation test แบบทางเดียว ปรับด้วย Holm–Bonferroni ข้ามทุกโมเดลและเป้าหมาย.
          “มีหลักฐาน” ต้องมี p ปรับแล้ว &lt; 0.05 และช่วงเชื่อมั่นไม่คร่อม 0 พร้อมกัน
        </p>
      </Card>

      {okModels.length > 0 && (
        <>
          <ChartCard
            title="ความคลาดเคลื่อนสะสมเทียบกับการสุ่ม (log-loss)"
            description="ผลรวมของ (log-loss สุ่ม − log-loss โมเดล) ตลอดช่วงทดสอบ: เส้นที่ลอยเหนือ 0 อย่างต่อเนื่อง = ดีกว่าสุ่ม; เส้นที่แกว่งรอบ 0 = ไม่ต่างจากสุ่ม"
            table={{ head: ["วันที่", ...okModels.filter((m) => shown.includes(m.modelId)).map((m) => m.name)], rows: cumRows.map((r) => [String(r.date), ...okModels.filter((m) => shown.includes(m.modelId)).map((m) => (r[m.modelId] === undefined ? "—" : fmtNumber(Number(r[m.modelId]), 3)))]) }}
          >
            <fieldset className="mb-3 flex flex-wrap items-center gap-2">
              <legend className="sr-only">เลือกโมเดลที่จะแสดง (สูงสุด 3)</legend>
              <span className="text-sm text-fg-2">โมเดล (สูงสุด 3):</span>
              {okModels.map((m) => (
                <button key={m.modelId} type="button" aria-pressed={shown.includes(m.modelId)} onClick={() => toggle(m.modelId)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${shown.includes(m.modelId) ? "border-accent bg-accent-soft font-medium text-fg" : "border-line bg-surface text-fg-2 hover:bg-surface-2"}`}>
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MODEL_COLORS[m.modelId] }} />
                  {m.name}
                </button>
              ))}
            </fieldset>
            <CumulativeAdvantageChart rows={cumRows} models={okModels.filter((m) => shown.includes(m.modelId)).map((m) => ({ id: m.modelId, name: m.name }))} />
          </ChartCard>

          {focusModel && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex min-w-0 flex-wrap items-center gap-2 text-fg-2">
                  ดูกราฟความคลาดเคลื่อนของโมเดล
                  <select value={focusModel.modelId} onChange={(e) => setFocus(e.target.value)} className="h-9 max-w-full rounded-lg border border-line bg-surface px-2 text-fg">
                    {okModels.map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title="ความคลาดเคลื่อนสัมบูรณ์เฉลี่ยแบบเลื่อน (MAE, 20 งวด)" description="|ค่าที่โมเดลเลือก − ค่าจริง| เทียบกับค่าคาดหวังของการเดาแบบสุ่ม" table={{ head: ["วันที่", "โมเดล", "สุ่ม"], rows: focusModel.series.rollingMae.map((p) => [p.date, fmtNumber(p.model, 2), fmtNumber(p.baseline, 2)]) }}>
                  <RollingMaeChart points={focusModel.series.rollingMae} />
                </ChartCard>
                <ChartCard title="การกระจายของขนาดความคลาดเคลื่อน" description="สัดส่วนของงวดทดสอบในแต่ละช่วงความคลาดเคลื่อน เทียบกับการเดาแบบสุ่ม" table={{ head: ["ช่วง", "โมเดล", "สุ่ม (คาดหวัง)"], rows: focusModel.errorHistogram.map((b) => [b.label, fmtPercent(b.model), fmtPercent(b.expectedRandom)]) }}>
                  <ErrorHistogram bins={focusModel.errorHistogram} />
                </ChartCard>
              </div>
              <Card title={`ข้อจำกัด: ${focusModel.name}`} as="div">
                <p className="text-sm text-fg-2">{focusModel.description}</p>
                <p className="mt-2 text-sm text-fg-2">
                  <strong className="text-fg">ข้อจำกัด:</strong> {focusModel.limitations}
                </p>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
