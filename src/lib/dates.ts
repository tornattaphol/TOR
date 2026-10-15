/** Date helpers that work on ISO calendar strings in UTC to avoid time-zone drift. */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function toDate(iso: string): Date {
  if (!isValidIsoDate(iso)) throw new RangeError(`Invalid ISO date: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function fromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(iso: string): number {
  return toDate(iso).getUTCDay();
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDate(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

/** Calendar date "today" in the given IANA time zone (default Asia/Vientiane). */
export function todayIn(timeZone = "Asia/Vientiane", now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** All dates in [from, to] (inclusive) whose weekday is in `weekdays`. */
export function expectedDrawDates(from: string, to: string, weekdays: number[]): string[] {
  const out: string[] = [];
  const set = new Set(weekdays);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (set.has(weekdayOf(d))) out.push(d);
  }
  return out;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "2 October 2026" / "02 Oct 2026" → "2026-10-02" (null if not parseable). */
export function parseEnglishDate(text: string): string | null {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const iso = `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "DD-MM-YYYY";

/** Parse a date in a configured format. `buddhistEra` subtracts 543 years. Returns null if invalid. */
export function parseDateWithFormat(raw: string, format: DateFormat, buddhistEra = false): string | null {
  const s = raw.trim();
  let y: number, mo: number, d: number;
  if (format === "YYYY-MM-DD") {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (!m) return null;
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    const sep = format === "DD/MM/YYYY" ? "/" : "-";
    const m = new RegExp(`^(\\d{1,2})\\${sep}(\\d{1,2})\\${sep}(\\d{4})$`).exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (buddhistEra) y -= 543;
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

/** Thai-language, Buddhist-era display, e.g. "2 ต.ค. 2569". Display only. */
export function formatThaiDate(iso: string, opts: { weekday?: boolean } = {}): string {
  if (!isValidIsoDate(iso)) return iso;
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(opts.weekday ? { weekday: "short" } : {}),
    timeZone: "UTC",
  }).format(toDate(iso));
}

export const THAI_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
