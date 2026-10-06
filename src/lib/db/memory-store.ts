import type { DataIssueRecord, DrawRecord, IngestionRunRecord, IssueInput, IssueKindName } from "../domain";
import type { Observation } from "../ingestion/reconcile";
import { planBatch, type DrawState } from "./plan";
import { issueFingerprint, type DrawQuery, type DrawStore, type IngestBatchInput, type IngestBatchResult, type RunPatch } from "./store";

interface StoredDraw extends DrawRecord {
  lotteryCode: string;
}

/**
 * In-memory DrawStore used by unit/API tests. It is a contract-equivalent of PrismaDrawStore (same planBatch)
 * and is never used to serve production data.
 */
export class MemoryDrawStore implements DrawStore {
  private draws = new Map<string, StoredDraw>(); // key: date
  private observations = new Map<string, Observation & { drawDate: string; rawPayload: unknown }>(); // key: source|date
  private issues = new Map<string, DataIssueRecord>();
  private runs: IngestionRunRecord[] = [];
  private nextIssueId = 1;
  private nextRunId = 1;

  async findDraws(q: DrawQuery = {}): Promise<DrawRecord[]> {
    let rows = [...this.draws.values()].filter((d) => (!q.from || d.drawDate >= q.from) && (!q.to || d.drawDate <= q.to));
    rows.sort((a, b) => a.drawDate.localeCompare(b.drawDate));
    if (q.order === "desc") rows.reverse();
    const offset = q.offset ?? 0;
    rows = rows.slice(offset, q.limit !== undefined ? offset + q.limit : undefined);
    return rows.map(({ lotteryCode: _l, ...d }) => ({ ...d }));
  }

  async countDraws(q: Pick<DrawQuery, "from" | "to"> = {}): Promise<number> {
    return [...this.draws.values()].filter((d) => (!q.from || d.drawDate >= q.from) && (!q.to || d.drawDate <= q.to)).length;
  }

  async getLatestDraw(): Promise<DrawRecord | null> {
    const [d] = await this.findDraws({ order: "desc", limit: 1 });
    return d ?? null;
  }

  async ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult> {
    const obsByDate = new Map<string, Observation[]>();
    for (const o of this.observations.values()) {
      const list = obsByDate.get(o.drawDate) ?? [];
      list.push(o);
      obsByDate.set(o.drawDate, list);
    }
    const drawState = new Map<string, DrawState>();
    for (const [date, d] of this.draws) {
      drawState.set(date, {
        drawId: d.drawId,
        result4: d.result4,
        result3: d.result3,
        result2: d.result2,
        source: d.source,
        sourceUrl: d.sourceUrl,
        hasConflict: d.hasConflict,
        sourceCount: d.sourceCount,
      });
    }
    const plan = planBatch(input, { observations: obsByDate, draws: drawState });

    for (const o of plan.observationWrites) this.observations.set(`${o.sourceId}|${o.drawDate}`, { ...o });
    for (const w of plan.drawWrites) {
      this.draws.set(w.drawDate, {
        lotteryCode: input.lotteryCode,
        drawDate: w.drawDate,
        drawId: w.drawId,
        result4: w.result4,
        result3: w.result3,
        result2: w.result2,
        source: w.source,
        sourceUrl: w.sourceUrl,
        fetchedAt: w.fetchedAt,
        hasConflict: w.hasConflict,
        sourceCount: w.sourceCount,
      });
    }
    return plan.result;
  }

  async saveIssues(issues: IssueInput[], runId: number | null): Promise<void> {
    const now = new Date().toISOString();
    for (const i of issues) {
      const fp = issueFingerprint(i);
      const prev = this.issues.get(fp);
      if (prev) {
        prev.occurrences += 1;
        prev.lastSeenAt = now;
        prev.severity = i.severity;
        prev.details = i.details ?? null;
      } else {
        this.issues.set(fp, {
          id: this.nextIssueId++,
          fingerprint: fp,
          kind: i.kind,
          severity: i.severity,
          sourceId: i.sourceId,
          drawDate: i.drawDate,
          message: i.message,
          details: i.details ?? null,
          occurrences: 1,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    }
    void runId;
  }

  async listIssues(opts: { kind?: IssueKindName; limit?: number } = {}): Promise<DataIssueRecord[]> {
    return [...this.issues.values()]
      .filter((i) => !opts.kind || i.kind === opts.kind)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || b.id - a.id)
      .slice(0, opts.limit ?? 200)
      .map((i) => ({ ...i }));
  }

  async issueCounts(): Promise<Partial<Record<IssueKindName, number>>> {
    const out: Partial<Record<IssueKindName, number>> = {};
    for (const i of this.issues.values()) out[i.kind] = (out[i.kind] ?? 0) + 1;
    return out;
  }

  async startRun(sourceId: string, trigger: string): Promise<IngestionRunRecord> {
    const run: IngestionRunRecord = {
      id: this.nextRunId++,
      sourceId,
      trigger,
      status: "RUNNING",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      pagesFetched: 0,
      recordsParsed: 0,
      recordsValid: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      quarantined: 0,
      invalid: 0,
      duplicates: 0,
      conflicts: 0,
      errorCode: null,
      errorMessage: null,
    };
    this.runs.push(run);
    return { ...run };
  }

  async finishRun(id: number, patch: RunPatch): Promise<IngestionRunRecord> {
    const run = this.runs.find((r) => r.id === id);
    if (!run) throw new Error(`Run ${id} not found`);
    Object.assign(run, patch, { finishedAt: patch.finishedAt ?? new Date().toISOString() });
    return { ...run };
  }

  async listRuns(limit = 20): Promise<IngestionRunRecord[]> {
    return [...this.runs].reverse().slice(0, limit).map((r) => ({ ...r }));
  }

  async lastSuccessfulRunAt(): Promise<string | null> {
    const ok = this.runs.filter((r) => (r.status === "SUCCESS" || r.status === "PARTIAL") && r.finishedAt);
    return ok.length ? ok.map((r) => r.finishedAt as string).sort().pop() ?? null : null;
  }
}
