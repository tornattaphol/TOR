import { conflicts, reconcile, sameValues, type Observation } from "../ingestion/reconcile";
import type { BatchConflict, IngestBatchInput, IngestBatchResult } from "./store";

export interface DrawState {
  drawId: string;
  result4: string | null;
  result3: string | null;
  result2: string;
  source: string;
  sourceUrl: string;
  hasConflict: boolean;
  sourceCount: number;
}

export interface ObservationWrite extends Observation {
  drawDate: string;
  rawPayload: unknown;
}

export interface DrawWrite extends DrawState {
  drawDate: string;
  fetchedAt: string;
  extra: Record<string, unknown> | null;
  kind: "insert" | "update";
}

function drawStateEqual(a: DrawState, b: DrawState): boolean {
  return (
    a.drawId === b.drawId &&
    a.result4 === b.result4 &&
    a.result3 === b.result3 &&
    a.result2 === b.result2 &&
    a.source === b.source &&
    a.sourceUrl === b.sourceUrl &&
    a.hasConflict === b.hasConflict &&
    a.sourceCount === b.sourceCount
  );
}

export interface BatchPlan {
  observationWrites: ObservationWrite[];
  drawWrites: DrawWrite[];
  result: IngestBatchResult;
}

export interface PlanState {
  /** date → observations currently stored (all sources), with priority resolved by caller. */
  observations: Map<string, Observation[]>;
  draws: Map<string, DrawState>;
}

const view = (o: { result4: string | null; result3: string | null; result2: string }) => ({
  result4: o.result4,
  result3: o.result3,
  result2: o.result2,
});

/**
 * Pure planning step of an ingestion batch: decides which observations and canonical draws to write and
 * which conflicts to report. Stores only load state, call this, and apply the writes — so memory and
 * PostgreSQL stores cannot diverge.
 */
export function planBatch(input: IngestBatchInput, state: PlanState): BatchPlan {
  const priorityOf = (id: string) => input.priorities[id] ?? 1000;
  const result: IngestBatchResult = { inserted: 0, updated: 0, unchanged: 0, conflicts: [] };
  const observationWrites: ObservationWrite[] = [];
  const drawWrites: DrawWrite[] = [];
  const draws = new Map(state.draws);

  // Work on a private copy so planning has no side effects on the caller's maps.
  const obsByDate = new Map<string, Observation[]>();
  for (const [d, list] of state.observations) obsByDate.set(d, list.map((o) => ({ ...o })));

  for (const rec of input.records) {
    const incoming: Observation = {
      sourceId: rec.sourceId,
      priority: priorityOf(rec.sourceId),
      drawId: rec.drawId,
      result4: rec.result4,
      result3: rec.result3,
      result2: rec.result2,
      sourceUrl: rec.sourceUrl,
      fetchedAt: rec.fetchedAt,
      extra: rec.extra,
    };
    const list = obsByDate.get(rec.drawDate) ?? [];
    const prevIdx = list.findIndex((o) => o.sourceId === rec.sourceId);
    const found = prevIdx >= 0 ? list[prevIdx] : undefined;
    const conflictList: BatchConflict[] = [];

    if (found && !sameValues(found, incoming)) {
      conflictList.push({
        drawDate: rec.drawDate,
        reason: "revised_by_source",
        details: { sourceId: rec.sourceId, previous: view(found), current: view(incoming) },
      });
    }
    if (prevIdx >= 0) list[prevIdx] = incoming;
    else list.push(incoming);
    obsByDate.set(rec.drawDate, list);
    observationWrites.push({ ...incoming, drawDate: rec.drawDate, rawPayload: rec.rawPayload });

    const others = list.filter((o) => o.sourceId !== rec.sourceId && conflicts(o, incoming));
    if (others.length > 0) {
      conflictList.push({
        drawDate: rec.drawDate,
        reason: "cross_source",
        details: {
          values: [incoming, ...others]
            .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
            .map((o) => ({ sourceId: o.sourceId, ...view(o), url: o.sourceUrl })),
        },
      });
    }
    result.conflicts.push(...conflictList);

    const rec2 = reconcile(list);
    const next: DrawState = {
      drawId: rec.drawId,
      result4: rec2.result4,
      result3: rec2.result3,
      result2: rec2.result2,
      source: rec2.canonical.sourceId,
      sourceUrl: rec2.canonical.sourceUrl,
      hasConflict: rec2.hasConflict,
      sourceCount: rec2.sourceCount,
    };
    const existing = draws.get(rec.drawDate);
    if (!existing) {
      result.inserted++;
      drawWrites.push({ ...next, drawDate: rec.drawDate, fetchedAt: rec2.canonical.fetchedAt, extra: rec2.canonical.extra, kind: "insert" });
    } else if (!drawStateEqual(existing, next)) {
      result.updated++;
      drawWrites.push({ ...next, drawDate: rec.drawDate, fetchedAt: rec2.canonical.fetchedAt, extra: rec2.canonical.extra, kind: "update" });
    } else {
      result.unchanged++;
    }
    draws.set(rec.drawDate, next);
  }
  return { observationWrites, drawWrites, result };
}
