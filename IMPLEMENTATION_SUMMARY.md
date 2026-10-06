# IMPLEMENTATION_SUMMARY.md

> การวิเคราะห์ย้อนหลังและโมเดลทางสถิติไม่สามารถรับประกันผลของการออกรางวัลในอนาคตได้

สถานะ: **ทำงานได้จริงในเครื่อง** — ดึงข้อมูลจริง 146 งวด (2025-10-13 → 2026-10-02) เข้า PostgreSQL 17, build ผ่าน, ทดสอบ 347 รายการผ่าน (unit/API 323 + integration 24), ตรวจหน้าเว็บในเบราว์เซอร์ (desktop สว่าง/มืด, มือถือ 375px) แล้ว
**อัปเดต 2026-10-06:** เพิ่ม “เลขแนะนำ / อันดับเลขงวดถัดไป” ในหน้า Forecasting ตามคำขอ — ดู §0
(ยังไม่ได้ commit — ไฟล์ทั้งหมดอยู่ใน working tree)

## 0. อัปเดต 2026-10-06 — เลขแนะนำ / อันดับเลขที่โมเดลคาดว่าจะออก
ผู้ใช้ยืนยันว่าหน้า Forecasting ต้องมีส่วนนี้ (ก่อนหน้านั้นระบบตีความว่าไม่ต้องมีและไม่แสดง) จึงเพิ่มโดยยังรักษาหลักความโปร่งใส:

- **สิ่งที่เพิ่ม:** `GET /api/forecast/next-draw` · `src/lib/forecasting/{nextdraw,ranking}.ts` · `components/{NextDrawSection,verdict}` · `ModelResult.rankHits` · `RANKING_STATUS_TEXT`
- **หน้า `/forecasting`:** การ์ด “เลขแนะนำจากโมเดล (ทดลอง)” (10 อันดับแรกของ `last2`, 3 อันดับแรกของหลักสิบ/หน่วย; เลือกโมเดลได้ ค่าเริ่มต้น = โมเดลที่ผลย้อนหลังดีที่สุด) + การ์ด “อันดับเลขที่โมเดลคาดว่าจะออก” (ทุกค่า 10/20/50/100 อันดับ พร้อมความน่าจะเป็น เทียบ 1/K ช่วง 5–95% และ % ที่ยังติดกลุ่มต้นเมื่อสุ่มข้อมูลซ้ำ)
- **ผูกกับหลักฐานเสมอ:** แบนเนอร์สถานะ verdict ของโมเดลนั้นเหนือทุกรายการ + ตาราง Top-n hit-rate ย้อนหลัง (เทียบ n/K) + ป้าย “ไม่ใช่คำแนะนำให้ซื้อ”; ไม่มีข้อมูลพอ → ไม่แสดงอันดับ; ข้อมูลล้าสมัย → แจ้งเตือน
- **การตัดสินใจ:** ใช้คำว่า “เลขแนะนำจากโมเดล” ตามที่ผู้ใช้ระบุ แต่เปลี่ยน “ควรออก” เป็น “โมเดลคาดว่าจะออก”; `/api/forecast/backtest` ยังไม่คืนตัวเลขของงวดถัดไป (ตัด `nextDraw`); เอกสาร/ข้อความที่เคยระบุว่า “ไม่แสดงเลขงวดถัดไป” ถูกแก้แล้ว (footer, `/about`, README, API, ARCHITECTURE, PLAN §11)
- **ผลกับข้อมูลจริง (146 งวด ณ 2026-10-02):** ไม่มีโมเดลใดผ่านเกณฑ์ “ดีกว่าสุ่ม” (verdict = `no_evidence` หรือ `worse_than_random` ทุกโมเดล/เป้าหมาย) หน้าเว็บจึงแสดงอันดับพร้อมข้อความ “ไม่ต่างจากการเลือกเลขแบบสุ่มทางสถิติ” — เป็นผลตามจริงของข้อมูล ไม่ได้ปรับแต่ง เช่น `last2` โมเดลความถี่ให้ 77 เป็นอันดับ 1 (4.1%, ช่วง 2.4–5.3%, เทียบสุ่ม 1.0%) แต่ verdict คือ `no_evidence`
- **ตรวจ calibration:** อัตรา Top-n hit ของ `rankHits` บนข้อมูลสุ่มสังเคราะห์ 150 ชุด = n/K และช่วงเชื่อมั่นพลาดค่าสุ่มราว 5% ต่อช่อง (ตามที่ควร) ดังนั้นในข้อมูลจริงที่ Top-n ของโมเดลความถี่ `last2` ดูสูงกว่าสุ่ม (เช่น Top-20 = 32% เทียบ 20%) **ไม่ปรับหลายการทดสอบ** (7 โมเดล × 3 เป้าหมาย × 3–4 ค่า n) จึงเป็นเพียงคำอธิบาย ไม่นับเป็นหลักฐาน — UI ใช้ป้ายกลางว่า “สูงกว่าสุ่มในตัวอย่างนี้ (อาจบังเอิญ)” และให้ verdict ที่ปรับแล้วเป็นข้อสรุปหลัก
- **วันที่ข้อมูลล่าสุดคือ 2026-10-02** (วันที่ตรวจคือ 2026-10-06 จึงมีงวด 2026-10-05 ที่ยังไม่ได้ดึง) — หน้าเว็บแสดงคำเตือนข้อมูลล้าสมัย; ยังไม่ได้รัน `npm run ingest` ในรอบนี้ ผลข้างต้นจึงอ้างอิง 146 งวดเดิม

