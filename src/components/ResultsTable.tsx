"use client";

import { useEffect, useState } from "react";
import type { DrawRecord, PrizeType } from "@/lib/domain";
import { THAI_WEEKDAYS, weekdayOf } from "@/lib/dates";
import { fmtDateTime, fmtInt, formatThaiDate, safeHref } from "@/lib/format";
import { Async, Card, DigitChip, Pill } from "./ui";
import { useApi } from "./useApi";

interface DrawsPage {
  rows: DrawRecord[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE = 15;

/** Paginated historical results. `last` caps the table to the most recent N draws, like the other widgets. */
export function ResultsTable({ from, to, last, prize }: { from: string; to: string; last: string; prize: PrizeType }) {
  const [page, setPage] = useState(0);
  const cap = last === "all" ? Infinity : Number(last);

  // back to page 1 whenever the filter changes
  useEffect(() => setPage(0), [from, to, last]);

  const qs = new URLSearchParams({ limit: String(Math.min(PAGE, Math.max(1, cap - page * PAGE))), offset: String(page * PAGE), order: "desc" });
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const state = useApi<DrawsPage>(page * PAGE >= cap ? null : `/api/draws?${qs}`);

  return (
    <Card title="ตารางผลย้อนหลัง" subtitle="เรียงจากงวดล่าสุด — ทุกแถวระบุแหล่งที่มาและเวลาที่ดึงข้อมูล">
      <Async state={state} isEmpty={(d) => d.total === 0} height={240}>
        {(d) => {
          const total = Math.min(d.total, cap);
          const pages = Math.max(1, Math.ceil(total / PAGE));
          return (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <caption className="sr-only">ผลสลากย้อนหลัง</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-fg-2">
                      <th scope="col" className="px-2 py-2 font-medium">วันที่ออกรางวัล</th>
                      <th scope="col" className="px-2 py-2 font-medium">เลข 4 ตัว</th>
                      <th scope="col" className="px-2 py-2 font-medium">เลข 3 ตัว</th>
                      <th scope="col" className="px-2 py-2 font-medium">เลข 2 ตัว</th>
                      <th scope="col" className="px-2 py-2 font-medium">แหล่งข้อมูล</th>
                      <th scope="col" className="px-2 py-2 font-medium">ดึงข้อมูลเมื่อ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => {
                      const href = safeHref(r.sourceUrl);
                      return (
                        <tr key={r.drawDate} className="border-b border-line/60 last:border-0">
                          <td className="px-2 py-2 text-fg">
                            {formatThaiDate(r.drawDate)} <span className="text-xs text-fg-3">({THAI_WEEKDAYS[weekdayOf(r.drawDate)]})</span>
                          </td>
                          <td className="px-2 py-2"><DigitChip value={r.result4} emphasise={prize === "4"} /></td>
                          <td className="px-2 py-2"><DigitChip value={r.result3} emphasise={prize === "3"} /></td>
                          <td className="px-2 py-2"><DigitChip value={r.result2} emphasise={prize === "2"} /></td>
                          <td className="px-2 py-2 text-fg-2">
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                                {r.source}
                              </a>
                            ) : (
                              r.source
                            )}{" "}
                            {r.hasConflict && <Pill tone="critical">แหล่งข้อมูลขัดแย้ง</Pill>}
                          </td>
                          <td className="tabular px-2 py-2 text-xs text-fg-3">{fmtDateTime(r.fetchedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-fg-2">
                <span>
                  แสดง {fmtInt(page * PAGE + 1)}–{fmtInt(Math.min(total, (page + 1) * PAGE))} จาก {fmtInt(total)} งวด
                </span>
                <span className="inline-flex gap-2">
                  <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded-lg border border-line px-3 py-1.5 enabled:hover:bg-surface-2 disabled:opacity-40">
                    ← ใหม่กว่า
                  </button>
                  <span className="px-1 py-1.5">หน้า {page + 1}/{pages}</span>
                  <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-line px-3 py-1.5 enabled:hover:bg-surface-2 disabled:opacity-40">
                    เก่ากว่า →
                  </button>
                </span>
              </div>
            </>
          );
        }}
      </Async>
    </Card>
  );
}
