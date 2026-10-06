import type { Verdict } from "@/lib/forecasting/types";

/** Presentation of a backtest verdict: icon + text + tone (never colour alone). */
export const VERDICT: Record<Verdict, { icon: string; label: string; tone: "neutral" | "good" | "warning" | "critical" }> = {
  insufficient_data: { icon: "○", label: "ข้อมูลไม่เพียงพอ", tone: "neutral" },
  no_evidence: { icon: "–", label: "ไม่พบหลักฐานว่าดีกว่าสุ่ม", tone: "neutral" },
  worse_than_random: { icon: "▼", label: "แย่กว่าการสุ่ม", tone: "warning" },
  evidence_better_than_random: { icon: "▲", label: "มีหลักฐานทางสถิติว่าดีกว่าสุ่ม (ต้องตรวจซ้ำ)", tone: "good" },
  reference: { icon: "◆", label: "เกณฑ์อ้างอิง", tone: "neutral" },
};
