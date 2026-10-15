"use client";

import type { ReactNode } from "react";
import { INDEPENDENCE_NOTE, REQUIRED_WARNING, SHORT_DISCLAIMER } from "@/lib/disclaimer";
import type { ApiState } from "./useApi";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  as: Tag = "section",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={`min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-fg-2">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <div className="text-sm text-fg-2">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold text-fg">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-3">{hint}</div>}
    </div>
  );
}

export function DisclaimerBanner({ compact = false }: { compact?: boolean }) {
  return (
    <div role="note" className="rounded-xl border border-line border-l-4 border-l-warning bg-surface px-4 py-3 text-sm">
      <p className="font-semibold text-fg">
        <span aria-hidden>⚠ </span>
        {REQUIRED_WARNING}
      </p>
      {!compact && (
        <p className="mt-1 text-fg-2">
          {SHORT_DISCLAIMER} {INDEPENDENCE_NOTE}
        </p>
      )}
    </div>
  );
}

export function LoadingState({ label = "กำลังโหลดข้อมูล…", height = 160 }: { label?: string; height?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex animate-pulse flex-col items-center justify-center gap-2 rounded-lg bg-surface-2 text-sm text-fg-2" style={{ minHeight: height }}>
      <span aria-hidden className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { code: string; message: string; status?: number }; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-critical/50 bg-surface-2 p-4 text-sm">
      <p className="font-semibold text-critical-ink">
        <span aria-hidden>✖ </span>โหลดข้อมูลไม่สำเร็จ
      </p>
      <p className="mt-1 text-fg-2">{error.message}</p>
      <p className="mt-1 text-xs text-fg-3">รหัสข้อผิดพลาด: {error.code}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-fg hover:bg-surface-2">
          ลองใหม่
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface-2 p-6 text-center text-sm">
      <p className="font-semibold text-fg">{title}</p>
      {children && <div className="mt-1 text-fg-2">{children}</div>}
    </div>
  );
}

/** Renders loading / error / empty / content for an ApiState. */
export function Async<T>({
  state,
  isEmpty,
  empty,
  height,
  children,
}: {
  state: ApiState<T>;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  height?: number;
  children: (data: T, meta: NonNullable<ApiState<T>["data"]>["meta"]) => ReactNode;
}) {
  if (state.loading && !state.data) return <LoadingState height={height} />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!state.data) return null;
  if (isEmpty?.(state.data.data)) {
    return (
      <>
        {empty ?? (
          <EmptyState title="ไม่พบข้อมูลในช่วงที่เลือก">ลองปรับตัวกรอง หรือรันการดึงข้อมูล (npm run ingest:full) หากฐานข้อมูลยังว่าง</EmptyState>
        )}
      </>
    );
  }
  return (
    <div aria-busy={state.loading} className={state.loading ? "opacity-60 transition-opacity" : ""}>
      {children(state.data.data, state.data.meta)}
    </div>
  );
}

const STATUS = {
  healthy: { icon: "✓", label: "ปกติ", cls: "border-good text-good-ink" },
  warning: { icon: "▲", label: "ควรตรวจสอบ", cls: "border-warning text-warning-ink" },
  critical: { icon: "✖", label: "พบปัญหาร้ายแรง", cls: "border-critical text-critical-ink" },
  empty: { icon: "○", label: "ยังไม่มีข้อมูล", cls: "border-line text-fg-2" },
} as const;

/** Status is always icon + text + colour (never colour alone). */
export function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-semibold ${s.cls}`}>
      <span aria-hidden>{s.icon}</span>
      {s.label}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "critical" }) {
  const cls = { neutral: "border-line text-fg-2", good: "border-good text-good-ink", warning: "border-warning text-warning-ink", critical: "border-critical text-critical-ink" }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function DigitChip({ value, emphasise = false }: { value: string | null; emphasise?: boolean }) {
  if (value === null) return <span className="text-fg-3">—</span>;
  return (
    <span className={`tabular inline-block rounded-md px-2 py-0.5 font-mono text-sm tracking-widest ${emphasise ? "bg-accent-soft font-semibold text-fg" : "bg-surface-2 text-fg"}`}>
      {value}
    </span>
  );
}

export function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line text-left text-fg-2">
            {head.map((h) => (
              <th key={h} scope="col" className="px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="tabular px-2 py-2 align-top text-fg">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
