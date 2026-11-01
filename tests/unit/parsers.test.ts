import { describe, expect, it } from "vitest";
import { parseCsvRecords, parseCsvText } from "../../src/lib/ingestion/parsers/csv";
import { parseJsonRecords } from "../../src/lib/ingestion/parsers/json";
import { parseTheLotteryTodayList } from "../../src/lib/ingestion/parsers/thelotterytoday";
import { parseSourcesConfig, type CsvSourceConfig, type JsonSourceConfig } from "../../src/lib/config/sources";
import { listPageHtml } from "../helpers/fixtures";

const FETCHED = "2026-10-04T00:00:00.000Z";
const URL_ = "https://example.test/en/lottery/lao-lottery";

describe("thelotterytoday list parser", () => {
  it("extracts date and 4/3/2-digit results regardless of column order", () => {
    const html = listPageHtml(
      [
        { date: "2026-10-02", r4: "4693", r2: "93", r3: "693" },
        { date: "2026-09-30", r4: "0702", r3: "702", r2: "02" },
      ],
      { page: 1, total: 15 },
    );
    const p = parseTheLotteryTodayList(html, URL_, FETCHED);
    expect(p.layoutRecognised).toBe(true);
    expect(p.totalPages).toBe(15);
    expect(p.nextHref).toBe("/en/lottery/lao-lottery?page=2");
    expect(p.records).toHaveLength(2);
    expect(p.records[0]).toMatchObject({ isoDate: "2026-10-02", result4: "4693", result3: "693", result2: "93", sourceUrl: "https://example.test/en/lottery/lao-lottery/2026-10-02", fetchedAt: FETCHED });
    // leading zero kept (string, not number)
    expect(p.records[1]).toMatchObject({ isoDate: "2026-09-30", result4: "0702", result3: "702", result2: "02" });
    expect(p.warnings).toEqual([]);
  });

  it("ignores the upcoming-draw link, which has no numbers", () => {
    const p = parseTheLotteryTodayList(listPageHtml([{ date: "2026-10-02", r4: "4693", r3: "693", r2: "93" }]), URL_, FETCHED);
    expect(p.records.map((r) => r.isoDate)).toEqual(["2026-10-02"]);
  });

  it("rejects a row whose visible date disagrees with its link", () => {
    const html = listPageHtml([{ date: "2026-10-02", dateText: "30 September 2026", r4: "4693", r3: "693", r2: "93" }]);
    const p = parseTheLotteryTodayList(html, URL_, FETCHED);
    expect(p.records[0].isoDate).toBeNull();
    expect(p.warnings[0]).toMatch(/disagrees/);
  });

  it("passes through malformed numbers for the validator to judge (never 'fixes' them)", () => {
    const p = parseTheLotteryTodayList(listPageHtml([{ date: "2026-10-02", r4: "46931", r3: "693", r2: "93" }]), URL_, FETCHED);
    expect(p.records[0].result4).toBe("46931");
    expect(p.records[0].extra).toEqual({ unclassified: ["46931"] }); // kept as evidence; the validator rejects result4
  });

  it("keeps unclassifiable numbers visible", () => {
    const p = parseTheLotteryTodayList(listPageHtml([{ date: "2026-10-02", r4: "4693", r3: "693", r2: "93" }]).replace("<span class=\"ml-2\">", "<span>5</span><span class=\"ml-2\">"), URL_, FETCHED);
    expect(p.records[0].extra).toEqual({ unclassified: ["5"] });
  });

  it("recognises an empty history list but reports no rows", () => {
    const p = parseTheLotteryTodayList(listPageHtml([], { page: 1, total: 1 }), URL_, FETCHED);
    expect(p.layoutRecognised).toBe(true);
    expect(p.records).toEqual([]);
  });

  it("flags unknown markup as an unrecognised layout", () => {
    const p = parseTheLotteryTodayList("<html><body><h1>Maintenance</h1></body></html>", URL_, FETCHED);
    expect(p.layoutRecognised).toBe(false);
    expect(p.records).toEqual([]);
  });

  it("is not fooled by script content or non-result links", () => {
    const html = `<html><body><script>var x='<a href="/en/lottery/lao-lottery/2026-10-02"><div>2 October 2026</div><span>1234</span></a>'</script>
      <a href="/en/did-i-win/lao-lottery/2026-10-02"><div>2 October 2026</div><span>1234</span></a></body></html>`;
    expect(parseTheLotteryTodayList(html, URL_, FETCHED).records).toEqual([]);
  });
});

