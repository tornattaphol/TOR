"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FrequencyEntry, PositionDistribution } from "@/lib/analytics/types";
import { formatThaiDate, fmtNumber, fmtPercent } from "@/lib/format";

/* ───────────────────────── shared chrome ───────────────────────── */

const GRID = "var(--grid)";
const AXIS_INK = "var(--fg-3)";

interface TipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
  payload?: Record<string, unknown>;
}
interface TipProps {
  active?: boolean;
  payload?: readonly TipEntry[];
  label?: string | number;
}

/** Tooltip box in text tokens (never series colour for text); a swatch carries identity. */
function Tip({ active, payload, label, title, line }: TipProps & { title?: (label: string | number | undefined, p: readonly TipEntry[]) => ReactNode; line: (e: TipEntry) => ReactNode }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-fg">{title ? title(label, payload) : String(label ?? "")}</div>
      <ul className="space-y-0.5">
        {payload.map((e, i) => (
          <li key={i} className="flex items-center gap-2 text-fg-2">
            <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: e.color }} />
            <span className="tabular">{line(e)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartCard({
  title,
  description,
  children,
  table,
  note,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  /** Accessible alternative: the same data as a table. */
  table?: { head: string[]; rows: (string | number)[][] };
  note?: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description && <p className="mt-0.5 text-sm text-fg-2">{description}</p>}
      <div className="mt-3">{children}</div>
      {note && <p className="mt-2 text-xs text-fg-3">{note}</p>}
      {table && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer select-none text-accent">ดูข้อมูลเป็นตาราง</summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-surface-2">
                <tr>
                  {table.head.map((h) => (
                    <th key={h} scope="col" className="px-2 py-1.5 text-left font-medium text-fg-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line/60">
                    {r.map((c, j) => (
                      <td key={j} className="tabular px-2 py-1 text-fg">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

const margin = { top: 8, right: 12, bottom: 4, left: 0 };

function Frame({ height = 260, label, children }: { height?: number; label: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

const axisProps = { tickLine: false, axisLine: { stroke: GRID }, tick: { fill: AXIS_INK, fontSize: 12 } } as const;

/* ───────────────────────── frequency & distribution ───────────────────────── */

export function FrequencyBars({ entries, expected, unit = "งวด" }: { entries: FrequencyEntry[]; expected: number; unit?: string }) {
  return (
    <Frame label={`กราฟแท่งความถี่ของตัวเลขที่ปรากฏในอดีต ${entries.length} ค่า`}>
      <BarChart data={entries} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="value" {...axisProps} />
        <YAxis allowDecimals={false} width={32} {...axisProps} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={(p) => (
            <Tip
              {...(p as TipProps)}
              title={(l) => `เลข ${l}`}
              line={(e) => {
                const row = e.payload as unknown as FrequencyEntry;
                return `ปรากฏ ${row.count} ${unit} (${fmtPercent(row.share)})`;
              }}
            />
          )}
        />
        {expected > 0 && <ReferenceLine y={expected} stroke="var(--s2)" strokeDasharray="5 4" label={{ value: `ค่าคาดหวังเมื่อกระจายสม่ำเสมอ ≈ ${fmtNumber(expected, 1)}`, position: "insideTopRight", fill: AXIS_INK, fontSize: 11 }} />}
        <Bar dataKey="count" name="จำนวนครั้ง" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </Frame>
  );
}

export function DigitBars({ position }: { position: PositionDistribution }) {
  const data = position.counts.map((count, digit) => ({ digit: String(digit), count, share: position.shares[digit] }));
  const expected = position.total / 10;
  return (
    <Frame height={200} label={`กราฟแท่งการกระจายของเลข 0–9 ที่${position.label}`}>
      <BarChart data={data} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="digit" {...axisProps} />
        <YAxis allowDecimals={false} width={32} {...axisProps} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={(p) => (
            <Tip
              {...(p as TipProps)}
              title={(l) => `เลข ${l} ที่${position.label}`}
              line={(e) => `ปรากฏ ${(e.payload as { count: number }).count} ครั้ง (${fmtPercent((e.payload as { share: number }).share)})`}
            />
          )}
        />
        <ReferenceLine y={expected} stroke="var(--s2)" strokeDasharray="5 4" />
        <Bar dataKey="count" name="จำนวนครั้ง" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </Frame>
  );
}

export function HistogramBars({ bins, valueLabel = "ช่วงค่า" }: { bins: { label: string; count: number; expected: number }[]; valueLabel?: string }) {
  return (
    <Frame label="ฮิสโตแกรมการกระจายของค่าตัวเลข">
      <BarChart data={bins} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" interval={0} {...axisProps} />
        <YAxis allowDecimals={false} width={32} {...axisProps} />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={(p) => <Tip {...(p as TipProps)} title={(l) => `${valueLabel} ${l}`} line={(e) => `${e.name}: ${fmtNumber(Number(e.value), e.dataKey === "expected" ? 1 : 0)}`} />}
        />
        <Legend verticalAlign="top" height={28} />
        <Bar dataKey="count" name="จำนวนครั้งที่พบ" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        <Bar dataKey="expected" name="ค่าคาดหวังเมื่อกระจายสม่ำเสมอ" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </Frame>
  );
}

/* ───────────────────────── trend ───────────────────────── */

export function TrendChart({ data, max, window }: { data: { date: string; value: number; movingAverage: number | null }[]; max: number; window: number }) {
  return (
    <Frame height={280} label="กราฟเส้นแนวโน้มค่าตัวเลขในแต่ละงวดพร้อมค่าเฉลี่ยเคลื่อนที่">
      <LineChart data={data} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(2, 7)} minTickGap={36} {...axisProps} />
        <YAxis domain={[0, max]} width={40} {...axisProps} />
        <Tooltip
          content={(p) => (
            <Tip
              {...(p as TipProps)}
              title={(l) => formatThaiDate(String(l), { weekday: true })}
              line={(e) => `${e.name}: ${e.dataKey === "movingAverage" ? fmtNumber(Number(e.value), 1) : fmtNumber(Number(e.value), 0)}`}
            />
          )}
        />
        <Legend verticalAlign="top" height={28} />
        <Line type="linear" dataKey="value" name="ค่าตัวเลขของแต่ละงวด" stroke="var(--s1)" strokeWidth={1} strokeOpacity={0.45} dot={{ r: 2.5, fill: "var(--s1)", stroke: "var(--surface)", strokeWidth: 1 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="movingAverage" name={`ค่าเฉลี่ยเคลื่อนที่ ${window} งวด`} stroke="var(--s2)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </Frame>
  );
}

const DIGIT_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)"];

/** Rolling share of selected digits (max 3 → categorical slots 1–3, which validate for all pairs). */
export function MovingFrequencyChart({ points, digits, window }: { points: ({ date: string } & Record<string, number | string>)[]; digits: number[]; window: number }) {
  return (
    <Frame height={260} label={`กราฟเส้นสัดส่วนของเลข ${digits.join(", ")} ในหน้าต่างเลื่อน ${window} งวด`}>
      <LineChart data={points} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(2, 7)} minTickGap={36} {...axisProps} />
        <YAxis domain={[0, "auto"]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44} {...axisProps} />
        <Tooltip content={(p) => <Tip {...(p as TipProps)} title={(l) => formatThaiDate(String(l), { weekday: true })} line={(e) => `${e.name}: ${fmtPercent(Number(e.value))}`} />} />
        <Legend verticalAlign="top" height={28} />
        <ReferenceLine y={0.1} stroke="var(--fg-3)" strokeDasharray="5 4" label={{ value: "10% (กระจายสม่ำเสมอ)", position: "insideTopRight", fill: AXIS_INK, fontSize: 11 }} />
        {digits.slice(0, 3).map((d, i) => (
          <Line key={d} type="monotone" dataKey={`d${d}`} name={`เลข ${d}`} stroke={DIGIT_COLORS[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </Frame>
  );
}

/* ───────────────────────── 10×10 frequency grid ───────────────────────── */

/** Heat-grid of observed counts for every 2-digit number (one-hue sequential scale). */
export function FrequencyGrid({ grid }: { grid: number[] }) {
  const max = Math.max(1, ...grid);
  const steps = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  const colorFor = (c: number) => (c === 0 ? "var(--surface-2)" : steps[Math.min(steps.length - 1, Math.floor((c / max) * (steps.length - 1)))]);
  const darkText = (c: number) => c > 0 && c / max > 0.45;
  return (
    <div>
      <div role="img" aria-label="ตารางความถี่ของเลข 2 ตัว 00–99 ที่ปรากฏในอดีต" className="grid grid-cols-10 gap-0.5 sm:gap-1">
        {grid.map((c, i) => {
          const v = String(i).padStart(2, "0");
          return (
            <div
              key={v}
              title={`เลข ${v}: ปรากฏ ${c} ครั้ง`}
              className="tabular flex aspect-square min-w-0 flex-col items-center justify-center rounded text-[10px] leading-tight sm:text-xs"
              style={{ background: colorFor(c), color: darkText(c) ? "#fff" : "var(--fg)" }}
            >
              <span className="font-mono opacity-80">{v}</span>
              <span className="font-semibold">{c}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-fg-3">
        <span>0</span>
        <span aria-hidden className="inline-flex overflow-hidden rounded">
          {steps.map((s) => (
            <span key={s} className="inline-block h-3 w-6" style={{ background: s }} />
          ))}
        </span>
        <span>{max} ครั้ง</span>
      </div>
    </div>
  );
}

/* ───────────────────────── differences ───────────────────────── */

export function DiffHistogram({ bins, expectedMeanAbs }: { bins: { label: string; count: number }[]; expectedMeanAbs?: number }) {
  void expectedMeanAbs;
  return (
    <Frame height={220} label="ฮิสโตแกรมผลต่างสัมบูรณ์ระหว่างงวดที่ติดกัน">
      <BarChart data={bins} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" interval={0} {...axisProps} />
        <YAxis allowDecimals={false} width={32} {...axisProps} />
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p) => <Tip {...(p as TipProps)} title={(l) => `ผลต่าง ${l}`} line={(e) => `${e.value} คู่งวด`} />} />
        <Bar dataKey="count" name="จำนวนคู่งวด" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </Frame>
  );
}

/* ───────────────────────── forecasting charts ───────────────────────── */

export const MODEL_COLORS: Record<string, string> = {
  frequency: "var(--s1)",
  rolling_frequency: "var(--s2)",
  moving_average: "var(--s3)",
  markov1: "var(--s4)",
  autoregressive: "var(--s5)",
  monte_carlo: "var(--s6)",
  softmax_ml: "var(--s7)",
};

export function CumulativeAdvantageChart({ rows, models }: { rows: Record<string, number | string>[]; models: { id: string; name: string }[] }) {
  return (
    <Frame height={280} label="กราฟเส้นผลต่างสะสมของ log-loss เทียบกับการสุ่ม (ค่าบวก = ดีกว่าสุ่ม)">
      <LineChart data={rows} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(2, 7)} minTickGap={36} {...axisProps} />
        <YAxis width={48} {...axisProps} />
        <Tooltip content={(p) => <Tip {...(p as TipProps)} title={(l) => formatThaiDate(String(l))} line={(e) => `${e.name}: ${fmtNumber(Number(e.value), 3)}`} />} />
        <Legend verticalAlign="top" height={28} />
        <ReferenceLine y={0} stroke="var(--fg-3)" strokeDasharray="5 4" label={{ value: "เท่ากับการสุ่ม", position: "insideBottomRight", fill: AXIS_INK, fontSize: 11 }} />
        {models.map((m) => (
          <Line key={m.id} type="monotone" dataKey={m.id} name={m.name} stroke={MODEL_COLORS[m.id] ?? "var(--s8)"} strokeWidth={2} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </Frame>
  );
}

export function RollingMaeChart({ points }: { points: { date: string; model: number; baseline: number }[] }) {
  return (
    <Frame height={240} label="กราฟเส้นความคลาดเคลื่อนสัมบูรณ์เฉลี่ยแบบเลื่อน 20 งวด เทียบกับการเดาแบบสุ่ม">
      <LineChart data={points} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(2, 7)} minTickGap={36} {...axisProps} />
        <YAxis width={40} {...axisProps} />
        <Tooltip content={(p) => <Tip {...(p as TipProps)} title={(l) => formatThaiDate(String(l))} line={(e) => `${e.name}: ${fmtNumber(Number(e.value), 2)}`} />} />
        <Legend verticalAlign="top" height={28} />
        <Line type="monotone" dataKey="model" name="MAE ของโมเดล" stroke="var(--s1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="baseline" name="MAE คาดหวังของการสุ่ม" stroke="var(--s2)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      </LineChart>
    </Frame>
  );
}

export function ErrorHistogram({ bins }: { bins: { label: string; model: number; expectedRandom: number }[] }) {
  return (
    <Frame height={240} label="ฮิสโตแกรมขนาดความคลาดเคลื่อนสัมบูรณ์ เทียบกับการเดาแบบสุ่ม">
      <BarChart data={bins} margin={margin}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" interval={0} {...axisProps} />
        <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44} {...axisProps} />
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p) => <Tip {...(p as TipProps)} title={(l) => `ความคลาดเคลื่อน ${l}`} line={(e) => `${e.name}: ${fmtPercent(Number(e.value))}`} />} />
        <Legend verticalAlign="top" height={28} />
        <Bar dataKey="model" name="โมเดล" fill="var(--s1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar dataKey="expectedRandom" name="การเดาแบบสุ่ม (ค่าคาดหวัง)" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </Frame>
  );
}
