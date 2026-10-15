import { Prisma, type PrismaClient } from "../../generated/prisma/client.ts";
import type { DataIssueRecord, DrawRecord, IngestionRunRecord, IssueInput, IssueKindName, RunStatusName } from "../domain";
import { fromDate, toDate } from "../dates";
import type { Observation } from "../ingestion/reconcile";
import { planBatch, type DrawState } from "./plan";
import { issueFingerprint, type DrawQuery, type DrawStore, type IngestBatchInput, type IngestBatchResult, type RunPatch } from "./store";

type DrawRow = Prisma.DrawGetPayload<object>;
type RunRow = Prisma.IngestionRunGetPayload<object>;
type IssueRow = Prisma.DataIssueGetPayload<object>;

const toDraw = (r: DrawRow): DrawRecord => ({
  drawDate: fromDate(r.drawDate),
  drawId: r.drawId,
  result4: r.result4,
  result3: r.result3,
  result2: r.result2,
  source: r.source,
  sourceUrl: r.sourceUrl,
  fetchedAt: r.fetchedAt.toISOString(),
  hasConflict: r.hasConflict,
  sourceCount: r.sourceCount,
});

const toRun = (r: RunRow): IngestionRunRecord => ({
  id: r.id,
  sourceId: r.sourceId,
  trigger: r.trigger,
  status: r.status as RunStatusName,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  pagesFetched: r.pagesFetched,
  recordsParsed: r.recordsParsed,
  recordsValid: r.recordsValid,
  inserted: r.inserted,
  updated: r.updated,
  unchanged: r.unchanged,
  quarantined: r.quarantined,
  invalid: r.invalid,
  duplicates: r.duplicates,
  conflicts: r.conflicts,
  errorCode: r.errorCode,
  errorMessage: r.errorMessage,
});

const toIssue = (r: IssueRow): DataIssueRecord => ({
  id: r.id,
  fingerprint: r.fingerprint,
  kind: r.kind as IssueKindName,
  severity: r.severity,
  sourceId: r.sourceId,
  drawDate: r.drawDate ? fromDate(r.drawDate) : null,
  message: r.message,
  details: (r.details as Record<string, unknown> | null) ?? null,
  occurrences: r.occurrences,
  firstSeenAt: r.firstSeenAt.toISOString(),
  lastSeenAt: r.lastSeenAt.toISOString(),
});

const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

