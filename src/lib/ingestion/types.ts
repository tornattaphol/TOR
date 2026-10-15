import type { IngestionErrorCode, IssueInput } from "../domain";

/**
 * Output of a Parser: values exactly as published (untrusted). The Validator decides what is acceptable.
 */
export interface RawRecord {
  sourceUrl: string;
  fetchedAt: string;
  /** Date text as published (for error messages). */
  dateText: string;
  /** Parser's best-effort ISO date, or null if the published date could not be interpreted. */
  isoDate: string | null;
  result4?: string | null;
  result3?: string | null;
  result2?: string | null;
  /** Source-specific extras (kept in Draw.extra). */
  extra?: Record<string, unknown>;
  /** Raw excerpt kept for audit (SourceRecord.rawPayload). */
  raw?: unknown;
}

export interface ValidRecord {
  drawDate: string;
  drawId: string;
  result4: string | null;
  result3: string | null;
  result2: string;
  sourceId: string;
  sourceUrl: string;
  fetchedAt: string;
  extra: Record<string, unknown> | null;
  rawPayload: unknown;
}

export interface CollectResult {
  pagesFetched: number;
  records: RawRecord[];
  /** Non-fatal observations from the parser (e.g. date text/URL mismatch). */
  warnings: string[];
}

export interface ValidationResult {
  valid: ValidRecord[];
  issues: IssueInput[];
  counts: { invalid: number; quarantined: number; duplicates: number; conflicts: number };
}

export class IngestionError extends Error {
  constructor(
    readonly code: IngestionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}
