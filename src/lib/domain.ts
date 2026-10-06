/** Shared domain types. Dates are ISO calendar strings ("YYYY-MM-DD", Asia/Vientiane calendar date). */

export const LOTTERY_CODE = "LAO_DEV";

/** Which result column an analysis targets: last 2, last 3 or all 4 digits. */
export type PrizeType = "2" | "3" | "4";
export const PRIZE_TYPES: PrizeType[] = ["2", "3", "4"];

export interface DrawRecord {
  drawDate: string;
  drawId: string;
  result4: string | null;
  result3: string | null;
  result2: string;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  hasConflict: boolean;
  sourceCount: number;
}

/** Result string for a prize type, or null when the source did not publish it. */
export function resultOf(draw: DrawRecord, prize: PrizeType): string | null {
  return prize === "2" ? draw.result2 : prize === "3" ? draw.result3 : draw.result4;
}

export type IssueKindName =
  | "DUPLICATE_IN_SOURCE"
  | "INVALID_DATE"
  | "INVALID_NUMBER_FORMAT"
  | "DERIVED_DIGIT_MISMATCH"
  | "UNEXPECTED_WEEKDAY"
  | "FUTURE_DATE"
  | "MISSING_FIELD"
  | "SOURCE_CONFLICT";

export type IssueSeverityName = "INFO" | "WARNING" | "ERROR";

export interface IssueInput {
  kind: IssueKindName;
  severity: IssueSeverityName;
  sourceId: string;
  drawDate: string | null;
  message: string;
  details?: Record<string, unknown>;
}

export type RunStatusName = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

export type IngestionErrorCode =
  | "SOURCE_UNAVAILABLE"
  | "ROBOTS_DISALLOWED"
  | "EMPTY_RESPONSE"
  | "LAYOUT_CHANGED"
  | "PARSE_ERROR"
  | "NO_VALID_RECORDS"
  | "CONFIG_ERROR"
  | "UNEXPECTED";

export interface IngestionRunRecord {
  id: number;
  sourceId: string;
  trigger: string;
  status: RunStatusName;
  startedAt: string;
  finishedAt: string | null;
  pagesFetched: number;
  recordsParsed: number;
  recordsValid: number;
  inserted: number;
  updated: number;
  unchanged: number;
  quarantined: number;
  invalid: number;
  duplicates: number;
  conflicts: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface DataIssueRecord {
  id: number;
  fingerprint: string;
  kind: IssueKindName;
  severity: IssueSeverityName;
  sourceId: string;
  drawDate: string | null;
  message: string;
  details: Record<string, unknown> | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}
