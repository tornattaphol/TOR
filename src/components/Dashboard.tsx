"use client";

import Link from "next/link";
import type { AnalyticsBundle } from "@/lib/analytics/types";
import { INDEPENDENCE_NOTE } from "@/lib/disclaimer";
import type { DatasetMeta } from "@/lib/services";
import { fmtDateTime, fmtInt, fmtNumber, fmtPercent, formatThaiDate, safeHref } from "@/lib/format";
import { DigitBars, ChartCard, FrequencyBars, HistogramBars, TrendChart } from "./charts";
import { FilterBar, useFilters } from "./FilterBar";
import { ResultsTable } from "./ResultsTable";
import { Async, Card, DigitChip, DisclaimerBanner, EmptyState, StatCard } from "./ui";
import { useApi } from "./useApi";

type MetaData = DatasetMeta & { expectedWeekdays: number[] };

export function Dashboard() {
  const { filters, query } = useFilters();
  const meta = useApi<MetaData>("/api/meta");
  const analytics = useApi<AnalyticsBundle>(`/api/analytics?${query}&movingWindow=10`);
  const prizeLabel = `เลข ${filters.prize} ตัว`;

  return (
    <div className="space-y-6">
      <DisclaimerBanner />
      <div>
        <h1 className="text-2xl font-bold text-fg sm:text-3xl">Lao Lottery Statistics Dashboard</h1>
        <p className="mt-1 text-fg-2">วิเคราะห์สถิติย้อนหลังของผลสลากลาวพัฒนา (Lao Development Lottery) เพื่อการศึกษา — นำเสนอสิ่งที่เคยเกิดขึ้นเท่านั้น</p>
      </div>

      {/* dataset overview */}
      <Async state={meta} isEmpty={(m) => m.totalDraws === 0} empty={<EmptyState title="ยังไม่มีข้อมูลในฐานข้อมูล">รันคำสั่ง <code className="rounded bg-surface px-1">npm run ingest:full</code> เพื่อดึงข้อมูลจากแหล่งข้อมูลที่ตั้งค่าไว้ (ระบบไม่สร้างข้อมูลจำลอง)</EmptyState>} height={120}>
        {(m, mm) => {
          const latest = m.latestDraw;
          const href = safeHref(latest?.sourceUrl);
          return (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-line bg-surface p-4 sm:col-span-2 lg:col-span-1">
                <div className="text-sm text-fg-2">งวดล่าสุด</div>
                {latest && (
                  <>
                    <div className="mt-1 text-lg font-semibold text-fg">{formatThaiDate(latest.drawDate, { weekday: true })}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <DigitChip value={latest.result4} emphasise={filters.prize === "4"} />
                      <DigitChip value={latest.result3} emphasise={filters.prize === "3"} />
                      <DigitChip value={latest.result2} emphasise={filters.prize === "2"} />
                    </div>
                    <div className="mt-1 text-xs text-fg-3">
                      เลข 4 / 3 / 2 ตัว · แหล่งที่มา:{" "}
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                          {latest.source}
                        </a>
                      ) : (
                        latest.source
                      )}
                    </div>
                  </>
                )}
              </div>
              <StatCard label="จำนวนงวดทั้งหมดในระบบ" value={fmtInt(m.totalDraws)} hint={m.firstDate ? `ตั้งแต่ ${formatThaiDate(m.firstDate)}` : undefined} />
              <StatCard label="อัปเดตข้อมูลล่าสุด" value={<span className="text-lg">{fmtDateTime(m.lastUpdated ?? (mm.lastUpdated as string | null))}</span>} hint="เวลาที่การดึงข้อมูลสำเร็จครั้งล่าสุดเสร็จสิ้น" />
              <StatCard
                label="แหล่งข้อมูล"
                value={<span className="text-lg">{m.sources.map((s) => s.id).join(", ") || "—"}</span>}
                hint={
                  <Link href="/data-health" className="text-accent underline">
                    ดูสุขภาพข้อมูล
                  </Link>
                }
              />
            </div>
          );
        }}
      </Async>

      <FilterBar />

      <Async state={analytics} isEmpty={(a) => a.selection.drawCount === 0} empty={<EmptyState title="ไม่พบข้อมูลในช่วงที่เลือก">ลองขยายช่วงวันที่หรือเลือก “ทั้งหมด”</EmptyState>} height={320}>
        {(a) => {
          const top = a.frequency.mostFrequent[0];
          const mean = a.trend.length ? a.trend.reduce((s, t) => s + t.value, 0) / a.trend.length : null;
          return (
            <div className="space-y-6">
              <section aria-label="สถิติโดยสรุป" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label={`จำนวนงวดที่วิเคราะห์ (${prizeLabel})`} value={fmtInt(a.selection.drawCount)} hint={a.selection.firstDate && a.selection.lastDate ? `${formatThaiDate(a.selection.firstDate)} – ${formatThaiDate(a.selection.lastDate)}` : undefined} />
                <StatCard label="จำนวนค่าที่ไม่ซ้ำกัน" value={fmtInt(a.frequency.distinct)} hint={`จากทั้งหมด ${fmtInt(a.frequency.possible)} ค่าที่เป็นไปได้`} />
                <StatCard label="ค่าที่พบบ่อยที่สุดในช่วงนี้ (ในอดีต)" value={top ? <span className="font-mono tracking-widest">{top.value}</span> : "—"} hint={top ? `ปรากฏ ${top.count} ครั้ง (${fmtPercent(top.share)}) — เป็นสถิติย้อนหลัง ไม่ใช่การคาดการณ์` : undefined} />
                <StatCard label="ออกซ้ำงวดติดกัน" value={`${a.repeats.consecutive.count} ครั้ง`} hint={`อัตรา ${fmtPercent(a.repeats.consecutive.rate, 2)} · ค่าคาดหวังเมื่อสุ่มสม่ำเสมอ ${fmtPercent(a.repeats.consecutive.expectedRate, 2)}`} />
              </section>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard
                  title={`ความถี่ที่เคยปรากฏ — ${prizeLabel} (10 ค่าที่พบมากที่สุดในช่วงที่เลือก)`}
                  description="จำนวนครั้งที่แต่ละค่าเคยปรากฏ; เส้นประคือค่าคาดหวังเมื่อทุกค่ามีโอกาสเท่ากัน"
                  note={INDEPENDENCE_NOTE}
                  table={{ head: ["ค่า", "จำนวนครั้ง", "สัดส่วน"], rows: a.frequency.entries.slice(0, 50).map((e) => [e.value, e.count, fmtPercent(e.share)]) }}
                >
                  <FrequencyBars entries={a.frequency.mostFrequent} expected={a.frequency.total / a.frequency.possible} />
                </ChartCard>

                <ChartCard
                  title="การกระจายของเลข 0–9 แยกตามหลัก"
                  description="เปรียบเทียบจำนวนครั้งของแต่ละเลขในแต่ละหลักกับค่าคาดหวัง (เส้นประ)"
                  table={{ head: ["หลัก", ...Array.from({ length: 10 }, (_, d) => String(d))], rows: a.digitDistribution.positions.map((p) => [p.label, ...p.counts]) }}
                >
                  <div className={`grid grid-cols-1 gap-3 ${a.digitDistribution.positions.length > 2 ? "sm:grid-cols-2" : ""}`}>
                    {a.digitDistribution.positions.map((p) => (
                      <div key={p.position}>
                        <div className="mb-1 text-sm font-medium text-fg-2">{p.label}</div>
                        <DigitBars position={p} />
                      </div>
                    ))}
                  </div>
                </ChartCard>
              </div>

              <ChartCard
                title="แนวโน้มย้อนหลัง"
                description={`ค่าตัวเลขของ${prizeLabel}ในแต่ละงวด และค่าเฉลี่ยเคลื่อนที่ 10 งวด — ใช้ดูภาพรวมในอดีตเท่านั้น`}
                table={{ head: ["วันที่", "ค่า", "ค่าเฉลี่ยเคลื่อนที่"], rows: a.trend.map((t) => [t.date, t.value, t.movingAverage === null ? "—" : fmtNumber(t.movingAverage, 1)]) }}
              >
                <TrendChart data={a.trend} max={10 ** a.selection.digits - 1} window={a.moving.window} />
              </ChartCard>

              <ChartCard
                title="ฮิสโตแกรมของค่าตัวเลข"
                description="แบ่งช่วงค่าเป็น 10 ช่วงเท่ากัน เทียบกับจำนวนที่คาดหวังเมื่อกระจายสม่ำเสมอ"
                table={{ head: ["ช่วงค่า", "จำนวนครั้ง", "ค่าคาดหวัง"], rows: a.histogram.map((b) => [b.label, b.count, fmtNumber(b.expected, 1)]) }}
              >
                <HistogramBars bins={a.histogram} />
              </ChartCard>

              <p className="text-sm text-fg-2">
                ต้องการดูเพิ่ม: สถิติหน้าต่างย้อนหลัง 10/20/50/100 งวด, เลขซ้ำ, ผลต่างระหว่างงวด, ค่าความถี่แบบเคลื่อนที่ ที่หน้า{" "}
                <Link href={`/analytics?${query}`} className="text-accent underline">
                  วิเคราะห์เชิงลึก
                </Link>
              </p>
            </div>
          );
        }}
      </Async>

      <ResultsTable from={filters.from} to={filters.to} last={filters.last} prize={filters.prize} />
      <Card as="div" className="text-sm text-fg-2">
        ข้อมูลทั้งหมดดึงจากแหล่งข้อมูลสาธารณะที่ตั้งค่าไว้ ผ่านขั้นตอน Source → Parser → Validator → Database ก่อนนำมาแสดง — ดูข้อจำกัดของแหล่งข้อมูลที่{" "}
        <Link href="/about" className="text-accent underline">
          เกี่ยวกับ/วิธีการ
        </Link>
      </Card>
    </div>
  );
}
