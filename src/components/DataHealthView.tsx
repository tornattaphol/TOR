"use client";

import type { IssueKindName } from "@/lib/domain";
import type { DataHealthReport } from "@/lib/quality";
import { THAI_WEEKDAYS } from "@/lib/dates";
import { fmtDateTime, fmtInt, formatThaiDate } from "@/lib/format";
import { Async, Card, DisclaimerBanner, Pill, StatCard, StatusBadge, Table } from "./ui";
import { useApi } from "./useApi";

const KIND_LABEL: Record<IssueKindName, string> = {
  DUPLICATE_IN_SOURCE: "ข้อมูลซ้ำ (duplicate)",
  INVALID_DATE: "วันที่ไม่ถูกต้อง",
  FUTURE_DATE: "วันที่เป็นอนาคต",
  INVALID_NUMBER_FORMAT: "รูปแบบตัวเลขผิด",
  DERIVED_DIGIT_MISMATCH: "เลข 2/3 ตัวไม่ตรงกับเลข 4 ตัว",
  MISSING_FIELD: "ข้อมูลไม่ครบ",
  UNEXPECTED_WEEKDAY: "ผลในวันที่ไม่ใช่วันออกรางวัล (กักกัน)",
  SOURCE_CONFLICT: "แหล่งข้อมูลขัดแย้งกัน",
};

interface SourcesData {
  lotteryCode: string;
  sources: {
    id: string;
    type: string;
    enabled: boolean;
    priority: number;
    description: string | null;
    host: string | null;
    expectedWeekdays: number[];
    lastRun: { status: string; finishedAt: string | null; errorCode: string | null; errorMessage: string | null; recordsValid: number; inserted: number; updated: number; invalid: number } | null;
  }[];
}

const SEVERITY_TONE = { INFO: "neutral", WARNING: "warning", ERROR: "critical" } as const;
const SEVERITY_LABEL = { INFO: "ข้อมูล", WARNING: "เตือน", ERROR: "ผิดพลาด" } as const;
const RUN_TONE = { SUCCESS: "good", PARTIAL: "warning", FAILED: "critical", RUNNING: "neutral" } as const;
const RUN_LABEL = { SUCCESS: "✓ สำเร็จ", PARTIAL: "▲ สำเร็จบางส่วน", FAILED: "✖ ล้มเหลว", RUNNING: "… กำลังทำงาน" } as const;

