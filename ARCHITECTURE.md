# ARCHITECTURE.md

## 1. ภาพรวม

```
                        ┌────────────────────────── ingestion (CLI / POST /api/ingest) ──────────────────────────┐
 public web / CSV / API │  Source adapter → Parser → Validator → reconcile/planBatch → DrawStore (PostgreSQL)    │
 (config/sources.json)  │  (fetch, robots,   (per-source,  (rule-based,       (priority, conflicts,               │
                        │   retry, paging)   untrusted)    quarantine)         idempotent upsert)                 │
                        └──────────────────────────────┬───────────────────────────────┬─────────────────────────┘
                                                       │ DataIssue / IngestionRun      │ Draw / SourceRecord
                                                       ▼                               ▼
 browser ── Next.js pages (client components) ── REST /api/* ── services ── analytics (pure) · forecasting (pure) · quality (pure)
```
หลักการออกแบบ: **ฟังก์ชันล้วนสำหรับคำนวณ (analytics/forecasting/quality/validator/planBatch)** แยกจาก I/O (HTTP, ฐานข้อมูล) ทำให้ทดสอบละเอียดได้โดยไม่ต้องมีฐานข้อมูลหรือเครือข่าย และสลับ store ได้ (`DrawStore` port: Prisma/PostgreSQL หรือ in-memory)

## 2. ชั้นข้อมูล (Source → Parser → Validator → Database → Analytics)

| ชั้น | ไฟล์ | หน้าที่ | หลักความปลอดภัย |
|------|------|---------|-----------------|
| Source | `ingestion/adapters.ts`, `http/client.ts`, `http/robots.ts` | รู้ว่า “ดึงอย่างไร” (HTTP, แบ่งหน้า, ไฟล์) | robots.txt, UA, หน่วง, timeout, retry, จำกัดขนาด, redirect เฉพาะ host เดิม, ไม่ตามลิงก์ในเนื้อหา |
| Parser | `ingestion/parsers/*` | แปลงเนื้อหาเป็น `RawRecord` (ค่าตามที่ประกาศ ยังไม่เชื่อถือ) | ไม่ execute เนื้อหา, ไม่อ่าน prototype ของ JSON, ไม่ทิ้งแถวที่แปลกเงียบๆ |
| Validator | `ingestion/validator.ts` | กฎวันที่/รูปแบบเลข/ความสอดคล้อง/ตารางงวด/ซ้ำ | **ไม่ซ่อมค่าผิด** — ปฏิเสธหรือกักกันพร้อมบันทึกเหตุผล |
| Database | `db/store.ts`, `db/plan.ts`, `db/prisma-store.ts`, `db/memory-store.ts` | บันทึกแบบ atomic, idempotent, ตรวจ conflict | Prisma parameterised; transaction ต่อ batch; unique ที่ระดับ DB |
| Analytics | `analytics/*` | สถิติเชิงพรรณนา | ฟังก์ชันล้วน ไม่แตะ DB |

`pipeline.ts` ประกอบชั้นเหล่านี้ และรับประกันว่า **source ล่ม/ว่าง/ผิดรูปแบบ/ไม่มีแถวที่ผ่าน validation → ไม่เขียนตาราง `draws`** พร้อมบันทึก `IngestionRun(FAILED, errorCode)`

## 3. Database schema (`prisma/schema.prisma`)

| ตาราง | หน้าที่ | หมายเหตุ |
|-------|---------|----------|
| `draws` | ผลที่ถือเป็นข้อมูลหลัก 1 แถวต่อ (lottery, วัน) | คอลัมน์ `draw_date`, `draw_id`, `result_2_digit`, `result_3_digit`, `result_4_digit`, `source`, `source_url`, `fetched_at`, `source_count`, `has_conflict`, `extra` (JSON ยืดหยุ่น). เลขเป็น `VARCHAR` เพื่อเก็บเลข 0 นำหน้า. unique `(lottery_code, draw_date)` และ `(lottery_code, draw_id)` |
| `source_records` | ข้อสังเกตดิบต่อ source (ใช้ตรวจ conflict) | unique `(source_id, lottery_code, draw_date)`; เก็บ `raw_payload` |
| `data_issues` | ปัญหาคุณภาพข้อมูลแบบไม่ซ้ำ (fingerprint) | นับ `occurrences`, `first/last_seen_at` |
| `ingestion_runs` | ประวัติการดึง | สถานะ, ตัวนับ, `error_code`, `error_message` (ปลอดภัย ไม่มี secret) |

`draw_date` เป็น `DATE` (วันตามปฏิทินเวียงจันทน์ ไม่มี time zone) และในโค้ดเป็นสตริง `YYYY-MM-DD` เพื่อตัดปัญหา time zone drift
`lottery_code`/`extra` ทำให้ขยายไปยังผลิตภัณฑ์อื่นหรือฟิลด์เพิ่มเติม (เลขสัตว์, เลขพัฒนา) โดยไม่เปลี่ยนโครงสร้างหลัก

