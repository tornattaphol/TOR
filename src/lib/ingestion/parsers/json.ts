import { parseDateWithFormat } from "../../dates";
import type { JsonSourceConfig } from "../../config/sources";
import type { RawRecord } from "../types";

function getPath(obj: unknown, path: string): unknown {
  if (path === "") return obj;
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    // Own properties only: never walk prototype chains with externally supplied JSON.
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Numbers lose leading zeros ("0702" → 702): keep them as-is so the validator rejects instead of guessing. */
function asText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v);
}

export interface JsonParseResult {
  records: RawRecord[];
  warnings: string[];
  layoutRecognised: boolean;
}

export function parseJsonRecords(body: string, cfg: JsonSourceConfig, sourceUrl: string, fetchedAt: string): JsonParseResult {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (e) {
    return { records: [], warnings: [`Response is not valid JSON: ${(e as Error).message}`], layoutRecognised: false };
  }
  const list = getPath(data, cfg.recordsPath);
  if (!Array.isArray(list)) {
    return { records: [], warnings: [`recordsPath "${cfg.recordsPath}" did not resolve to an array`], layoutRecognised: false };
  }
  const ref = (item: unknown, f: string | number | undefined) => (f === undefined ? undefined : getPath(item, String(f)));
  const records: RawRecord[] = list.map((item) => {
    const dateText = asText(ref(item, cfg.fields.date)) ?? "";
    return {
      sourceUrl,
      fetchedAt,
      dateText: dateText ?? "",
      isoDate: dateText ? parseDateWithFormat(dateText, cfg.dateFormat, cfg.buddhistEra) : null,
      result4: asText(ref(item, cfg.fields.result4)),
      result3: asText(ref(item, cfg.fields.result3)),
      result2: asText(ref(item, cfg.fields.result2)),
      raw: item,
    };
  });
  return { records, warnings: [], layoutRecognised: true };
}
