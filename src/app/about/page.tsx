import type { Metadata } from "next";
import { DisclaimerBanner } from "@/components/ui";
import { INDEPENDENCE_NOTE } from "@/lib/disclaimer";

export const metadata: Metadata = { title: "เกี่ยวกับ/วิธีการ" };

const sectionCls = "rounded-xl border border-line bg-surface p-5";

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <DisclaimerBanner />
      <h1 className="text-2xl font-bold text-fg">เกี่ยวกับระบบและวิธีการ</h1>

      <section className={sectionCls}>
        <h2 className="text-lg font-semibold text-fg">วัตถุประสงค์</h2>
        <p className="mt-2 text-fg-2">
          เว็บไซต์นี้นำเสนอ <strong className="text-fg">สถิติเชิงพรรณนาของผลสลากลาวพัฒนาในอดีต</strong> เพื่อการศึกษาด้านสถิติและการจัดการข้อมูลเท่านั้น ไม่ได้ให้คำแนะนำเกี่ยวกับการซื้อสลากหรือการเดิมพัน และไม่รับประกันผลของงวดใดๆ หน้า “ประเมินโมเดล” มีอันดับเลขจากโมเดลทดลองสำหรับงวดถัดไป เพื่อศึกษาความสามารถของโมเดลเท่านั้น และทุกอันดับแสดงคู่กับผลทดสอบย้อนหลังว่าโมเดลนั้นดีกว่าการสุ่มหรือไม่ {INDEPENDENCE_NOTE}
        </p>
      </section>

      <section className={sectionCls}>
        <h2 className="text-lg font-semibold text-fg">ที่มาและการตรวจสอบข้อมูล</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-fg-2">
          <li>ดึงจากแหล่งข้อมูลสาธารณะที่ตั้งค่าได้ (HTML / CSV / JSON) ผ่านลำดับ Source → Parser → Validator → Database → Analytics</li>
          <li>ทุก record เก็บ URL ต้นทาง ชื่อแหล่งข้อมูล และเวลาที่ดึงข้อมูล (แสดงในตารางผลย้อนหลัง)</li>
          <li>ตรวจสอบข้อมูลซ้ำ วันที่ผิด รูปแบบตัวเลขผิด เลข 2/3 ตัวที่ไม่ตรงกับเลข 4 ตัว งวดที่ขาดหาย และข้อมูลที่แหล่งต่างๆ ขัดแย้งกัน — รายการที่ไม่ผ่านจะไม่ถูกนำไปวิเคราะห์ และแสดงที่หน้า “สุขภาพข้อมูล”</li>
          <li>ระบบไม่สร้างหรือเติมข้อมูลจำลอง หากดึงข้อมูลไม่ได้จะแสดงสถานะและรหัสข้อผิดพลาดแทน</li>
          <li>ตารางวันออกรางวัลที่ใช้ตรวจสอบ: จันทร์ พุธ ศุกร์ (ตั้งค่าได้ต่อแหล่งข้อมูล) วันที่ไม่ตรงตารางจะถูกกักกันและไม่รวมในสถิติ</li>
          <li>แหล่งข้อมูลสาธารณะมีข้อจำกัด เช่น ความยาวของประวัติ รูปแบบหน้าเว็บที่เปลี่ยนได้ และค่าที่ไม่สอดคล้องกันบางรายการ — บันทึกไว้ในเอกสาร DATA-SOURCE.md ของโปรเจกต์</li>
        </ul>
      </section>

      <section className={sectionCls}>
        <h2 className="text-lg font-semibold text-fg">การอ่านสถิติอย่างถูกต้อง</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-fg-2">
          <li>“ความถี่ที่เคยปรากฏ” คือจำนวนครั้งที่เกิดขึ้นแล้วในช่วงข้อมูลที่เลือก ไม่ใช่ความน่าจะเป็นของงวดถัดไป</li>
          <li>เมื่อมีตัวอย่างน้อย ความแตกต่างของความถี่ส่วนใหญ่เกิดจากความผันผวนตามธรรมชาติ</li>
          <li>ค่า p ของการทดสอบทางสถิติหลายรายการพร้อมกันอาจต่ำกว่าเกณฑ์โดยบังเอิญ จึงไม่ควรตีความเป็นสัญญาณ</li>
        </ul>
      </section>

      <section className={sectionCls}>
        <h2 className="text-lg font-semibold text-fg">โมดูลประเมินโมเดล (ทดลอง)</h2>
        <p className="mt-2 text-fg-2">
          ใช้ทดสอบว่าวิธีทางสถิติต่างๆ (ความถี่, ค่าเฉลี่ยเคลื่อนที่, Markov, อนุกรมเวลา, Monte Carlo, Machine Learning) ทำได้ดีกว่าการสุ่มบนข้อมูลในอดีตหรือไม่ ด้วย walk-forward backtest ที่ไม่ใช้ข้อมูลอนาคตในการฝึก เทียบกับเกณฑ์สุ่ม ใช้ Accuracy / MAE / Log-loss พร้อมช่วงความเชื่อมั่นและการปรับค่า p สำหรับการทดสอบหลายครั้ง หลังการประเมิน โมดูลจะนำโมเดลที่ฝึกจากทุกงวดมาจัดอันดับเลขของงวดถัดไปพร้อมช่วงความไม่แน่นอน โดยแสดงสถานะผลทดสอบย้อนหลังกำกับเสมอ — หากไม่พบหลักฐานว่าดีกว่าการสุ่ม อันดับนั้นไม่ต่างจากการเลือกเลขแบบสุ่มทางสถิติ
        </p>
      </section>
    </div>
  );
}
