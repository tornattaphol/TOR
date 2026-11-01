"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { PrizeType } from "@/lib/domain";

export interface Filters {
  from: string;
  to: string;
  last: string; // "all" | "10" | "20" | "50" | "100" | custom
  prize: PrizeType;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Filters live in the URL so a view can be shared/bookmarked. Invalid values fall back to defaults. */
export function useFilters(): { filters: Filters; setFilters: (patch: Partial<Filters>) => void; reset: () => void; query: string } {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo<Filters>(() => {
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    const last = params.get("last") ?? "all";
    const prize = params.get("prize");
    return {
      from: ISO.test(from) ? from : "",
      to: ISO.test(to) ? to : "",
      // matches the API's accepted range (1–5000); anything else falls back to "all"
      last: last === "all" || (/^\d{1,4}$/.test(last) && Number(last) >= 1 && Number(last) <= 5000) ? last : "all",
      prize: prize === "3" || prize === "4" ? prize : "2",
    };
  }, [params]);

  const write = useCallback(
    (next: Filters) => {
      const p = new URLSearchParams();
      if (next.from) p.set("from", next.from);
      if (next.to) p.set("to", next.to);
      if (next.last !== "all") p.set("last", next.last);
      if (next.prize !== "2") p.set("prize", next.prize);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const setFilters = useCallback((patch: Partial<Filters>) => write({ ...filters, ...patch }), [filters, write]);
  const reset = useCallback(() => write({ from: "", to: "", last: "all", prize: "2" }), [write]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    if (filters.last !== "all") p.set("last", filters.last);
    p.set("prize", filters.prize);
    return p.toString();
  }, [filters]);

  return { filters, setFilters, reset, query };
}

const LAST_OPTIONS = [
  { v: "all", label: "ทั้งหมด" },
  { v: "10", label: "10 งวด" },
  { v: "20", label: "20 งวด" },
  { v: "50", label: "50 งวด" },
  { v: "100", label: "100 งวด" },
];

const PRIZES: { v: PrizeType; label: string }[] = [
  { v: "2", label: "เลข 2 ตัว" },
  { v: "3", label: "เลข 3 ตัว" },
  { v: "4", label: "เลข 4 ตัว" },
];

const field = "h-9 rounded-lg border border-line bg-surface px-2 text-sm text-fg";

export function FilterBar({ showPrize = true }: { showPrize?: boolean }) {
  const { filters, setFilters, reset } = useFilters();
  const rangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);
  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      aria-label="ตัวกรองข้อมูล"
      className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-line bg-surface p-4"
    >
      <label className="flex flex-col gap-1 text-sm text-fg-2">
        ตั้งแต่วันที่
        <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-fg-2">
        ถึงวันที่
        <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-fg-2">
        จำนวนงวดย้อนหลัง
        <select value={LAST_OPTIONS.some((o) => o.v === filters.last) ? filters.last : "all"} onChange={(e) => setFilters({ last: e.target.value })} className={field}>
          {LAST_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {showPrize && (
        <fieldset className="flex flex-col gap-1 text-sm text-fg-2">
          <legend className="mb-1">ประเภทผลรางวัล</legend>
          <div className="inline-flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="ประเภทผลรางวัล">
            {PRIZES.map((p) => (
              <button
                key={p.v}
                type="button"
                role="radio"
                aria-checked={filters.prize === p.v}
                onClick={() => setFilters({ prize: p.v })}
                className={`h-9 px-3 text-sm ${filters.prize === p.v ? "bg-accent-soft font-medium text-fg" : "bg-surface text-fg-2 hover:bg-surface-2"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <button type="button" onClick={reset} className="h-9 rounded-lg border border-line px-3 text-sm text-fg-2 hover:bg-surface-2">
        ล้างตัวกรอง
      </button>
      {rangeInvalid && (
        <p role="alert" className="w-full text-sm text-critical-ink">
          ▲ วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด
        </p>
      )}
    </form>
  );
}