## 1. Architecture
```
Source (HTTP/CSV/JSON, robots.txt, retry) → Parser (ต่อ source, ไม่เชื่อถือ) → Validator (ปฏิเสธ/กักกัน ไม่ซ่อมค่า)
   → reconcile/planBatch (priority, conflict, idempotent) → PostgreSQL (Prisma) → Analytics / Forecasting / Data Health (ฟังก์ชันล้วน)
   → REST (Next.js Route Handlers: rate limit + zod) → Dashboard (Next.js, Recharts)
```
รายละเอียด: [ARCHITECTURE.md](ARCHITECTURE.md)

## 2. Technologies
Next.js 16 (App Router) · React 19 · TypeScript 5 (strict) · Tailwind CSS 4 · PostgreSQL 17 + Prisma 7 (driver adapter `pg`) · Recharts 3 · zod 4 · cheerio · Vitest 5 · embedded-postgres (dev/test) · tsx

## 3. File structure
```
config/sources.json, sources.example.json     prisma/{schema.prisma, migrations/}     scripts/{ingest.ts, db-local.ts}
src/app/{page, analytics, forecasting, data-health, about}/ + api/{meta, draws, analytics, health, sources, forecast/backtest, forecast/next-draw, ingest, ingest/runs}
src/components/{Dashboard, AnalyticsView, ForecastingView, NextDrawSection, verdict, DataHealthView, ResultsTable, FilterBar, charts, ui, layout, useApi}
src/lib/{ingestion, db, analytics, forecasting (+ nextdraw, ranking), quality, http, config, schemas, services, dates, math, logger, disclaimer, format, domain}
tests/{unit, api, ingestion, integration, helpers}
README / ARCHITECTURE / DATA-SOURCE / API / DEVELOPMENT / PLAN / IMPLEMENTATION_SUMMARY .md · .env.example · docker-compose.yml
```
ประมาณ 9,500 บรรทัด (src ≈ 6,400, tests ≈ 3,000)

## 4. Data source ที่ใช้
`thelotterytoday.com` — หน้า HTML สาธารณะของ Lao Development Lottery (จ/พ/ศ, เลข 4/3/2 หลัก, ประวัติ 147 งวด); robots.txt อนุญาต; **ไม่มี API สาธารณะที่ยืนยันได้**; ยังไม่ได้ตรวจเงื่อนไขการใช้งาน (ToS) — ต้องตรวจก่อน production
รองรับเพิ่มได้ด้วย config: CSV (URL/ไฟล์, พ.ศ.) และ JSON API (API key ผ่านชื่อ env) — [DATA-SOURCE.md](DATA-SOURCE.md)