export class PrismaDrawStore implements DrawStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly lotteryCode = "LAO_DEV",
  ) {}

  private dateWhere(q: Pick<DrawQuery, "from" | "to">): Prisma.DrawWhereInput {
    const range: Prisma.DateTimeFilter = {};
    if (q.from) range.gte = toDate(q.from);
    if (q.to) range.lte = toDate(q.to);
    return { lotteryCode: this.lotteryCode, ...(q.from || q.to ? { drawDate: range } : {}) };
  }

  async findDraws(q: DrawQuery = {}): Promise<DrawRecord[]> {
    const rows = await this.prisma.draw.findMany({
      where: this.dateWhere(q),
      orderBy: { drawDate: q.order === "desc" ? "desc" : "asc" },
      take: q.limit,
      skip: q.offset,
    });
    return rows.map(toDraw);
  }

  async countDraws(q: Pick<DrawQuery, "from" | "to"> = {}): Promise<number> {
    return this.prisma.draw.count({ where: this.dateWhere(q) });
  }

  async getLatestDraw(): Promise<DrawRecord | null> {
    const row = await this.prisma.draw.findFirst({ where: { lotteryCode: this.lotteryCode }, orderBy: { drawDate: "desc" } });
    return row ? toDraw(row) : null;
  }

  async ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult> {
    const dates = [...new Set(input.records.map((r) => r.drawDate))].map(toDate);
    return this.prisma.$transaction(
      async (tx) => {
        const [obsRows, drawRows] = await Promise.all([
          tx.sourceRecord.findMany({ where: { lotteryCode: input.lotteryCode, drawDate: { in: dates } } }),
          tx.draw.findMany({ where: { lotteryCode: input.lotteryCode, drawDate: { in: dates } } }),
        ]);
        const observations = new Map<string, Observation[]>();
        for (const o of obsRows) {
          const date = fromDate(o.drawDate);
          const list = observations.get(date) ?? [];
          list.push({
            sourceId: o.sourceId,
            priority: input.priorities[o.sourceId] ?? 1000,
            drawId: o.drawId,
            result4: o.result4,
            result3: o.result3,
            result2: o.result2,
            sourceUrl: o.sourceUrl,
            fetchedAt: o.fetchedAt.toISOString(),
            extra: null,
          });
          observations.set(date, list);
        }
        const draws = new Map<string, DrawState>();
        for (const d of drawRows) {
          draws.set(fromDate(d.drawDate), {
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

        const plan = planBatch(input, { observations, draws });

        for (const o of plan.observationWrites) {
          const date = toDate(o.drawDate);
          const data = {
            drawId: o.drawId,
            result4: o.result4,
            result3: o.result3,
            result2: o.result2,
            sourceUrl: o.sourceUrl,
            fetchedAt: new Date(o.fetchedAt),
            rawPayload: json(o.rawPayload),
          };
          await tx.sourceRecord.upsert({
            where: { sourceId_lotteryCode_drawDate: { sourceId: o.sourceId, lotteryCode: input.lotteryCode, drawDate: date } },
            create: { sourceId: o.sourceId, lotteryCode: input.lotteryCode, drawDate: date, ...data },
            update: data,
          });
        }
        for (const w of plan.drawWrites) {
          const date = toDate(w.drawDate);
          const data = {
            drawId: w.drawId,
            result4: w.result4,
            result3: w.result3,
            result2: w.result2,
            source: w.source,
            sourceUrl: w.sourceUrl,
            fetchedAt: new Date(w.fetchedAt),
            sourceCount: w.sourceCount,
            hasConflict: w.hasConflict,
            extra: json(w.extra),
          };
          await tx.draw.upsert({
            where: { lotteryCode_drawDate: { lotteryCode: input.lotteryCode, drawDate: date } },
            create: { lotteryCode: input.lotteryCode, drawDate: date, ...data },
            update: data,
          });
        }
        return plan.result;
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  }

  async saveIssues(issues: IssueInput[], runId: number | null): Promise<void> {
    if (issues.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      for (const i of issues) {
        const fingerprint = issueFingerprint(i);
        const date = i.drawDate ? toDate(i.drawDate) : null;
        await tx.dataIssue.upsert({
          where: { fingerprint },
          create: {
            fingerprint,
            kind: i.kind,
            severity: i.severity,
            sourceId: i.sourceId,
            drawDate: date,
            message: i.message,
            details: json(i.details),
            lastRunId: runId,
          },
          update: {
            severity: i.severity,
            message: i.message,
            details: json(i.details),
            occurrences: { increment: 1 },
            lastSeenAt: new Date(),
            lastRunId: runId,
          },
        });
      }
    });
  }

  async listIssues(opts: { kind?: IssueKindName; limit?: number } = {}): Promise<DataIssueRecord[]> {
    const rows = await this.prisma.dataIssue.findMany({
      where: opts.kind ? { kind: opts.kind } : undefined,
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: opts.limit ?? 200,
    });
    return rows.map(toIssue);
  }

  async issueCounts(): Promise<Partial<Record<IssueKindName, number>>> {
    const groups = await this.prisma.dataIssue.groupBy({ by: ["kind"], _count: { _all: true } });
    const out: Partial<Record<IssueKindName, number>> = {};
    for (const g of groups) out[g.kind as IssueKindName] = g._count._all;
    return out;
  }

  async startRun(sourceId: string, trigger: string): Promise<IngestionRunRecord> {
    return toRun(await this.prisma.ingestionRun.create({ data: { sourceId, trigger } }));
  }

  async finishRun(id: number, patch: RunPatch): Promise<IngestionRunRecord> {
    const { finishedAt, status, ...rest } = patch;
    return toRun(
      await this.prisma.ingestionRun.update({
        where: { id },
        data: { ...rest, ...(status ? { status } : {}), finishedAt: finishedAt ? new Date(finishedAt) : new Date() },
      }),
    );
  }

  async listRuns(limit = 20): Promise<IngestionRunRecord[]> {
    return (await this.prisma.ingestionRun.findMany({ orderBy: { startedAt: "desc" }, take: limit })).map(toRun);
  }

  async lastSuccessfulRunAt(): Promise<string | null> {
    const row = await this.prisma.ingestionRun.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL"] }, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
    });
    return row?.finishedAt?.toISOString() ?? null;
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
