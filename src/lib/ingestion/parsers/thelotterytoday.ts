import * as cheerio from "cheerio";
import { parseEnglishDate } from "../../dates";
import type { RawRecord } from "../types";

export interface ListPageResult {
  records: RawRecord[];
  warnings: string[];
  /** Total pages announced by the site ("Page 1 of 15"), if present. */
  totalPages: number | null;
  /** True when the page contains the expected markup (even if the list is empty). */
  layoutRecognised: boolean;
  /** Relative href of the "next page" link, if any. */
  nextHref: string | null;
}

// Row links look like /en/lottery/lao-lottery/2026-10-02 (any locale prefix).
const ROW_HREF = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?)\/lottery\/lao-lottery\/(\d{4}-\d{2}-\d{2})\/?$/;

/**
 * Parser for the public "recent draw history" list of thelotterytoday.com.
 * Each row: <a href=".../YYYY-MM-DD"><div>2 October 2026</div> <span>4693</span><span>93</span><span>693</span></a>
 * Numbers are classified by their length (4/3/2 digits), not by position, so a re-ordering is harmless.
 */
export function parseTheLotteryTodayList(html: string, pageUrl: string, fetchedAt: string): ListPageResult {
  const $ = cheerio.load(html);
  const records: RawRecord[] = [];
  const warnings: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = ROW_HREF.exec(href);
    if (!m) return;
    const hrefDate = m[1];

    const dateText = $(el).find("div").first().text().trim();
    const textDate = parseEnglishDate(dateText);

    // Tokens = span texts containing a letter or digit (decorative spans such as the "→" arrow are ignored).
    // Non-numeric tokens are kept so a corrupted result is reported by the validator, never silently dropped.
    const tokens: string[] = [];
    $(el)
      .find("span")
      .each((__, s) => {
        const t = $(s).text().trim();
        if (/[0-9A-Za-z]/.test(t)) tokens.push(t);
      });
    // A link without any result token is not a result row (e.g. the "next draw" card).
    if (tokens.length === 0) return;

    let isoDate: string | null = textDate ?? hrefDate;
    if (textDate && textDate !== hrefDate) {
      warnings.push(`Date text "${dateText}" disagrees with link ${hrefDate}; row rejected`);
      isoDate = null;
    }

    const rec: RawRecord = {
      sourceUrl: new URL(href, pageUrl).toString(),
      fetchedAt,
      dateText: dateText || hrefDate,
      isoDate,
      raw: { dateText, hrefDate, tokens },
    };
    // Classify by length (4/3/2). Digit-only tokens go first so a stray badge ("New") cannot take a real number's slot.
    const ordered = [...tokens.filter((t) => /^\d+$/.test(t)), ...tokens.filter((t) => !/^\d+$/.test(t))];
    const leftovers: string[] = [];
    for (const t of ordered) {
      if (t.length === 4 && rec.result4 === undefined) rec.result4 = t;
      else if (t.length === 3 && rec.result3 === undefined) rec.result3 = t;
      else if (t.length === 2 && rec.result2 === undefined) rec.result2 = t;
      else leftovers.push(t);
    }
    if (leftovers.length) {
      // Unclassifiable tokens are surfaced (extra + result4 placeholder) so the validator rejects the row loudly.
      rec.extra = { unclassified: leftovers };
      if (rec.result4 === undefined) rec.result4 = leftovers[0];
    }
    records.push(rec);
  });

  // Read the indicator from a single element so neighbouring text (e.g. the first row's date) cannot glue onto it.
  let totalPages: number | null = null;
  $("div, span, p").each((_, el) => {
    if (totalPages !== null) return;
    const m = /^\s*Page\s+(\d+)\s+of\s+(\d+)\s*$/i.exec($(el).text());
    if (m) totalPages = Number(m[2]);
  });

  let nextHref: string | null = null;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/[?&]page=\d+/.test(href) && /next/i.test($(el).text())) nextHref = href;
  });

  // Recognised layout = we saw rows, or the site's history container/pagination indicator.
  const layoutRecognised = records.length > 0 || totalPages !== null || /Recent draw history/i.test($("body").text());

  return { records, warnings, totalPages, layoutRecognised, nextHref };
}
