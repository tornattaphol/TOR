import type { IssueInput } from "../domain";
import { isValidIsoDate, weekdayOf, THAI_WEEKDAYS } from "../dates";
import type { RawRecord, ValidRecord, ValidationResult } from "./types";

export interface ValidatorOptions {
  sourceId: string;
  lotteryCode: string;
  expectedWeekdays: number[];
  /** Today's calendar date in the draw time zone (injected for deterministic tests). */
  today: string;
}

const RE4 = /^\d{4}$/;
const RE3 = /^\d{3}$/;
const RE2 = /^\d{2}$/;

export function canonicalDrawId(lotteryCode: string, isoDate: string): string {
  return `${lotteryCode.toLowerCase()}_${isoDate.replaceAll("-", "")}`;
}

const present = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Validator layer. Treats every parsed value as untrusted.
 *  - invalid / future dates, malformed numbers, inconsistent derived digits → rejected (ERROR)
 *  - unexpected weekday → quarantined (WARNING): kept out of the dataset but visible in Data Health
 *  - repeated rows for one date: identical → duplicate (INFO), different → conflict (ERROR, date dropped)
 */
export function validateRecords(raws: RawRecord[], opts: ValidatorOptions): ValidationResult {
  const issues: IssueInput[] = [];
  const counts = { invalid: 0, quarantined: 0, duplicates: 0, conflicts: 0 };
  const accepted: ValidRecord[] = [];

  const issue = (i: Omit<IssueInput, "sourceId">) => issues.push({ ...i, sourceId: opts.sourceId });

  for (const r of raws) {
    // 1. date
    if (!r.isoDate || !isValidIsoDate(r.isoDate)) {
      counts.invalid++;
      issue({
        kind: "INVALID_DATE",
        severity: "ERROR",
        drawDate: null,
        message: `Invalid or unreadable draw date "${r.dateText}"`,
        details: { dateText: r.dateText, sourceUrl: r.sourceUrl },
      });
      continue;
    }
    const date = r.isoDate;
    if (date > opts.today) {
      counts.invalid++;
      issue({
        kind: "FUTURE_DATE",
        severity: "ERROR",
        drawDate: date,
        message: `Draw date ${date} is in the future (today is ${opts.today})`,
        details: { sourceUrl: r.sourceUrl },
      });
      continue;
    }

    // 2. number formats (a present-but-malformed value is an error, never "fixed")
    const fmtErrors: string[] = [];
    const v4 = present(r.result4) ? r.result4.trim() : null;
    let v3 = present(r.result3) ? r.result3.trim() : null;
    let v2 = present(r.result2) ? r.result2.trim() : null;
    if (v4 !== null && !RE4.test(v4)) fmtErrors.push(`result4="${r.result4}"`);
    if (v3 !== null && !RE3.test(v3)) fmtErrors.push(`result3="${r.result3}"`);
    if (v2 !== null && !RE2.test(v2)) fmtErrors.push(`result2="${r.result2}"`);
    if (fmtErrors.length) {
      counts.invalid++;
      issue({
        kind: "INVALID_NUMBER_FORMAT",
        severity: "ERROR",
        drawDate: date,
        message: `Malformed number(s) on ${date}: ${fmtErrors.join(", ")}`,
        details: { sourceUrl: r.sourceUrl, raw: r.raw ?? null },
      });
      continue;
    }
    if (v4 === null && v3 === null && v2 === null) {
      counts.invalid++;
      issue({
        kind: "MISSING_FIELD",
        severity: "ERROR",
        drawDate: date,
        message: `No result numbers published for ${date}`,
        details: { sourceUrl: r.sourceUrl },
      });
      continue;
    }

    // 3. derived digits must agree: last 3 / last 2 are the tail of the 4-digit number
    const derived: string[] = [];
    const tail3 = v4 !== null ? v4.slice(1) : null;
    const base3 = v3 ?? tail3;
    const tail2 = base3 !== null ? base3.slice(1) : null;
    if (tail3 !== null && v3 !== null && v3 !== tail3) {
      counts.invalid++;
      issue({
        kind: "DERIVED_DIGIT_MISMATCH",
        severity: "ERROR",
        drawDate: date,
        message: `Last-3 (${v3}) does not match the tail of the 4-digit result (${v4}) on ${date}`,
        details: { result4: v4, result3: v3, sourceUrl: r.sourceUrl },
      });
      continue;
    }
    if (tail2 !== null && v2 !== null && v2 !== tail2) {
      counts.invalid++;
      issue({
        kind: "DERIVED_DIGIT_MISMATCH",
        severity: "ERROR",
        drawDate: date,
        message: `Last-2 (${v2}) does not match the tail of the published result (${base3}) on ${date}`,
        details: { result4: v4, result3: v3, result2: v2, sourceUrl: r.sourceUrl },
      });
      continue;
    }
    if (v3 === null && tail3 !== null) {
      v3 = tail3;
      derived.push("result3");
    }
    if (v2 === null && tail2 !== null) {
      v2 = tail2;
      derived.push("result2");
    }
    if (v2 === null) {
      counts.invalid++;
      issue({
        kind: "MISSING_FIELD",
        severity: "ERROR",
        drawDate: date,
        message: `Cannot determine the 2-digit result for ${date}`,
        details: { sourceUrl: r.sourceUrl },
      });
      continue;
    }

    // 4. schedule: draws outside the expected weekdays are quarantined, not stored
    if (!opts.expectedWeekdays.includes(weekdayOf(date))) {
      counts.quarantined++;
      issue({
        kind: "UNEXPECTED_WEEKDAY",
        severity: "WARNING",
        drawDate: date,
        message: `Result dated ${date} falls on ${THAI_WEEKDAYS[weekdayOf(date)]}, which is not a scheduled draw day for this source — quarantined`,
        details: { result4: v4, result3: v3, result2: v2, sourceUrl: r.sourceUrl, expectedWeekdays: opts.expectedWeekdays },
      });
      continue;
    }

    accepted.push({
      drawDate: date,
      drawId: canonicalDrawId(opts.lotteryCode, date),
      result4: v4,
      result3: v3,
      result2: v2,
      sourceId: opts.sourceId,
      sourceUrl: r.sourceUrl,
      fetchedAt: r.fetchedAt,
      extra: { ...(r.extra ?? {}), ...(derived.length ? { derivedFields: derived } : {}) },
      rawPayload: r.raw ?? null,
    });
  }

  // 5. duplicates / conflicts inside one payload
  const byDate = new Map<string, ValidRecord[]>();
  for (const a of accepted) {
    const list = byDate.get(a.drawDate);
    if (list) list.push(a);
    else byDate.set(a.drawDate, [a]);
  }
  const valid: ValidRecord[] = [];
  for (const [date, list] of byDate) {
    if (list.length === 1) {
      valid.push(list[0]);
      continue;
    }
    const keys = new Set(list.map((x) => `${x.result4 ?? ""}|${x.result3 ?? ""}|${x.result2}`));
    if (keys.size === 1) {
      counts.duplicates += list.length - 1;
      issue({
        kind: "DUPLICATE_IN_SOURCE",
        severity: "INFO",
        drawDate: date,
        message: `${list.length} identical rows for ${date} in the same source payload; kept one`,
        details: { rows: list.length },
      });
      valid.push(list[0]);
    } else {
      counts.conflicts++;
      issue({
        kind: "SOURCE_CONFLICT",
        severity: "ERROR",
        drawDate: date,
        message: `The same source reports different results for ${date}; date skipped until resolved`,
        details: { reason: "conflict_within_source", values: list.map((x) => ({ result4: x.result4, result3: x.result3, result2: x.result2, url: x.sourceUrl })) },
      });
    }
  }

  return { valid, issues, counts };
}
