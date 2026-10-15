import type { DataIssueRecord, DrawRecord, IngestionRunRecord, IssueKindName } from "../domain";
import { expectedDrawDates, addDays, daysBetween } from "../dates";

export type HealthStatus = "healthy" | "warning" | "critical" | "empty";

export interface MissingDraw {
  date: string;
  /** rejected: the source published it but validation refused it; not_in_source: no usable record at all */
  reason: "rejected_by_validation" | "not_in_source";
}

export interface DataHealthReport {
  generatedAt: string;
  status: HealthStatus;
  reasons: string[];
  totals: {
    records: number;
    firstDate: string | null;
    latestDate: string | null;
    recordsWithConflict: number;
    bySource: { source: string; count: number }[];
  };
  schedule: {
    expectedWeekdays: number[];
    expectedDraws: number;
    presentDraws: number;
    missingCount: number;
    coveragePercent: number | null;
    missing: MissingDraw[];
    /** Scheduled draw days after the latest stored draw and before today (not yet ingested or not published). */
    overdue: string[];
  };
  issues: {
    distinct: number;
    abnormalRecords: number;
    byKind: Partial<Record<IssueKindName, number>>;
    duplicateRows: number;
    invalidDate: number;
    invalidNumberFormat: number;
    derivedMismatch: number;
    sourceConflict: number;
    quarantined: number;
    recent: DataIssueRecord[];
  };
  freshness: {
    latestDrawDate: string | null;
    daysSinceLatestDraw: number | null;
    lastSuccessfulRunAt: string | null;
    lastRunStatus: string | null;
  };
  runs: IngestionRunRecord[];
}

export interface HealthInputs {
  draws: DrawRecord[];
  issues: DataIssueRecord[];
  issueCounts: Partial<Record<IssueKindName, number>>;
  runs: IngestionRunRecord[];
  lastSuccessfulRunAt: string | null;
  expectedWeekdays: number[];
  /** Calendar "today" in the draw time zone. */
  today: string;
  now?: Date;
}

/** Pure computation of the Data Health page from stored data. */
export function buildHealthReport(i: HealthInputs): DataHealthReport {
  const draws = [...i.draws].sort((a, b) => a.drawDate.localeCompare(b.drawDate));
  const first = draws[0]?.drawDate ?? null;
  const latest = draws[draws.length - 1]?.drawDate ?? null;

  const have = new Set(draws.map((d) => d.drawDate));
  const rejectedDates = new Set(i.issues.filter((x) => x.severity === "ERROR" && x.drawDate).map((x) => x.drawDate as string));

  let expected: string[] = [];
  const missing: MissingDraw[] = [];
  let overdue: string[] = [];
  if (first && latest) {
    expected = expectedDrawDates(first, latest, i.expectedWeekdays);
    for (const d of expected) {
      if (!have.has(d)) missing.push({ date: d, reason: rejectedDates.has(d) ? "rejected_by_validation" : "not_in_source" });
    }
    const yesterday = addDays(i.today, -1);
    if (yesterday > latest) overdue = expectedDrawDates(addDays(latest, 1), yesterday, i.expectedWeekdays);
  }

  const by = new Map<string, number>();
  for (const d of draws) by.set(d.source, (by.get(d.source) ?? 0) + 1);

  const k = i.issueCounts;
  const sumOcc = (kind: IssueKindName) => i.issues.filter((x) => x.kind === kind).reduce((s, x) => s + x.occurrences, 0);
  const withConflict = draws.filter((d) => d.hasConflict).length;
  const abnormal = withConflict + missing.filter((m) => m.reason === "rejected_by_validation").length + (k.UNEXPECTED_WEEKDAY ?? 0);

  const lastRun = i.runs[0] ?? null;
  const daysSince = latest ? daysBetween(latest, i.today) : null;

  // overall status
  const reasons: string[] = [];
  let status: HealthStatus = "healthy";
  const bump = (s: HealthStatus) => {
    const rank: Record<HealthStatus, number> = { healthy: 0, warning: 1, critical: 2, empty: 3 };
    if (rank[s] > rank[status]) status = s;
  };
  if (draws.length === 0) {
    status = "empty";
    reasons.push("ยังไม่มีข้อมูลในฐานข้อมูล — รันการดึงข้อมูล (npm run ingest:full)");
  } else {
    if (lastRun?.status === "FAILED") {
      bump("warning");
      reasons.push(`การดึงข้อมูลครั้งล่าสุดล้มเหลว (${lastRun.errorCode ?? "UNKNOWN"})`);
    }
    if (missing.length > 0) {
      bump("warning");
      reasons.push(`พบงวดที่ควรมีแต่ไม่มีข้อมูล ${missing.length} งวด`);
    }
    if (withConflict > 0) {
      bump("critical");
      reasons.push(`พบข้อมูลที่แหล่งข้อมูลขัดแย้งกัน ${withConflict} งวด`);
    }
    if ((k.INVALID_DATE ?? 0) + (k.INVALID_NUMBER_FORMAT ?? 0) + (k.DERIVED_DIGIT_MISMATCH ?? 0) + (k.MISSING_FIELD ?? 0) > 0) {
      bump("warning");
      reasons.push("มีข้อมูลที่ไม่ผ่านการตรวจสอบและถูกกันออก (ดูรายการด้านล่าง)");
    }
    if (overdue.length > 0) {
      bump("warning");
      reasons.push(`ข้อมูลล่าสุดอาจล้าหลัง: มีงวดตามตาราง ${overdue.length} งวดที่ยังไม่มีในระบบ`);
    }
  }

  return {
    generatedAt: (i.now ?? new Date()).toISOString(),
    status,
    reasons,
    totals: {
      records: draws.length,
      firstDate: first,
      latestDate: latest,
      recordsWithConflict: withConflict,
      bySource: [...by.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    },
    schedule: {
      expectedWeekdays: i.expectedWeekdays,
      expectedDraws: expected.length,
      presentDraws: expected.length - missing.length,
      missingCount: missing.length,
      coveragePercent: expected.length ? Math.round(((expected.length - missing.length) / expected.length) * 1000) / 10 : null,
      missing,
      overdue,
    },
    issues: {
      distinct: Object.values(k).reduce((a, b) => a + (b ?? 0), 0),
      abnormalRecords: abnormal,
      byKind: k,
      duplicateRows: sumOcc("DUPLICATE_IN_SOURCE"),
      invalidDate: (k.INVALID_DATE ?? 0) + (k.FUTURE_DATE ?? 0),
      invalidNumberFormat: k.INVALID_NUMBER_FORMAT ?? 0,
      derivedMismatch: k.DERIVED_DIGIT_MISMATCH ?? 0,
      sourceConflict: k.SOURCE_CONFLICT ?? 0,
      quarantined: k.UNEXPECTED_WEEKDAY ?? 0,
      recent: i.issues.slice(0, 50),
    },
    freshness: {
      latestDrawDate: latest,
      daysSinceLatestDraw: daysSince,
      lastSuccessfulRunAt: i.lastSuccessfulRunAt,
      lastRunStatus: lastRun?.status ?? null,
    },
    runs: i.runs,
  };
}
