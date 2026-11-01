import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { RANKING_STATUS_TEXT, REQUIRED_WARNING } from "../../src/lib/disclaimer";

/**
 * Compliance guard: the product is a historical-statistics tool. User-facing text must never present
 * tips, recommendations or guarantees. These tests scan the source so a careless string cannot slip in.
 */

const ROOT = join(__dirname, "..", "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "generated" ? [] : walk(p);
    return /\.(ts|tsx|css|json)$/.test(name) ? [p] : [];
  });
}

const files = walk(ROOT).map((p) => ({ path: relative(ROOT, p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));

/**
 * Phrases that may appear only in the experimental next-draw ranking UI, where they are always shown together
 * with the backtest verdict of the model that produced the list (see the "ranking is never shown without its
 * evidence status" tests below).
 */
const ALLOWED_ONLY_IN_RANKING_UI: Record<string, string[]> = {
  เลขแนะนำ: ["components/NextDrawSection.tsx"],
};

const FORBIDDEN = [
  "เลขเด็ด",
  "เลขที่มีโอกาสออกสูง",
  "โอกาสออกสูง",
  "ควรซื้อ",
  "แนะนำเลข",
  "เลขแนะนำ",
  "ควรออก",
  "ออกแน่",
  "แนะนำสำหรับการเดิมพัน",
  "เลขมาแรง",
  "เลขเด่น",
  "เลขรวย",
  "แทงเลข",
  "hot number",
  "lucky number",
  "guaranteed",
  "sure win",
  "tips",
];

describe("forbidden promotional / advisory wording", () => {
  for (const phrase of FORBIDDEN) {
    const allowed = ALLOWED_ONLY_IN_RANKING_UI[phrase] ?? [];
    it(`never uses "${phrase}"${allowed.length ? ` outside ${allowed.join(", ")}` : ""}`, () => {
      const hits = files.filter((f) => !allowed.includes(f.path) && f.text.toLowerCase().includes(phrase.toLowerCase())).map((f) => f.path);
      expect(hits).toEqual([]);
    });
  }

  it("uses the word 'รับประกัน' only inside the mandated negated disclaimer", () => {
    const offenders: string[] = [];
    for (const f of files) {
      f.text.split("\n").forEach((line, i) => {
        if (!line.includes("รับประกัน")) return;
        if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // code comments are not user-facing
        const negated = /ไม่สามารถรับประกัน|ไม่รับประกัน|ไม่ได้รับประกัน|ไม่ใช่การรับประกัน/.test(line);
        if (!negated) offenders.push(`${f.path}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the mandated warning sentence verbatim", () => {
    expect(REQUIRED_WARNING).toBe("การวิเคราะห์ย้อนหลังและโมเดลทางสถิติไม่สามารถรับประกันผลของการออกรางวัลในอนาคตได้");
  });
});

describe("mandated disclaimers are wired into the UI", () => {
  const read = (p: string) => files.find((f) => f.path === p)?.text ?? "";
  it("every page inherits the footer carrying the required warning", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("<Footer />");
    expect(read("components/layout.tsx")).toContain("REQUIRED_WARNING");
  });
  it("the forecasting page shows the required warning prominently", () => {
    expect(read("components/ForecastingView.tsx")).toContain("REQUIRED_WARNING");
    expect(read("components/ForecastingView.tsx")).toContain("FORECAST_PURPOSE");
  });
  it("the dashboard and analytics pages show the disclaimer banner", () => {
    expect(read("components/Dashboard.tsx")).toContain("<DisclaimerBanner");
    expect(read("components/AnalyticsView.tsx")).toContain("<DisclaimerBanner");
  });
});

describe("a ranking is never shown without its evidence status", () => {
  const read = (p: string) => files.find((f) => f.path === p)?.text ?? "";
  const ui = read("components/NextDrawSection.tsx");

  it("the ranking UI renders the backtest verdict banner above both the shortlist and the full table", () => {
    expect(ui).toContain("RANKING_STATUS_TEXT[m.verdict]");
    expect(ui).toContain("VERDICT[m.verdict]");
    // banner is rendered in the headline card and again directly above the ranking table
    expect(ui.match(/<StatusBanner /g)?.length).toBeGreaterThanOrEqual(2);
    expect(ui).toContain("ไม่ใช่คำแนะนำให้ซื้อ");
  });
  it("the ranking UI shows the backtest hit-rate evidence and the uncertainty interval", () => {
    expect(ui).toContain("<HitRates");
    expect(ui).toContain("ช่วง 5–95%");
    expect(ui).toContain("เทียบสุ่ม");
  });
  it("every verdict has an explanatory status text", () => {
    for (const key of ["insufficient_data", "no_evidence", "worse_than_random", "evidence_better_than_random"]) {
      expect(RANKING_STATUS_TEXT[key], key).toBeTruthy();
    }
    // a model that did not beat random must never be described as having evidence
    expect(RANKING_STATUS_TEXT.no_evidence).toContain("ไม่ต่างจากการเลือกเลขแบบสุ่ม");
    expect(RANKING_STATUS_TEXT.evidence_better_than_random).toContain("ไม่รับประกัน");
  });
  it("only the dedicated endpoint serves rankings; the backtest endpoint strips them", () => {
    expect(read("app/api/forecast/backtest/route.ts")).toContain("withoutNextDraw");
    expect(read("app/api/forecast/next-draw/route.ts")).toContain("trimNextDraw");
    // no other route handler reads the ranking from the report
    const readers = files.filter((f) => f.path.startsWith("app/api/") && f.text.includes(".nextDraw")).map((f) => f.path);
    expect(readers).toEqual(["app/api/forecast/next-draw/route.ts"]);
  });
  it("the forecasting page stays labelled experimental and keeps the mandated warning", () => {
    const view = read("components/ForecastingView.tsx");
    expect(view).toContain("ทดลอง");
    expect(view).toContain("<NextDrawSection");
    expect(view).toContain("REQUIRED_WARNING");
  });
});

describe("no mock data in runtime code", () => {
  it("does not generate random/fake draw data outside tests", () => {
    // Math.random is allowed only for retry jitter in the HTTP client.
    const offenders = files.filter((f) => /Math\.random\(/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual(["lib/http/client.ts"]);
  });
  it("does not import test fixtures", () => {
    expect(files.filter((f) => /tests\/(helpers|fixtures)/.test(f.text)).map((f) => f.path)).toEqual([]);
  });
});