## 5. วิธี run
```bash
npm install
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
npm run db:local                # terminal แยก (หรือ docker compose up -d)
npm run db:migrate
npm run ingest:full
npm run dev                     # http://localhost:3000   |   production: npm run build && npm start
```

## 6. วิธี refresh data
`npm run ingest` (2 หน้าแรก) · `npm run ingest:full` (ทุกหน้า) · `POST /api/ingest` พร้อม `Authorization: Bearer $INGEST_TOKEN` · ผลดูที่ `/data-health` — ถ้า source ล่ม/ว่าง/เปลี่ยนรูปแบบ ระบบไม่เขียนข้อมูลและบันทึก error code (README, API.md)

## 7. Test results
| ชุด | ผล |
|-----|----|
| `npm test` (unit + API + ingestion; 13 ไฟล์) | **323 passed** (เดิม 286; เพิ่ม 37: อันดับ/ranking helpers, nextdraw, rankHits, API next-draw, guard) |
| `npm run test:integration` (PostgreSQL 17.10 จริง: migration, store contract, constraints, rollback, pipeline, API) | **24 passed** |
| live smoke test กับเว็บจริง (`LIVE_SOURCE_TEST=1`, opt-in) | 1 passed (2026-10-04) |
| `npm run typecheck` (strict) | ไม่มี error |
| `npm run build` | สำเร็จ ไม่มี warning |
| `npm audit` | 0 vulnerabilities (หลังตั้ง `overrides` — ดู ARCHITECTURE §8) |

กรณีที่กำหนด: **ข้อมูลถูกต้อง** · **ซ้ำ** (หน้าเดียว/ข้ามหน้า/รันซ้ำ) · **หาย** (งวดขาด/ถูกปฏิเสธ) · **format ผิด** (ตัวเลข, วันที่, เลขท้ายไม่สอดคล้อง, ผิดวันออกรางวัล, อนาคต) · **source unavailable** (5xx, 404, timeout, connection refused, robots, ว่าง, layout เปลี่ยน, ไม่ใช่ HTML, เกินขนาด, redirect ข้าม host)
การทดสอบสำคัญของโมดูล forecast: **ไม่มี look-ahead** (property test บนทุกโมเดล), metrics ตรงกับค่า brute-force, Holm/sign-flip/bootstrap, **เครื่องมือตรวจจับสัญญาณชัดเจนได้** (วงจรหลักสิบ), ลำดับสุ่ม: ใน repo 40 ชุด (ขอบบน 15%) และวัดครั้งเดียวด้วยสคริปต์ 100 ชุด → 0 ชุดถูกตั้งธง “มีหลักฐาน”, และ **ส่วน backtest (`targets`, `/api/forecast/backtest`) ไม่มี key/ข้อความที่เป็นเลขพยากรณ์** (เลขงวดถัดไปอยู่ใน `nextDraw` เท่านั้น) + สแกนถ้อยคำต้องห้ามทั้ง `src/` + test ว่า UI แสดงอันดับพร้อมแบนเนอร์ verdict เสมอ
การทดสอบของอันดับ: ลำดับครบ/เรียง/รวมเป็น 1, tie ใช้ competition rank, bootstrap deterministic (`shortlistShare` รวม = ขนาดกลุ่มต้นพอดี), verdict ตรงกับ backtest ของโมเดล+เป้าหมายเดียวกัน, โมเดลที่ข้อมูลไม่พอไม่มีอันดับ, rolling window จำกัดข้อมูลที่โมเดลเห็นจริง, **วงจรหลักสิบถูกจัดอันดับ 1 และถูกตั้งธง “มีหลักฐาน”**, ลำดับสุ่ม 6 ชุด → ไม่มีโมเดลถูกตั้งธง และ `rankHits` ตรงกับการรันซ้ำแบบ brute force

