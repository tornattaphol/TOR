/**
 * User-facing compliance texts. The wording is intentionally fixed: these are the only places where
 * words such as "รับประกัน" may appear, and only in negated form.
 */

/** Required warning for every page, and verbatim on the forecasting page. */
export const REQUIRED_WARNING = "การวิเคราะห์ย้อนหลังและโมเดลทางสถิติไม่สามารถรับประกันผลของการออกรางวัลในอนาคตได้";

export const SHORT_DISCLAIMER =
  "ข้อมูลและสถิติในเว็บไซต์นี้ใช้เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการเดิมพันหรือการซื้อสลาก ส่วนผลจากโมเดลทดลองใช้ศึกษาความสามารถของโมเดลเท่านั้น";

export const INDEPENDENCE_NOTE =
  "ผลการออกรางวัลแต่ละงวดเป็นเหตุการณ์สุ่ม ความถี่ที่เคยเกิดในอดีตไม่มีผลต่อผลของงวดถัดไป";

export const FORECAST_PURPOSE =
  "โมดูลนี้เป็นการทดลองประเมินว่าโมเดลทางสถิติทำนายผลย้อนหลังได้ดีกว่าการสุ่มหรือไม่ อันดับและเลขที่แสดงเป็นเพียงผลลัพธ์ของโมเดลทดลอง ไม่ใช่คำแนะนำให้ซื้อหรือเดิมพัน";

/**
 * Status line shown directly above every next-draw ranking, chosen by the backtest verdict of the model that
 * produced it — so a ranking is never displayed without its evidence status. Keys mirror `Verdict`.
 */
export const RANKING_STATUS_TEXT: Record<string, string> = {
  insufficient_data: "ข้อมูลทดสอบย้อนหลังยังไม่พอจะสรุปว่าโมเดลนี้ดีกว่าการสุ่มหรือไม่ — อันดับนี้ยังไม่มีหลักฐานสนับสนุน",
  no_evidence: "ผลทดสอบย้อนหลังไม่พบหลักฐานว่าโมเดลนี้ดีกว่าการสุ่ม — อันดับนี้จึงไม่ต่างจากการเลือกเลขแบบสุ่มทางสถิติ",
  worse_than_random: "โมเดลนี้ทำได้แย่กว่าการสุ่มในการทดสอบย้อนหลัง — อย่าตีความอันดับนี้เป็นสัญญาณใดๆ",
  evidence_better_than_random: "ผ่านเกณฑ์ทางสถิติในการทดสอบย้อนหลัง แต่ต้องตรวจซ้ำด้วยข้อมูลช่วงอื่น และไม่รับประกันผลของงวดถัดไป",
  reference: "เกณฑ์อ้างอิงการสุ่ม ไม่มีอันดับ",
};
