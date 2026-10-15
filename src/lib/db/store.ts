import type {
  DataIssueRecord,
  DrawRecord,
  IngestionRunRecord,
  IssueInput,
  IssueKindName,
  RunStatusName,
} from "../domain";
import type { ValidRecord } from "../ingestion/types";

export interface DrawQuery {
  /** Inclusive ISO dates. */
  from?: string;
  to?: string;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface IngestBatchInput {
  sourceId: string;
  lotteryCode: string;
  /** source id → priority (lower wins). Unknown ids rank last. */
  priorities: Record<string, number>;
  records: ValidRecord[];
}

export interface BatchConflict {
  drawDate: string;
  reason: "cross_source" | "revised_by_source";
  details: Record<string, unknown>;
}

export interface IngestBatchResult {
  inserted: number;
  updated: number;
  unchanged: number;
  conflicts: BatchConflict[];
}

export interface RunPatch {
  status?: RunStatusName;
  finishedAt?: string | null;
  pagesFetched?: number;
  recordsParsed?: number;
  recordsValid?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  quarantined?: number;
  invalid?: number;
  duplicates?: number;
  conflicts?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
}

/** Persistence port. Implemented by PrismaDrawStore (PostgreSQL) and MemoryDrawStore (tests). */
export interface DrawStore {
  findDraws(q?: DrawQuery): Promise<DrawRecord[]>;
  countDraws(q?: Pick<DrawQuery, "from" | "to">): Promise<number>;
  getLatestDraw(): Promise<DrawRecord | null>;

  /** Atomically upserts observations + canonical draws. */
  ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult>;

  saveIssues(issues: IssueInput[], runId: number | null): Promise<void>;
  listIssues(opts?: { kind?: IssueKindName; limit?: number }): Promise<DataIssueRecord[]>;
  /** Number of distinct issues per kind. */
  issueCounts(): Promise<Partial<Record<IssueKindName, number>>>;

  startRun(sourceId: string, trigger: string): Promise<IngestionRunRecord>;
  finishRun(id: number, patch: RunPatch): Promise<IngestionRunRecord>;
  listRuns(limit?: number): Promise<IngestionRunRecord[]>;
  /** finishedAt of the most recent run that stored data (SUCCESS or PARTIAL). */
  lastSuccessfulRunAt(): Promise<string | null>;

  close?(): Promise<void>;
}

import { createHash } from "node:crypto";

/** Stable identity of a data-quality finding so repeated runs update one row instead of piling up. */
export function issueFingerprint(i: IssueInput): string {
  const h = createHash("sha1").update(i.message).digest("hex").slice(0, 12);
  return `${i.kind}:${i.sourceId}:${i.drawDate ?? "none"}:${h}`;
}