บั๊กจริงที่ชุดทดสอบ/การใช้งานจริงจับได้และแก้แล้ว: parser เดิมทิ้งแถวที่ตัวเลขมีตัวอักษรปนโดยเงียบ; robots.txt ที่เข้าไม่ถึงเพราะเครื่องปลายทางล่มถูกรายงานเป็น `ROBOTS_DISALLOWED`; ตัวอ่าน “Page 1 of 15” ต่อข้อความกับวันที่แถวแรก (อ่านเป็น 152); EWMA/Monte Carlo ที่ smoothing ไม่พอทำให้ “แพ้” อย่างไม่เป็นธรรม; แถว uniform รายงาน accuracy ผิดแบบ; layout มือถือล้น (grid ไม่มี `min-w-0`)

## 8. Acceptance criteria (PLAN.md §1)
R1 configurable sources ✅ (3 adapter) · R2 ไม่มีข้อมูลจำลอง ✅ (test ตรวจ; ไม่มีข้อมูล → Empty state) · R3 แยกชั้น ✅ · R4 Data Quality ✅ (duplicate, invalid date/number, missing draw, source conflict + quarantine + derived mismatch) · R5 Analytics ✅ · R6 Dashboard/ตัวกรอง/สถานะ ✅ · R7 Forecasting ✅ (7 โมเดล + เกณฑ์สุ่ม, walk-forward, baseline, Accuracy/MAE/Log-loss, verdict; **+ เลขแนะนำ/อันดับเลขงวดถัดไป** — §0) · R8 Security ✅ · R9 Tests ✅ · R10 เอกสาร ✅ · R11 ถ้อยคำต้องห้าม ✅

## 9. Security review (สรุป)
Secrets ผ่าน env, `.env` ถูก ignore, logger redact · zod ทุก input (400 พร้อมรายละเอียดฟิลด์) · Prisma parameterised + ทดสอบ payload `'; DROP TABLE` · token ingest เทียบ constant-time, ปิดเมื่อไม่ตั้งค่า, rate-limited · rate limit 3 ชั้น · SSRF: ไม่ตามลิงก์ในเนื้อหา, redirect เฉพาะ host เดิม, ไม่ส่ง API key ข้าม host · ตัด query ที่ชื่อคล้าย secret ออกจาก URL ที่เก็บ · CSP/nosniff/frame-ancestors · error ไม่เปิด stack/SQL/credential · `npm audit` = 0
ข้อจำกัดที่ยอมรับ (บันทึกใน ARCHITECTURE): rate limiter/lock ในหน่วยความจำต่อโปรเซส และเชื่อ `X-Forwarded-For`; CSP ต้องมี `'unsafe-inline'` สำหรับ Next.js

## 10. ข้อค้นพบจากข้อมูลจริง
- งวด 2026-04-20: source ให้ 4 ตัว `0599` แต่ 2 ตัว `59` → ปฏิเสธ (ไม่เดาค่า)
- 6 งวดตามตาราง จ/พ/ศ ไม่มีใน source (อาจเป็นวันหยุด — ยืนยันไม่ได้)
- เว็บ aggregator อีกแห่งแสดงผลวันอังคาร/พฤหัสที่ source หลักไม่มี → ตารางงวดไม่ตรงกันระหว่างเว็บสาธารณะ ไม่มีเอกสารทางการยืนยัน → กักกันตามตารางที่ตั้งค่า
- ตัวอย่างนี้หลักหน่วยกระจายไม่สม่ำเสมอ (p ≈ 0.002 ก่อนปรับหลายการทดสอบ) แต่ **ไม่มีโมเดลใดดีกว่าการสุ่มอย่างมีนัยสำคัญหลังปรับ Holm** (20 ชุดทดสอบ) — รายงานตามที่พบ ไม่ตีความเป็นสัญญาณ

