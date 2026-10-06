"use client";

import { useState } from "react";
import { RANKING_STATUS_TEXT } from "@/lib/disclaimer";
import type { ModelNextDraw, NextDrawReport, RankedValue, TargetNextDraw, TargetReport } from "@/lib/forecasting/types";
import { fmtInt, fmtNumber, fmtPercent, formatThaiDate } from "@/lib/format";
import { MODEL_COLORS } from "./charts";
import { Async, Card, EmptyState, Pill } from "./ui";
import { useApi } from "./useApi";
import { VERDICT } from "./verdict";

interface NextDrawPayload {
  status: "ok" | "insufficient_data";
  message: string | null;
  nextDraw: NextDrawReport | null;
}

const SIZE_OPTIONS = [10, 20, 50, 100];

/**
 * Experimental next-draw ranking. Every list is rendered together with the backtest verdict of the model that
 * produced it (status banner + hit-rate evidence), so the ranking is never shown without its evidence status.
 */
export function NextDrawSection({ backtest, minTrain, win }: { backtest: TargetReport; minTrain: number; win: string }) {
  // One request for all targets with the full ranking; the server shares its cache with the backtest request.
  const state = useApi<NextDrawPayload>(`/api/forecast/next-draw?target=all&top=100&minTrain=${minTrain}&window=${win}`);
  return (
    <Async state={state} isEmpty={(d) => d.nextDraw === null} empty={<EmptyState title="ยังไม่มีอันดับจากโมเดล">ข้อมูลไม่เพียงพอสำหรับการสร้างอันดับอย่างน่าเชื่อถือ</EmptyState>} height={220}>
      {(d) => {
        const nd = d.nextDraw as NextDrawReport;
        const t = nd.targets.find((x) => x.target === backtest.target);
        return t ? <TargetRanking nd={nd} t={t} backtest={backtest} /> : null;
      }}
    </Async>
  );
}