describe("CSV parser", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsvText('﻿date,note\r\n2026-10-02,"a, b"\r\n\r\n2026-09-30,"say ""hi"""\n', ",");
    expect(rows).toEqual([
      ["date", "note"],
      ["2026-10-02", "a, b"],
      ["2026-09-30", 'say "hi"'],
    ]);
  });
  it("supports other delimiters", () => {
    expect(parseCsvText("a;b\n1;2", ";")).toEqual([["a", "b"], ["1", "2"]]);
  });

  const cfg = (over: Record<string, unknown> = {}): CsvSourceConfig =>
    parseSourcesConfig({ sources: [{ id: "csv1", type: "csv", url: "https://example.test/x.csv", columns: { date: "Date", result4: "Four", result3: "Three", result2: "Two" }, ...over }] }).sources[0] as CsvSourceConfig;

  it("maps header names (case-insensitive) to records and parses dates", () => {
    const csv = "DATE,four,three,two\n2026-10-02,4693,693,93\n2026-09-30,0702,702,02\n";
    const r = parseCsvRecords(csv, cfg(), "file:x", FETCHED);
    expect(r.layoutRecognised).toBe(true);
    expect(r.records).toHaveLength(2);
    expect(r.records[1]).toMatchObject({ isoDate: "2026-09-30", result4: "0702", result3: "702", result2: "02" });
  });

  it("supports column indexes without a header and Buddhist-era dates", () => {
    const c = cfg({ hasHeader: false, columns: { date: 0, result2: 1 }, dateFormat: "DD/MM/YYYY", buddhistEra: true });
    const r = parseCsvRecords("02/10/2569,93\n", c, "file:x", FETCHED);
    expect(r.records[0]).toMatchObject({ isoDate: "2026-10-02", result2: "93" });
    expect(r.records[0].result4).toBeUndefined();
  });

  it("reports a missing configured column as a layout change", () => {
    const r = parseCsvRecords("date,four\n2026-10-02,4693\n", cfg(), "file:x", FETCHED);
    expect(r.layoutRecognised).toBe(false);
    expect(r.records).toEqual([]);
  });

  it("gives a null date for unparseable dates (validator rejects)", () => {
    const r = parseCsvRecords("date,four,three,two\n31/02/2026,4693,693,93\n", cfg(), "file:x", FETCHED);
    expect(r.records[0].isoDate).toBeNull();
    expect(r.records[0].dateText).toBe("31/02/2026");
  });
});

describe("JSON parser", () => {
  const cfg = (over: Record<string, unknown> = {}): JsonSourceConfig =>
    parseSourcesConfig({
      sources: [{ id: "api1", type: "json", url: "https://example.test/api", recordsPath: "data.items", fields: { date: "d", result4: "n.l4", result3: "n.l3", result2: "n.l2" }, ...over }],
    }).sources[0] as JsonSourceConfig;

  it("walks dot paths and keeps leading zeros of string values", () => {
    const body = JSON.stringify({ data: { items: [{ d: "2026-10-02", n: { l4: "0702", l3: "702", l2: "02" } }] } });
    const r = parseJsonRecords(body, cfg(), "https://example.test/api", FETCHED);
    expect(r.records[0]).toMatchObject({ isoDate: "2026-10-02", result4: "0702", result3: "702", result2: "02" });
  });

  it("does not repair numbers that lost their leading zeros (validator will reject them)", () => {
    const body = JSON.stringify({ data: { items: [{ d: "2026-10-02", n: { l4: 702, l3: 702, l2: 2 } }] } });
    const r = parseJsonRecords(body, cfg(), "u", FETCHED);
    expect(r.records[0].result4).toBe("702");
    expect(r.records[0].result2).toBe("2");
  });

  it("supports a root-level array", () => {
    const body = JSON.stringify([{ d: "2026-10-02", n: { l2: "93" } }]);
    const r = parseJsonRecords(body, cfg({ recordsPath: "" }), "u", FETCHED);
    expect(r.records).toHaveLength(1);
    expect(r.records[0].result2).toBe("93");
  });

  it("reports invalid JSON and wrong shapes as layout problems", () => {
    expect(parseJsonRecords("<html>", cfg(), "u", FETCHED).layoutRecognised).toBe(false);
    expect(parseJsonRecords(JSON.stringify({ data: {} }), cfg(), "u", FETCHED).layoutRecognised).toBe(false);
  });

  it("never reads inherited properties from untrusted JSON", () => {
    const r = parseJsonRecords(JSON.stringify({ data: { items: [{}] } }), cfg({ fields: { date: "constructor", result2: "__proto__" } }), "u", FETCHED);
    expect(r.records[0].dateText).toBe("");
    expect(r.records[0].isoDate).toBeNull();
  });
});