## 11. Known limitations
1. ประวัติ ~1 ปี (146 งวด) → กำลังทางสถิติต่ำ; ML ใช้ไม่ได้กับเป้าหมาย 100 ค่า; ขั้นตอนทดสอบอนุรักษ์ (ตรวจจับได้เฉพาะรูปแบบชัดเจน; กำลังตรวจจับสัญญาณอ่อนไม่ได้วัด)
2. ใช้ source เดียวที่ตรวจโครงสร้างได้จึงยังไม่มี cross-validation จริงระหว่าง source (กลไก conflict ทดสอบด้วย source จำลองในเครื่องเท่านั้น)
3. HTML scraping เปราะต่อการเปลี่ยน layout (มี `LAYOUT_CHANGED` + live test); ไม่ได้ตรวจ ToS ของเว็บต้นทาง
4. ไม่ได้นำเข้าเลขสัตว์/เลขพัฒนา; `fetched_at` คือเวลาที่ดึง ไม่ใช่เวลาประกาศผล
5. rate limiter / cache forecast / lock ingest อยู่ในหน่วยความจำ (หลาย instance ต้องย้าย); ควรมี writer เดียวสำหรับ ingestion — รันพร้อมกันหลายตัวอาจทำให้ run หนึ่งล้มเหลวด้วย unique constraint
6. `IngestionRun` ที่ค้างสถานะ RUNNING หลังโปรเซสตายจะแสดงเป็น “กำลังทำงาน” (ยังไม่มีการเก็บกวาดอัตโนมัติ)
7. ข้อความรายละเอียดของ Data Issue เป็นภาษาอังกฤษ (หัวข้อ/ประเภทเป็นไทย)
8. `docker-compose.yml` ยังไม่ได้ทดสอบ (เครื่องนี้ไม่มี Docker) — ใช้ `npm run db:local` ที่ทดสอบแล้ว
9. ไม่ได้ตั้งค่า ESLint (ใช้ `tsc` strict + เทสต์); ไม่ได้ทดสอบบนเบราว์เซอร์อื่นนอกจากเบราว์เซอร์ในแอป และไม่ได้ทดสอบด้วย screen reader (ออกแบบตาม ARIA/ตารางทางเลือก)

10. **อันดับเลขงวดถัดไป (เพิ่ม 2026-10-06):** ผลเป็นเพียงอันดับของโมเดลทดลอง — ข้อมูลจริงยังไม่มีหลักฐานว่าดีกว่าสุ่ม; “โมเดลที่ผลย้อนหลังดีที่สุด” ที่ใช้เป็นค่าเริ่มต้นถูกเลือกจากผลที่ผ่านมา จึงเสี่ยง winner's curse; ค่าที่ความน่าจะเป็นเท่ากันเรียงตามตัวเลข (ไม่มีนัยสถิติ); ML ไม่มีอันดับสำหรับ `last2` (ข้อมูลฝึกไม่พอ); คำนวณตอนเรียก (~2 วินาทีครั้งแรกที่ 146 งวด) จึงควรย้ายไป job เบื้องหลังเมื่อข้อมูลหลักพันงวด; ตาราง Top-n hit-rate ไม่ปรับหลายการทดสอบ; ยังไม่ได้ทดสอบ UI ใหม่กับ screen reader
11. อันดับอ้างอิงงวดล่าสุดที่มีในฐานข้อมูล — ถ้าไม่ได้ ingest งวดล่าสุด อันดับจะเป็นของ “งวดถัดจากงวดล่าสุดที่มี” (หน้าเว็บเตือนเมื่อวันออกรางวัลตามตารางผ่านไปแล้ว)

## 12. ขั้นถัดไปที่แนะนำ
ตรวจ ToS และหา source ที่สองที่เชื่อถือได้ (CSV/JSON) เพื่อตรวจ conflict จริง · ตั้ง cron สำหรับ `npm run ingest` · ย้าย rate limit/lock ไป Redis หากรันหลาย instance · เพิ่ม ESLint/CI (typecheck + test + integration)
