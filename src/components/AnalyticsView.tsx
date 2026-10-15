"use client";

import { useState } from "react";
import type { AnalyticsBundle } from "@/lib/analytics/types";
import { fmtInt, fmtNumber, fmtP, fmtPercent, formatThaiDate } from "@/lib/format";
import { ChartCard, DiffHistogram, DigitBars, FrequencyGrid, HistogramBars, MovingFrequencyChart } from "./charts";
import { FilterBar, useFilters } from "./FilterBar";
import { Async, Card, DigitChip, DisclaimerBanner, EmptyState, Pill, StatCard, Table } from "./ui";
import { useApi } from "./useApi";
import { INDEPENDENCE_NOTE } from "@/lib/disclaimer";

const MOVING_WINDOWS = [5, 10, 20, 30];

export function AnalyticsView() {
  const { filters, query } = useFilters();
  const [mw, setMw] = useState(10);
  const [digits, setDigits] = useState<number[]>([0]);
  const state = useApi<AnalyticsBundle>(`/api/analytics?${query}&movingWindow=${mw}`);
  const prizeLabel = `เลข ${filters.prize} ตัว`;

  const toggleDigit = (d: number) =>
    setDigits((cur) => (cur.includes(d) ? (cur.length > 1 ? cur.filter((x) => x !== d) : cur) : cur.length >= 3 ? [...cur.slice(1), d] : [...cur, d]));

  return (
    <div className="space-y-6">
      <DisclaimerBanner />
      <div>
        <h1 className="text-2xl font-bold text-fg">วิเคราะห์สถิติย้อนหลังเชิงลึก</h1>
        <p className="mt-1 text-fg-2">ทุกตัวเลขในหน้านี้อธิบายสิ่งที่เคยเกิดขึ้นในช่วงข้อมูลที่เลือก — {INDEPENDENCE_NOTE}</p>
      </div>
      <FilterBar />

      <Async state={state} isEmpty={(a) => a.selection.drawCount === 0} empty={<EmptyState title="ไม่พบข้อมูลในช่วงที่เลือก">ลองขยายช่วงวันที่หรือเลือก “ทั้งหมด”</EmptyState>} height={360}>
        {(a) => {
          const f = a.frequency;
          const isTwo = a.selection.digits === 2;
          return (
            <div className="space-y-6">
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="ขอบเขตข้อมูล">
                <StatCard label={`จำนวนงวด (${prizeLabel})`} value={fmtInt(a.selection.drawCount)} />
                <StatCard label="ช่วงวันที่" value={<span className="text-base">{a.selection.firstDate ? `${formatThaiDate(a.selection.firstDate)} – ${formatThaiDate(a.selection.lastDate ?? a.selection.firstDate)}` : "—"}</span>} />
                <StatCard label="ค่าที่ไม่ซ้ำกัน" value={fmtInt(f.distinct)} hint={`จาก ${fmtInt(f.possible)} ค่า`} />
              </section>

              {/* 1. windows */}
              <Card title="สถิติย้อนหลัง 10 / 20 / 50 / 100 งวด" subtitle="ค่าที่พบบ่อยที่สุด 5 อันดับแรกของแต่ละช่วง (นับจากงวดล่าสุดย้อนไป)">
                <Table
                  caption="สถิติตามจำนวนงวดย้อนหลัง"
                  head={["ช่วง", "งวดที่มีข้อมูล", "ช่วงวันที่", "ค่าไม่ซ้ำ", "ค่าที่พบบ่อยที่สุดในช่วงนั้น (จำนวนครั้ง)"]}
                  rows={a.windows.map((w) => [
                    `${w.size} งวด`,
                    <span key="c">
                      {w.count} {!w.complete && <Pill tone="warning">ข้อมูลไม่ครบ {w.size} งวด</Pill>}
                    </span>,
                    w.from && w.to ? `${formatThaiDate(w.from)} – ${formatThaiDate(w.to)}` : "—",
                    w.distinct,
                    <span key="t" className="inline-flex flex-wrap gap-2">
                      {w.top.map((t) => (
                        <span key={t.value} className="inline-flex items-center gap-1">
                          <DigitChip value={t.value} />×{t.count}
                        </span>
                      ))}
                    </span>,
                  ])}
                />
              </Card>

              {/* 2. frequency */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title={isTwo ? "ความถี่ของเลข 2 ตัว 00–99" : `ความถี่ของ${prizeLabel}ที่เคยปรากฏ`} description={isTwo ? "ตารางสี 10×10: ยิ่งเข้ม = ปรากฏบ่อยในช่วงข้อมูลที่เลือก" : `ค่าที่เคยปรากฏ ${fmtInt(f.distinct)} ค่า (จากทั้งหมด ${fmtInt(f.possible)} ที่เป็นไปได้) — ส่วนใหญ่ปรากฏไม่เกิน 1–2 ครั้ง`}>
                  {f.grid ? (
                    <FrequencyGrid grid={f.grid} />
                  ) : (
                    <p className="text-sm text-fg-2">ค่าส่วนใหญ่ปรากฏเพียงครั้งเดียว ตารางความถี่ 10×10 จึงแสดงเฉพาะเลข 2 ตัว — ดูรายการค่าที่พบมาก/น้อยที่สุดทางขวา</p>
                  )}
                  {f.unobserved && (
                    <p className="mt-3 text-xs text-fg-3">
                      ค่าที่ไม่เคยปรากฏในช่วงนี้ {f.unobserved.length} ค่า{f.unobserved.length > 0 && f.unobserved.length <= 40 ? `: ${f.unobserved.join(", ")}` : ""}
                    </p>
                  )}
                </ChartCard>
                <Card title="ค่าที่พบมาก/น้อยในช่วงที่เลือก (นับย้อนหลัง)" subtitle="ความถี่ที่แตกต่างกันในตัวอย่างขนาดนี้ส่วนใหญ่เป็นความผันผวนตามธรรมชาติ ไม่ใช่สัญญาณ">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <h3 className="mb-1 text-sm font-medium text-fg-2">พบบ่อยที่สุด</h3>
                      <Table head={["ค่า", "ครั้ง", "สัดส่วน"]} rows={f.mostFrequent.map((e) => [<DigitChip key={e.value} value={e.value} />, e.count, fmtPercent(e.share)])} />
                    </div>
                    <div>
                      <h3 className="mb-1 text-sm font-medium text-fg-2">พบน้อยที่สุด (เฉพาะค่าที่เคยปรากฏ)</h3>
                      <Table head={["ค่า", "ครั้ง", "สัดส่วน"]} rows={f.leastFrequent.map((e) => [<DigitChip key={e.value} value={e.value} />, e.count, fmtPercent(e.share)])} />
                    </div>
                  </div>
                </Card>
              </div>

              {/* 3. digits */}
              <ChartCard
                title="การกระจายของเลข 0–9 แยกตามหลัก (หลักสิบ/หลักหน่วย ฯลฯ)"
                description="แต่ละกราฟนับจำนวนครั้งของเลข 0–9 ในหลักนั้น; เส้นประคือค่าคาดหวังเมื่อทุกเลขมีโอกาสเท่ากัน"
                table={{ head: ["หลัก", ...Array.from({ length: 10 }, (_, d) => String(d)), "χ² p-value"], rows: a.digitDistribution.positions.map((p) => [p.label, ...p.counts, fmtP(p.chiSquare.pValue)]) }}
              >
                <div className={`grid grid-cols-1 gap-4 ${a.digitDistribution.positions.length > 2 ? "sm:grid-cols-2" : "sm:grid-cols-2"}`}>
                  {a.digitDistribution.positions.map((p) => (
                    <div key={p.position}>
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-fg-2">{p.label}</span>
                        <span className="text-xs text-fg-3">
                          χ² = {fmtNumber(p.chiSquare.statistic, 1)} (df {p.chiSquare.df}), p = {fmtP(p.chiSquare.pValue)}
                          {!p.chiSquare.approximationValid && " · ตัวอย่างน้อย ค่า p ไม่น่าเชื่อถือ"}
                        </span>
                      </div>
                      <DigitBars position={p} />
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-fg-3">
                  ค่า p ของไคสแควร์ใช้ตรวจว่าการกระจายที่เห็นสอดคล้องกับการกระจายสม่ำเสมอหรือไม่ เมื่อทดสอบหลายหลักพร้อมกัน บางค่าอาจต่ำกว่า 0.05 ได้โดยบังเอิญ จึงไม่ใช่สัญญาณสำหรับการทำนายงวดถัดไป
                </p>
              </ChartCard>

              {/* 4. repeats */}
              <Card title="เลขซ้ำ" subtitle="การปรากฏซ้ำของค่าเดิมในช่วงข้อมูลที่เลือก">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <StatCard label="ออกซ้ำติดกัน 2 งวด" value={`${a.repeats.consecutive.count} / ${a.repeats.consecutive.opportunities}`} hint={`อัตรา ${fmtPercent(a.repeats.consecutive.rate, 2)} · คาดหวัง ${fmtPercent(a.repeats.consecutive.expectedRate, 2)}`} />
                  <StatCard label="ค่าที่ปรากฏซ้ำมากกว่า 1 ครั้ง" value={fmtInt(a.repeats.distinctRepeated)} hint="จำนวนค่าไม่ซ้ำที่เคยปรากฏอย่างน้อย 2 ครั้ง" />
                  {a.repeats.doubleDigits ? (
                    <StatCard label="เลขเบิ้ล (ทุกหลักเหมือนกัน)" value={`${a.repeats.doubleDigits.count} งวด`} hint={`${fmtPercent(a.repeats.doubleDigits.share)} · คาดหวัง ${fmtPercent(a.repeats.doubleDigits.expectedShare)}`} />
                  ) : (
                    <StatCard label="เลขเบิ้ล" value="—" />
                  )}
                </div>
                {a.repeats.gaps && (
                  <p className="mt-3 text-sm text-fg-2">
                    ระยะห่างระหว่างการปรากฏซ้ำของค่าเดิม (จำนวนงวด): ต่ำสุด {a.repeats.gaps.min}, มัธยฐาน {fmtNumber(a.repeats.gaps.median, 1)}, เฉลี่ย {fmtNumber(a.repeats.gaps.mean, 1)}, สูงสุด {a.repeats.gaps.max}
                  </p>
                )}
                {a.repeats.repeatedValues.length > 0 && (
                  <div className="mt-3">
                    <Table
                      caption="ค่าที่ปรากฏซ้ำ"
                      head={["ค่า", "จำนวนครั้ง", "วันที่ที่ปรากฏ"]}
                      rows={a.repeats.repeatedValues.map((r) => [<DigitChip key={r.value} value={r.value} />, r.count, <span key="d" className="text-xs text-fg-2">{r.dates.map((d) => formatThaiDate(d)).join(" · ")}</span>])}
                    />
                  </div>
                )}
              </Card>

              {/* 5. differences */}
              <ChartCard
                title="ผลต่างระหว่างงวด"
                description="|ค่างวดนี้ − ค่างวดก่อนหน้า| ของคู่งวดที่ติดกัน"
                table={a.differences.summary ? { head: ["ช่วงผลต่าง", "จำนวนคู่งวด"], rows: a.differences.histogram.map((b) => [b.label, b.count]) } : undefined}
              >
                {a.differences.summary ? (
                  <>
                    <div className="mb-3 grid gap-3 sm:grid-cols-4">
                      <StatCard label="ค่าเฉลี่ย |ผลต่าง|" value={fmtNumber(a.differences.summary.meanAbs, 1)} hint={`คาดหวังเมื่อสุ่มสม่ำเสมอ ≈ ${fmtNumber(a.differences.summary.expectedMeanAbsUniform, 1)}`} />
                      <StatCard label="มัธยฐาน |ผลต่าง|" value={fmtNumber(a.differences.summary.medianAbs, 1)} />
                      <StatCard label="สูงสุด |ผลต่าง|" value={fmtInt(a.differences.summary.maxAbs)} />
                      <StatCard label="ค่าเฉลี่ยผลต่างแบบมีเครื่องหมาย" value={fmtNumber(a.differences.summary.meanSigned, 2)} />
                    </div>
                    <DiffHistogram bins={a.differences.histogram} />
                  </>
                ) : (
                  <EmptyState title="ต้องมีอย่างน้อย 2 งวดจึงจะคำนวณผลต่างได้" />
                )}
              </ChartCard>

              {/* 6. moving frequency */}
              <ChartCard
                title="ความถี่แบบเคลื่อนที่ (Moving frequency)"
                description="สัดส่วนของเลขที่เลือกในหน้าต่างย้อนหลังที่เลื่อนไปทีละงวด — เลือกได้สูงสุด 3 เลข"
                table={{ head: ["วันที่", ...digits.map((d) => `เลข ${d}`)], rows: (a.moving.positions[a.moving.positions.length - 1]?.points ?? []).map((p) => [String(p.date), ...digits.map((d) => fmtPercent(Number(p[`d${d}`])))]) }}
              >
                <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <label className="flex items-center gap-2 text-fg-2">
                    หน้าต่าง
                    <select value={mw} onChange={(e) => setMw(Number(e.target.value))} className="h-9 rounded-lg border border-line bg-surface px-2 text-fg">
                      {MOVING_WINDOWS.map((w) => (
                        <option key={w} value={w}>
                          {w} งวด
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="flex flex-wrap items-center gap-1">
                    <legend className="sr-only">เลือกเลข 0–9</legend>
                    <span className="mr-1 text-fg-2">เลข</span>
                    {Array.from({ length: 10 }, (_, d) => (
                      <button key={d} type="button" aria-pressed={digits.includes(d)} onClick={() => toggleDigit(d)} className={`h-8 w-8 rounded-lg border text-sm ${digits.includes(d) ? "border-accent bg-accent-soft font-semibold text-fg" : "border-line bg-surface text-fg-2 hover:bg-surface-2"}`}>
                        {d}
                      </button>
                    ))}
                  </fieldset>
                  <span className="text-xs text-fg-3">แสดงหลัก: {a.moving.positions[a.moving.positions.length - 1]?.label}</span>
                </div>
                {(a.moving.positions[a.moving.positions.length - 1]?.points.length ?? 0) > 0 ? (
                  <MovingFrequencyChart points={a.moving.positions[a.moving.positions.length - 1].points} digits={digits} window={mw} />
                ) : (
                  <EmptyState title={`ต้องมีอย่างน้อย ${mw} งวดจึงจะคำนวณความถี่แบบเคลื่อนที่ได้`} />
                )}
              </ChartCard>

              <ChartCard title="ฮิสโตแกรมของค่าตัวเลข" description="แบ่งช่วงค่าเป็น 10 ช่วง เทียบกับจำนวนคาดหวังเมื่อกระจายสม่ำเสมอ" table={{ head: ["ช่วงค่า", "จำนวนครั้ง", "ค่าคาดหวัง"], rows: a.histogram.map((b) => [b.label, b.count, fmtNumber(b.expected, 1)]) }}>
                <HistogramBars bins={a.histogram} />
              </ChartCard>
            </div>
          );
        }}
      </Async>
    </div>
  );
}