### นโยบาย conflict และ idempotency (`db/plan.ts`, `ingestion/reconcile.ts`)
- upsert ตาม `(source, date)`; รันซ้ำ → `unchanged`
- source ต่างกันให้ผลต่างกัน → ค่าจาก source `priority` ต่ำสุด + `has_conflict=true` + `SOURCE_CONFLICT`; ถ้าผลตรงกันและ source หนึ่งมีเลข 3/4 หลักที่อีกแห่งไม่มี จะเติมให้เฉพาะกรณีไม่ขัดแย้ง
- `planBatch` เป็นฟังก์ชันล้วนที่ทั้ง Prisma และ in-memory store ใช้ร่วมกัน จึงไม่ drift; ชุดทดสอบ “store contract” เดียวกันรันกับทั้งสองแบบ

## 4. Analytics (`src/lib/analytics`)
ความถี่ (1/2/3/4 หลัก, ตาราง 00–99), การกระจาย 0–9 ต่อหลัก + χ² เทียบ uniform (ตัวอย่างน้อย → ระบุว่า approximation ไม่ถูกต้อง), เลขซ้ำ (ติดกัน/ซ้ำในช่วง/เลขเบิ้ล/ระยะห่าง), ผลต่างระหว่างงวด, หน้าต่าง 10/20/50/100, moving frequency/average, ฮิสโตแกรม
ทุกฟังก์ชันเป็น descriptive: บอกสิ่งที่เกิดขึ้นแล้ว และ UI แสดงค่าคาดหวังเมื่อกระจายสม่ำเสมอควบคู่เสมอ

## 5. Forecasting module (ทดลอง — ประเมินโมเดล + อันดับเลขงวดถัดไป)

**เป้าหมาย:** `last2` (100 ค่า), `tens`, `units` (10 ค่า) · **โมเดล:** uniform (เกณฑ์สุ่ม), frequency, rolling frequency, EWMA, Markov-1, AR(2)+Gaussian, Monte Carlo (smoothed bootstrap), softmax regression (ML — ต้องมีข้อมูลฝึก ≥ max(100, 10×K) งวด)

**Backtest แบบ walk-forward (`backtest.ts`):** สำหรับ index t ที่ทดสอบ โมเดลได้รับ `Object.freeze(y.slice(start, t))` — ข้อมูลอนาคต *ไม่อยู่ใน array* จึงรั่วไม่ได้โดยโครงสร้าง; refit ทุก `refitEvery` ด้วยข้อมูลก่อนหน้าเท่านั้น; รองรับ expanding และ rolling window; มี property test ว่าเปลี่ยนข้อมูลอนาคตแล้วคะแนนก่อนหน้าไม่เปลี่ยนสำหรับทุกโมเดล

**Metrics (`metrics.ts`):** Accuracy (เทียบ 1/K, Wilson CI, binomial exact), Log-loss (เทียบ ln K), MAE (ค่าคาดหวังของการเดาสุ่มคำนวณแบบ exact) — ทุกอย่าง *จับคู่* กับเกณฑ์สุ่มบนงวดเดียวกัน

**หลักฐาน (`significance.ts`):** ผลต่าง log-loss รายงวด → block-bootstrap 95% CI + sign-flip permutation test (ทางเดียว) → ปรับค่า p ด้วย **Holm–Bonferroni ข้ามทุกโมเดล × เป้าหมาย** → verdict “มีหลักฐาน” ต้องผ่านทั้ง p ปรับแล้ว < 0.05 **และ** CI ไม่คร่อม 0 · การทดสอบ calibration ใน test suite ใช้ลำดับสุ่มสังเคราะห์ (ไม่แสดงใน UI) — ที่ 140 งวดสุ่มสม่ำเสมอ (วัดครั้งเดียว 100 ชุด; test ใน repo ใช้ 40 ชุด) ไม่มีชุดใดถูกตั้งธง “มีหลักฐาน” และ p ดิบ < 0.05 เพียง 0.1% ของ 2,000 การทดสอบ (ขั้นตอน **อนุรักษ์**: โมเดลที่ประมาณจากข้อมูลจำกัดมักแย่กว่าสุ่มเมื่อข้อมูลเป็นสุ่มจริง จึงตรวจจับได้เฉพาะรูปแบบชัดเจน) และใช้รูปแบบที่กำหนดไว้ (วงจรหลักสิบ) เพื่อยืนยันว่าเครื่องมือ *ตรวจจับสัญญาณชัดเจนได้*; กำลังตรวจจับสัญญาณอ่อนไม่ได้ถูกวัด

