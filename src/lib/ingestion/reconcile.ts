/**
 * Pure conflict-resolution logic shared by every store implementation, so the in-memory store used in
 * tests and the PostgreSQL store behave identically.
 */

export interface Observation {
  sourceId: string;
  priority: number;
  drawId: string;
  result4: string | null;
  result3: string | null;
  result2: string;
  sourceUrl: string;
  fetchedAt: string;
  extra: Record<string, unknown> | null;
}

export interface Reconciled {
  canonical: Observation;
  /** Final values (canonical values, with missing digits filled from agreeing sources only). */
  result4: string | null;
  result3: string | null;
  result2: string;
  hasConflict: boolean;
  sourceCount: number;
}

type Fields = Pick<Observation, "result4" | "result3" | "result2">;

/** Two observations conflict when any field published by both differs. */
export function conflicts(a: Fields, b: Fields): boolean {
  if (a.result2 !== b.result2) return true;
  if (a.result3 !== null && b.result3 !== null && a.result3 !== b.result3) return true;
  if (a.result4 !== null && b.result4 !== null && a.result4 !== b.result4) return true;
  return false;
}

export function sameValues(a: Fields, b: Fields): boolean {
  return a.result4 === b.result4 && a.result3 === b.result3 && a.result2 === b.result2;
}

export function reconcile(observations: Observation[]): Reconciled {
  if (observations.length === 0) throw new Error("reconcile() needs at least one observation");
  const ranked = [...observations].sort(
    (x, y) =>
      x.priority - y.priority ||
      y.fetchedAt.localeCompare(x.fetchedAt) ||
      x.sourceId.localeCompare(y.sourceId),
  );
  const canonical = ranked[0];
  let hasConflict = false;
  for (let i = 0; i < ranked.length && !hasConflict; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      if (conflicts(ranked[i], ranked[j])) {
        hasConflict = true;
        break;
      }
    }
  }
  let { result4, result3 } = canonical;
  if (!hasConflict) {
    // Agreeing sources may complete digits the canonical source did not publish.
    for (const o of ranked.slice(1)) {
      if (result4 === null && o.result4 !== null) result4 = o.result4;
      if (result3 === null && o.result3 !== null) result3 = o.result3;
    }
  }
  return { canonical, result4, result3, result2: canonical.result2, hasConflict, sourceCount: new Set(ranked.map((o) => o.sourceId)).size };
}