function TargetRanking({ nd, t, backtest }: { nd: NextDrawReport; t: TargetNextDraw; backtest: TargetReport }) {
  const [pick, setPick] = useState<string | null>(null);
  const [rows, setRows] = useState(10);

  const withData = t.models.filter((m) => m.status === "ok");
  const chosen: ModelNextDraw | undefined = withData.find((m) => m.modelId === (pick ?? t.recommendedModelId)) ?? withData.find((m) => m.modelId === t.recommendedModelId) ?? withData[0];
  const isHeadline = chosen?.modelId === t.recommendedModelId;

  return (
    <div className="space-y-6">
      <Card
        title={
          <>
            เลขแนะนำจากโมเดล (ทดลอง) <Pill tone="warning">ไม่ใช่คำแนะนำให้ซื้อ</Pill>
          </>
        }
        subtitle={`${t.label} · สำหรับงวดถัดจาก ${formatThaiDate(nd.latestDrawDate)}${nd.nextScheduledDate ? ` (กำหนดออกครั้งถัดไป ${formatThaiDate(nd.nextScheduledDate, { weekday: true })})` : ""} · ฝึกจาก ${fmtInt(nd.basedOnDraws)} งวด`}
      >
        {nd.scheduledDatePassed && (
          <p role="status" className="mb-3 rounded-lg border border-warning bg-surface-2 px-3 py-2 text-sm text-warning-ink">
            <span aria-hidden>▲ </span>วันที่ออกรางวัลถัดไปตามตารางผ่านไปแล้ว ข้อมูลอาจไม่เป็นปัจจุบัน — รีเฟรชข้อมูล (npm run ingest) ก่อนดูอันดับ
          </p>
        )}

        {!chosen ? (
          <EmptyState title="ยังไม่มีโมเดลที่มีข้อมูลเพียงพอสำหรับเป้าหมายนี้">เมื่อสะสมงวดมากขึ้น ระบบจะแสดงอันดับให้อัตโนมัติ</EmptyState>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-col gap-1 text-sm text-fg-2">
                โมเดลที่ใช้สร้างอันดับ
                <select value={chosen.modelId} onChange={(e) => setPick(e.target.value)} className="h-9 max-w-full rounded-lg border border-line bg-surface px-2 text-fg">
                  {withData.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.name}
                      {m.modelId === t.recommendedModelId ? " — ผลย้อนหลังดีที่สุด" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="max-w-xl text-xs text-fg-3">
                ค่าเริ่มต้นคือ{isHeadline ? "โมเดลนี้" : "โมเดลที่ผลย้อนหลังดีที่สุด"}: {t.selectionRule}
              </p>
            </div>

            <StatusBanner m={chosen} />

            <Shortlist t={t} m={chosen} />

            <HitRates t={t} m={chosen} backtest={backtest} />
          </div>
        )}
      </Card>

      {chosen && (
        <Card
          title="อันดับเลขที่โมเดลคาดว่าจะออก"
          subtitle={`${chosen.name} · จัดอันดับทุกค่าจากความน่าจะเป็นที่โมเดลให้ (เส้นประ = ความน่าจะเป็นแบบสุ่ม 1/${t.classes})`}
          actions={
            t.classes > 10 ? (
              <label className="flex items-center gap-2 text-sm text-fg-2">
                แสดง
                <select value={rows} onChange={(e) => setRows(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-surface px-2 text-fg">
                  {SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} อันดับ
                    </option>
                  ))}
                </select>
              </label>
            ) : null
          }
        >
          <StatusBanner m={chosen} compact />
          <RankingTable t={t} m={chosen} rows={Math.min(rows, chosen.ranking.length)} />
          <details className="mt-4 text-sm text-fg-2">
            <summary className="cursor-pointer font-medium text-fg">วิธีอ่านอันดับ และข้อควรระวัง</summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                ช่วง 5–95%: ช่วงที่ความน่าจะเป็นของค่านั้นเปลี่ยนไปเมื่อสุ่มข้อมูลฝึกซ้ำ ({fmtInt(chosen.bootstrapResamples)} รอบ แบบ block bootstrap) — ช่วงกว้างหรือคร่อมค่าสุ่ม แปลว่าอันดับนั้นไม่เสถียร
              </li>
              <li>
                “ติดกลุ่มต้น”: สัดส่วนของการสุ่มซ้ำที่ค่านั้นยังอยู่ใน {t.shortlistSize} อันดับแรก — ถ้าการแจกแจงเป็นสุ่มจริง ค่าเฉลี่ยของทุกค่าจะอยู่ราว {fmtPercent(t.shortlistSize / t.classes, 0)}
              </li>
              {nd.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        </Card>
      )}
    </div>
  );
}

function StatusBanner({ m, compact = false }: { m: ModelNextDraw; compact?: boolean }) {
  const v = VERDICT[m.verdict];
  const strong = m.verdict === "evidence_better_than_random";
  return (
    <div role="note" className={`rounded-lg border-2 px-3 py-2 ${strong ? "border-good" : m.verdict === "worse_than_random" ? "border-warning" : "border-line"} ${compact ? "mb-3 text-sm" : ""} bg-surface-2`}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
        สถานะผลทดสอบย้อนหลังของโมเดลนี้:
        <Pill tone={v.tone}>
          <span aria-hidden className="mr-1">
            {v.icon}
          </span>
          {v.label}
        </Pill>
      </p>
      <p className="mt-1 text-sm text-fg-2">{RANKING_STATUS_TEXT[m.verdict]}</p>
    </div>
  );
}

function Shortlist({ t, m }: { t: TargetNextDraw; m: ModelNextDraw }) {
  const top = m.ranking.slice(0, t.shortlistSize);
  const tiedAll = m.ranking.length > 0 && m.ranking.every((r) => r.rank === 1);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-fg">
        {t.shortlistSize} อันดับแรกตามโมเดล <span className="font-normal text-fg-3">(ความน่าจะเป็นแบบสุ่มต่อค่า = {fmtPercent(1 / t.classes, 1)})</span>
      </h3>
      {tiedAll ? (
        <p className="text-sm text-fg-2">โมเดลนี้ให้ความน่าจะเป็นเท่ากันทุกค่า จึงไม่มีอันดับที่แยกแยะได้</p>
      ) : (
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="เลขอันดับต้นของโมเดล">
          {top.map((r) => (
            <li key={r.value} className="min-w-0 rounded-lg border border-line bg-surface p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="tabular font-mono text-2xl font-semibold tracking-widest text-fg">{r.label}</span>
                <span className="text-xs text-fg-3">อันดับ {r.rank}{r.tied ? " (เท่ากัน)" : ""}</span>
              </div>
              <div className="tabular mt-1 text-sm text-fg">{fmtPercent(r.probability, 2)}</div>
              <div className="tabular text-xs text-fg-3">
                {fmtNumber(r.vsRandom, 2)}× ของสุ่ม · ช่วง {fmtPercent(r.interval[0], 1)}–{fmtPercent(r.interval[1], 1)}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-xs text-fg-3">
        ความต่างของการแจกแจงจากการสุ่ม (total variation): {m.distanceFromUniform === null ? "—" : fmtNumber(m.distanceFromUniform, 3)} — ยิ่งใกล้ 0 ยิ่งแยกจากการสุ่มไม่ออก
      </p>
    </div>
  );
}

function HitRates({ t, m, backtest }: { t: TargetNextDraw; m: ModelNextDraw; backtest: TargetReport }) {
  const res = backtest.models.find((x) => x.modelId === m.modelId);
  if (!res || res.status !== "ok" || res.rankHits.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-fg">หลักฐานย้อนหลังของอันดับนี้: ผลจริงเคยอยู่ใน Top-n ของโมเดลกี่ครั้ง</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <caption className="sr-only">อัตราที่ผลจริงอยู่ในอันดับต้นของโมเดลเมื่อทดสอบย้อนหลัง เทียบกับการเลือกแบบสุ่ม</caption>
          <thead>
            <tr className="border-b border-line text-left text-fg-2">
              {["Top-n", "ผลจริงอยู่ใน Top-n", "สุ่มได้ (n/K)", "ช่วงเชื่อมั่น 95%", "เทียบกับสุ่ม"].map((h) => (
                <th key={h} scope="col" className="px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.rankHits.map((h) => {
              const inside = h.ci[0] <= h.expected && h.expected <= h.ci[1];
              return (
                <tr key={h.n} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="tabular px-2 py-2 text-left font-medium text-fg">
                    Top-{h.n}
                  </th>
                  <td className="tabular px-2 py-2">
                    {fmtPercent(h.rate, 1)} <span className="text-xs text-fg-3">({h.hits}/{res.nTest} งวด)</span>
                  </td>
                  <td className="tabular px-2 py-2">{fmtPercent(h.expected, 1)}</td>
                  <td className="tabular px-2 py-2">
                    {fmtPercent(h.ci[0], 1)} – {fmtPercent(h.ci[1], 1)}
                  </td>
                  <td className="px-2 py-2">
                    <Pill tone={!inside && h.rate < h.expected ? "warning" : "neutral"}>
                      {inside ? "ไม่ต่างจากสุ่มอย่างชัดเจน" : h.rate > h.expected ? "สูงกว่าสุ่มในตัวอย่างนี้ (อาจบังเอิญ)" : "ต่ำกว่าสุ่ม"}
                    </Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-fg-3">
        ทดสอบย้อนหลัง {res.nTest} งวด (walk-forward) · {t.label}. คอลัมน์ “เทียบกับสุ่ม” เป็นเพียงคำอธิบาย: แต่ละแถวมีโอกาสราว 5% ที่จะดูสูงกว่าสุ่มโดยบังเอิญแม้ข้อมูลเป็นสุ่มล้วน (ตรวจสอบกับข้อมูลสุ่มสังเคราะห์แล้ว) และแถวเหล่านี้ทดสอบหลายโมเดล/เป้าหมาย/ค่า n พร้อมกันโดยไม่ปรับค่า — ใช้สถานะด้านบนซึ่งปรับแล้วเป็นข้อสรุปหลัก
      </p>
    </div>
  );
}

function RankingTable({ t, m, rows }: { t: TargetNextDraw; m: ModelNextDraw; rows: number }) {
  const list: RankedValue[] = m.ranking.slice(0, rows);
  const maxP = Math.max(...m.ranking.map((r) => r.probability), 1 / t.classes);
  const color = MODEL_COLORS[m.modelId] ?? "var(--s1)";
  const randomPct = ((1 / t.classes) / maxP) * 100;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">อันดับเลขตามความน่าจะเป็นที่โมเดล {m.name} ให้ พร้อมช่วงความไม่แน่นอน</caption>
        <thead>
          <tr className="border-b border-line text-left text-fg-2">
            {["อันดับ", "เลข", "ความน่าจะเป็นที่โมเดลให้", "ช่วง 5–95%", "เทียบสุ่ม", `ติดกลุ่มต้น (${t.shortlistSize} อันดับแรก)`].map((h) => (
              <th key={h} scope="col" className="px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.value} className="border-b border-line/60 last:border-0">
              <td className="tabular px-2 py-1.5">
                {r.rank}
                {r.tied && <span className="ml-1 text-xs text-fg-3">=</span>}
              </td>
              <th scope="row" className="tabular px-2 py-1.5 text-left font-mono font-semibold tracking-widest text-fg">
                {r.label}
              </th>
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <div aria-hidden className="relative h-2.5 w-28 shrink-0 rounded-sm bg-surface-2">
                    <div className="h-full rounded-sm" style={{ width: `${Math.max(1, (r.probability / maxP) * 100)}%`, background: color }} />
                    <div className="absolute inset-y-[-2px] border-l border-dashed border-fg-2" style={{ left: `${randomPct}%` }} />
                  </div>
                  <span className="tabular">{fmtPercent(r.probability, 2)}</span>
                </div>
              </td>
              <td className="tabular px-2 py-1.5 text-fg-2">
                {fmtPercent(r.interval[0], 2)} – {fmtPercent(r.interval[1], 2)}
              </td>
              <td className="tabular px-2 py-1.5">{fmtNumber(r.vsRandom, 2)}×</td>
              <td className="tabular px-2 py-1.5">{fmtPercent(r.shortlistShare, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
