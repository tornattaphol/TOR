import { parseDateWithFormat } from "../../dates";
import type { CsvSourceConfig } from "../../config/sources";
import type { RawRecord } from "../types";

/** RFC 4180-style CSV parser (quotes, escaped quotes, CRLF/LF). Returns rows of cells; blank lines skipped. */
export function parseCsvText(text: string, delimiter = ","): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export interface CsvParseResult {
  records: RawRecord[];
  warnings: string[];
  /** false when a configured column could not be found in the header (the file layout changed). */
  layoutRecognised: boolean;
}

export function parseCsvRecords(text: string, cfg: CsvSourceConfig, sourceUrl: string, fetchedAt: string): CsvParseResult {
  const rows = parseCsvText(text, cfg.delimiter);
  const warnings: string[] = [];
  if (rows.length === 0) return { records: [], warnings, layoutRecognised: true };

  let header: string[] | null = null;
  let body = rows;
  if (cfg.hasHeader) {
    header = rows[0].map((h) => h.trim().toLowerCase());
    body = rows.slice(1);
  }

  const idx = (ref: string | number | undefined): number | null | undefined => {
    if (ref === undefined) return undefined;
    if (typeof ref === "number") return ref;
    if (!header) return null;
    const i = header.indexOf(ref.trim().toLowerCase());
    return i < 0 ? null : i;
  };
  const cols = {
    date: idx(cfg.columns.date),
    result4: idx(cfg.columns.result4),
    result3: idx(cfg.columns.result3),
    result2: idx(cfg.columns.result2),
  };
  // A configured column that is missing from the header means the layout changed.
  if (cols.date === null || cols.result4 === null || cols.result3 === null || cols.result2 === null) {
    return { records: [], warnings: ["Configured column not found in CSV header"], layoutRecognised: false };
  }
  const dateCol = cols.date;
  const col4 = cols.result4 ?? undefined;
  const col3 = cols.result3 ?? undefined;
  const col2 = cols.result2 ?? undefined;
  const cell = (r: string[], i: number | undefined) => (i === undefined ? undefined : (r[i] ?? "").trim());

  const records: RawRecord[] = body.map((r, n) => {
    const dateText = cell(r, dateCol) ?? "";
    return {
      sourceUrl,
      fetchedAt,
      dateText,
      isoDate: parseDateWithFormat(dateText, cfg.dateFormat, cfg.buddhistEra),
      result4: cell(r, col4),
      result3: cell(r, col3),
      result2: cell(r, col2),
      raw: { line: n + (cfg.hasHeader ? 2 : 1), cells: r },
    };
  });
  return { records, warnings, layoutRecognised: true };
}