**อันดับเลขงวดถัดไป (`nextdraw.ts`, `ranking.ts`):** แยกจาก backtest โดยตั้งใจ และ *opt-in* (`runForecastExperiment(..., { nextDraw: {...} })`; ไม่ระบุ → `report.nextDraw === null`)
- ฝึกทุกโมเดล (ยกเว้นเกณฑ์สุ่ม) ด้วย **ทุกงวดที่มี** (หรือหน้าต่างล่าสุดเมื่อใช้ rolling) แล้วจัดอันดับทุกค่าของแต่ละเป้าหมาย (`last2` 100 ค่า, `tens`/`units` 10 ค่า) ตามความน่าจะเป็นที่โมเดลให้; ค่าที่ความน่าจะเป็นเท่ากันจัดอันดับร่วมกัน (competition rank, flag `tied`) และเรียงตามค่าตัวเลขเพื่อให้ผลคงที่
- **ความไม่แน่นอน:** ฝึกซ้ำบน block-bootstrap ของประวัติ (ค่าเริ่มต้น 200 รอบ; ML 30 รอบ; เก็บ 2 งวดล่าสุดจริงไว้เพื่อให้โมเดลที่อิงงวดก่อนหน้าทำนายจากบริบทจริง) → ช่วง 5–95% ของความน่าจะเป็น และ `shortlistShare` = สัดส่วนรอบที่ค่านั้นยังอยู่ใน 10 (หรือ 3) อันดับแรก; `distanceFromUniform` = total-variation จากการสุ่ม (ใกล้ 0 = แยกจากสุ่มไม่ออก)
- **ผูกกับหลักฐานเสมอ:** แต่ละอันดับมี `verdict`/`logLossAdvantage` ของ *โมเดลและเป้าหมายเดียวกัน* จาก backtest; UI แสดงแบนเนอร์สถานะเหนือทั้งรายการสั้นและตารางเต็ม (`RANKING_STATUS_TEXT` ใน `disclaimer.ts`) พร้อมตาราง **Top-n hit rate ย้อนหลัง** (ผลจริงเคยอยู่ใน Top-n ของโมเดลกี่ครั้ง เทียบ n/K พร้อม Wilson CI) — `rankHits` ใช้ฟังก์ชันจัดอันดับเดียวกับที่แสดง และตรวจสอบกับข้อมูลสุ่มสังเคราะห์แล้ว (150 ชุด: อัตรา hit เฉลี่ย = n/K, ช่วงเชื่อมั่นพลาดค่าสุ่มราว 5% ต่อช่อง ตามที่ควร) เป็นเพียงคำอธิบายไม่ปรับหลายการทดสอบ จึงไม่เข้า verdict
- **เลขแนะนำ (headline):** ใช้โมเดลที่มี Δ log-loss ย้อนหลังสูงสุดในกลุ่มที่มีงวดทดสอบเพียงพอ (ผู้ใช้เลือกโมเดลอื่นได้) — เป็นการเลือกจากผลย้อนหลังจึงเสี่ยง winner's curse ซึ่ง UI ระบุไว้ ไม่ได้แปลว่าโมเดลนั้นผ่านเกณฑ์
- โมเดลที่ข้อมูลฝึกไม่พอ (เช่น ML บน 100 ค่า) ไม่แสดงอันดับ (`insufficient_data`)

**Guardrails:** ตัวเลขของงวดที่ยังไม่ออกมีที่เดียวคือ `report.nextDraw` เสิร์ฟผ่าน `GET /api/forecast/next-draw` เท่านั้น — `GET /api/forecast/backtest` ตัด `nextDraw` ออก (`withoutNextDraw`) และ `report.targets` (`ModelResult`) มีเฉพาะคะแนนและความไม่แน่นอน (test ตรวจ key ที่อนุญาตและห้ามคำอย่าง ranking/recommend/prediction ในส่วนนั้น); คำต้องห้ามถูกสแกนใน source (`tests/unit/content-guard.test.ts`) — คำว่า "เลขแนะนำ" อนุญาตเฉพาะ `NextDrawSection.tsx` ซึ่ง test บังคับว่าต้องมีแบนเนอร์สถานะ verdict + ตาราง hit-rate + ช่วงความไม่แน่นอน; `ควรออก`/`ออกแน่`/`เลขเด็ด`/`ควรซื้อ` ยังห้ามทุกที่