export function DataHealthView() {
  const health = useApi<DataHealthReport>("/api/health");
  const sources = useApi<SourcesData>("/api/sources");

  return (
    <div className="space-y-6">
      <DisclaimerBanner compact />
      <div>
        <h1 className="text-2xl font-bold text-fg">สุขภาพข้อมูล (Data Health)</h1>
        <p className="mt-1 text-fg-2">ตรวจสอบความครบถ้วนและความถูกต้องของข้อมูลที่ดึงมา — ค่าที่ไม่ผ่านการตรวจสอบจะถูกกันออกจากการวิเคราะห์ และแสดงไว้ที่นี่แทนการแก้ไขหรือสร้างข้อมูลขึ้นเอง</p>
      </div>

      <Async state={health} isEmpty={(h) => h.status === "empty"} height={300}>
        {(h) => (
          <div className="space-y-6">
            <Card as="div">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={h.status} />
                <span className="text-sm text-fg-2">ตรวจเมื่อ {fmtDateTime(h.generatedAt)}</span>
              </div>
              {h.reasons.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-fg-2">
                  {h.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </Card>

            <section aria-label="ตัวเลขสำคัญ" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="จำนวน records" value={fmtInt(h.totals.records)} hint={h.totals.firstDate ? `${formatThaiDate(h.totals.firstDate)} – ${h.totals.latestDate ? formatThaiDate(h.totals.latestDate) : "—"}` : undefined} />
              <StatCard label="ข้อมูลผิดปกติ" value={fmtInt(h.issues.abnormalRecords)} hint={`รายการปัญหาที่ไม่ซ้ำกัน ${fmtInt(h.issues.distinct)} รายการ`} />
              <StatCard label="ข้อมูลซ้ำ (duplicate)" value={fmtInt(h.issues.duplicateRows)} hint="แถวซ้ำที่ตรวจพบและถูกรวมเป็นหนึ่ง" />
              <StatCard label="วันที่ล่าสุดที่มีข้อมูล" value={<span className="text-xl">{h.freshness.latestDrawDate ? formatThaiDate(h.freshness.latestDrawDate) : "—"}</span>} hint={h.freshness.daysSinceLatestDraw !== null ? `ผ่านมา ${h.freshness.daysSinceLatestDraw} วัน` : undefined} />
              <StatCard label="ความครบถ้วนตามตารางงวด" value={h.schedule.coveragePercent === null ? "—" : `${h.schedule.coveragePercent}%`} hint={`${h.schedule.presentDraws}/${h.schedule.expectedDraws} งวด (${h.schedule.expectedWeekdays.map((d) => THAI_WEEKDAYS[d]).join(", ")})`} />
              <StatCard label="งวดที่ข้อมูลขาดหาย" value={fmtInt(h.schedule.missingCount)} />
              <StatCard label="รูปแบบตัวเลข/วันที่ผิด" value={fmtInt(h.issues.invalidNumberFormat + h.issues.invalidDate + h.issues.derivedMismatch)} hint={`ถูกกักกัน (ผิดวันออกรางวัล) ${h.issues.quarantined}`} />
              <StatCard label="แหล่งข้อมูลขัดแย้ง" value={fmtInt(h.issues.sourceConflict)} hint={`records ที่ติดธง ${h.totals.recordsWithConflict}`} />
            </section>

            <Card title="วันที่ข้อมูลขาดหาย" subtitle="งวดที่ควรมีตามตารางวันออกรางวัล แต่ไม่มีข้อมูลที่ผ่านการตรวจสอบ (อาจเป็นวันหยุดหรืองดออกรางวัล ซึ่งแหล่งข้อมูลไม่ได้ระบุ)">
              {h.schedule.missing.length === 0 && h.schedule.overdue.length === 0 ? (
                <p className="text-sm text-fg-2">✓ ไม่พบงวดที่ขาดหายระหว่างวันแรกถึงวันล่าสุดที่มีข้อมูล</p>
              ) : (
                <>
                  {h.schedule.missing.length > 0 && (
                    <Table
                      caption="วันที่ข้อมูลขาดหาย"
                      head={["วันที่", "วัน", "สาเหตุที่พบ"]}
                      rows={h.schedule.missing.map((m) => [
                        formatThaiDate(m.date),
                        THAI_WEEKDAYS[new Date(`${m.date}T00:00:00Z`).getUTCDay()],
                        m.reason === "rejected_by_validation" ? <Pill key="r" tone="critical">▲ แหล่งข้อมูลมีรายการ แต่ไม่ผ่านการตรวจสอบ</Pill> : <Pill key="n">ไม่มีในแหล่งข้อมูล</Pill>,
                      ])}
                    />
                  )}
                  {h.schedule.overdue.length > 0 && (
                    <p className="mt-3 text-sm text-fg-2">
                      งวดตามตารางหลังข้อมูลล่าสุดที่ยังไม่มีในระบบ: {h.schedule.overdue.map((d) => formatThaiDate(d)).join(", ")} — ลองรัน <code className="rounded bg-surface-2 px-1">npm run ingest</code>
                    </p>
                  )}
                </>
              )}
            </Card>

            <Card title="รายการข้อมูลผิดปกติ" subtitle="ผลการตรวจสอบจากทุกการดึงข้อมูล (รวมรายการซ้ำเป็นหนึ่งรายการ)">
              {h.issues.recent.length === 0 ? (
                <p className="text-sm text-fg-2">✓ ไม่พบรายการผิดปกติ</p>
              ) : (
                <Table
                  caption="รายการข้อมูลผิดปกติ"
                  head={["ประเภท", "ระดับ", "วันที่งวด", "รายละเอียด", "พบ (ครั้ง)", "พบล่าสุด"]}
                  rows={h.issues.recent.map((i) => [
                    KIND_LABEL[i.kind] ?? i.kind,
                    <Pill key="s" tone={SEVERITY_TONE[i.severity]}>
                      {SEVERITY_LABEL[i.severity]}
                    </Pill>,
                    i.drawDate ? formatThaiDate(i.drawDate) : "—",
                    <span key="m" className="text-fg-2">{i.message}</span>,
                    i.occurrences,
                    fmtDateTime(i.lastSeenAt),
                  ])}
                />
              )}
            </Card>

            <Card title="การดึงข้อมูลล่าสุด (Ingestion runs)">
              {h.runs.length === 0 ? (
                <p className="text-sm text-fg-2">ยังไม่เคยดึงข้อมูล</p>
              ) : (
                <Table
                  caption="ประวัติการดึงข้อมูล"
                  head={["เริ่มเมื่อ", "แหล่งข้อมูล", "สถานะ", "หน้า", "ผ่านการตรวจ", "เพิ่ม/แก้/เดิม", "ไม่ผ่าน", "ข้อผิดพลาด"]}
                  rows={h.runs.map((r) => [
                    fmtDateTime(r.startedAt),
                    r.sourceId,
                    <Pill key="s" tone={RUN_TONE[r.status]}>
                      {RUN_LABEL[r.status]}
                    </Pill>,
                    r.pagesFetched,
                    `${r.recordsValid}/${r.recordsParsed}`,
                    `${r.inserted}/${r.updated}/${r.unchanged}`,
                    r.invalid + r.quarantined,
                    r.errorCode ? <span key="e" className="text-critical-ink">{r.errorCode}: {r.errorMessage}</span> : "—",
                  ])}
                />
              )}
            </Card>
          </div>
        )}
      </Async>

      <Card title="แหล่งข้อมูลที่ตั้งค่าไว้" subtitle="ตั้งค่าผ่าน config/sources.json และตัวแปรสภาพแวดล้อม — ไม่ผูกกับเว็บไซต์เดียว">
        <Async state={sources} height={120}>
          {(s) => (
            <Table
              caption="แหล่งข้อมูล"
              head={["รหัส", "ชนิด", "โฮสต์", "ลำดับความสำคัญ", "วันออกรางวัลที่คาด", "สถานะการดึงล่าสุด"]}
              rows={s.sources.map((x) => [
                <span key="i">
                  {x.id} {!x.enabled && <Pill>ปิดอยู่</Pill>}
                </span>,
                x.type,
                x.host ?? "—",
                x.priority,
                x.expectedWeekdays.map((d) => THAI_WEEKDAYS[d]).join(", "),
                x.lastRun ? (
                  <span key="l">
                    <Pill tone={RUN_TONE[x.lastRun.status as keyof typeof RUN_TONE] ?? "neutral"}>{RUN_LABEL[x.lastRun.status as keyof typeof RUN_LABEL] ?? x.lastRun.status}</Pill>{" "}
                    <span className="text-xs text-fg-3">{fmtDateTime(x.lastRun.finishedAt)}</span>
                    {x.lastRun.errorCode && <span className="block text-xs text-critical-ink">{x.lastRun.errorCode}</span>}
                  </span>
                ) : (
                  "ยังไม่เคยดึง"
                ),
              ])}
            />
          )}
        </Async>
      </Card>
    </div>
  );
}