## 6. API layer (`src/app/api/*`, `src/lib/http/api.ts`)
`apiHandler` ห่อทุก route: rate limit (3 ชั้น: default / heavy / ingest) → zod validate (`schemas.ts`) → service → envelope `{data, meta:{generatedAt, disclaimer, …}}`; ข้อผิดพลาดมีรูปแบบเดียว `{error:{code,message}}` — 400 พารามิเตอร์ผิด, 401/503 ingest, 409 ซ้อน, 429, 503 ฐานข้อมูลใช้ไม่ได้ (แยกจาก 500), 500 ข้อความทั่วไป (ไม่เปิดเผย stack/SQL/credential) รายละเอียดใน [API.md](API.md)

## 7. Frontend
Next.js App Router; หน้าเป็น client component ที่เรียก REST API (ตัวกรองอยู่ใน URL — แชร์/บุ๊กมาร์กได้); Recharts; ธีมสว่าง/มืดด้วย CSS variables (ชุดสีมืดเลือกแยก ไม่ใช่การกลับสี) ผ่าน `html[data-theme]` + script ก่อน paint; ทุกกราฟมี tooltip, legend, ตัวเลือก “ดูเป็นตาราง”, และสถานะ loading/error/empty; สถานะใช้ไอคอน+ข้อความ ไม่พึ่งสีอย่างเดียว

## 8. Security
| หัวข้อ | การดำเนินการ |
|--------|--------------|
| Secrets | env เท่านั้น (`.env` ถูก ignore); `.env.example` ไม่มีค่าจริง; API key อ้างด้วยชื่อ env ใน config; logger redact คีย์ชื่อ token/secret/password/authorization/api key/database_url |
| Input | ทุก query/body ผ่าน zod (ช่วงค่า, regex, strict body); วันที่ตรวจว่ามีจริง; ขนาด body ≤ 10 KB |
| Injection | Prisma parameterised ทั้งหมด (ไม่มี raw SQL ที่ต่อสตริงในโค้ดแอป); React escape; href จากข้อมูลภายนอกผ่าน `safeHref` (http/https เท่านั้น); ทดสอบข้อความ `'; DROP TABLE` เป็นข้อมูล |
| Auth ของ ingest | Bearer token เทียบแบบ constant-time (SHA-256 + `timingSafeEqual`); ปิดใช้งานถ้าไม่ตั้ง `INGEST_TOKEN`; rate limit รวมการพยายามที่ผิด |
| Rate limiting | sliding window ต่อ IP (in-memory). **ข้อจำกัด:** ต่อโปรเซส ไม่แชร์ข้ามหลาย instance และเชื่อ `X-Forwarded-For` — ต้องวางหลัง proxy ที่เขียนทับ header หรือย้ายไป edge/Redis |
| SSRF | URL ของ source มาจาก config เท่านั้น; ไม่ตามลิงก์ในเนื้อหา; redirect เฉพาะ host เดิม ≤ 3; API key ไม่ถูกส่งข้าม host |
| HTTP headers | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, ปิด `X-Powered-By`. **ข้อจำกัด:** CSP ต้องอนุญาต `'unsafe-inline'` สำหรับ script ที่ Next.js ใช้ hydrate (ปรับเป็น nonce ได้ภายหลัง) |
| Error exposure | 500 ทั่วไป; connection string/SQL ถูกกรองจาก log และ `error_message` |
| Dependencies | `npm audit` = 0 ช่องโหว่; ใช้ `overrides` ยก `mysql2`/`deepmerge-ts` (transitive ของ Prisma CLI) เป็นเวอร์ชันที่แก้แล้ว (ตรวจว่า `prisma generate`/`migrate deploy` ยังทำงาน) — ทบทวนเมื่ออัปเกรด Prisma |
| Logging | JSON lines: `run_started/page_parsed/run_finished/retry/robots_unreachable/api_error` พร้อมตัวนับและ error code |

## 9. การ deploy และข้อจำกัดเชิงสถาปัตยกรรม
- แอปเป็น stateless ยกเว้น rate limiter, cache forecast และ lock `/api/ingest` ที่อยู่ในหน่วยความจำ → หลาย instance ต้องย้ายสามอย่างนี้ (Redis/advisory lock) หรือรัน ingestion เป็น job เดียว (cron)
- Forecast (backtest + bootstrap ของอันดับงวดถัดไป) คำนวณตอนเรียก (~2 วินาทีที่ ~150 งวด ครั้งแรก; ครั้งถัดไปมาจาก cache) พร้อม cache แบบ versioned ตามข้อมูลที่ใช้ร่วมกันระหว่าง `/api/forecast/backtest` และ `/api/forecast/next-draw`; ข้อมูลหลักพันงวด (โดยเฉพาะ ML บน 100 ค่าที่ฝึกซ้ำทุกรอบ bootstrap) ควรย้ายไป job เบื้องหลัง
- ไม่มีระบบผู้ใช้/สิทธิ์ — เว็บเป็นสาธารณะแบบอ่านอย่างเดียว ยกเว้น endpoint refresh ที่ใช้ token
