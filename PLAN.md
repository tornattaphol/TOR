# PLAN.md — Lao Lottery Statistics Dashboard

> ระบบนี้เป็น **การวิเคราะห์สถิติย้อนหลังเพื่อการศึกษา** เท่านั้น
> “การวิเคราะห์ย้อนหลังและโมเดลทางสถิติไม่สามารถรับประกันผลของการออกรางวัลในอนาคตได้”

## 1. Requirements และ Acceptance Criteria

| # | ข้อกำหนด | เกณฑ์ผ่าน |
|---|----------|-----------|
| R1 | ดึงข้อมูลผลลาวย้อนหลังจากแหล่งสาธารณะ แบบ configurable | มี adapter ≥ 3 แบบ (HTML, CSV, JSON); เปลี่ยน source ผ่าน `config/sources.json` + env ได้โดยไม่แก้โค้ด |
| R2 | ห้ามข้อมูลจำลองที่แสดงเป็นข้อมูลจริง | ไม่มี seed/mock ใน runtime; fixtures อยู่ใน `tests/` เท่านั้น; ไม่มีข้อมูล → แสดง Empty state |
| R3 | Source → Parser → Validator → Database → Analytics | แต่ละชั้นเป็น module แยกและทดสอบแยกได้ |
| R4 | Data Quality: duplicate / invalid date / invalid number / missing draw / source conflict | ตรวจครบทั้ง 5 + derived-digit mismatch + unexpected weekday; แสดงใน `/data-health` |
| R5 | Analytics: freq 1/2/3 หลัก, distribution 0–9, ต่อหลัก, เลขซ้ำ, ผลต่างระหว่างงวด, window 10/20/50/100, moving freq, charts | Unit tests ยืนยันค่าด้วยมือ |
| R6 | Dashboard + Filter (date range, จำนวนงวด, ประเภทผลรางวัล) | Responsive, ไทย, dark/light, loading/error/empty |
| R7 | Forecasting (ทดลอง): 6+ โมเดล, walk-forward backtest, เทียบ random baseline, Accuracy/MAE/LogLoss, หลักฐานทางสถิติ | มี “เลขแนะนำ/อันดับเลขงวดถัดไป” จากโมเดลทดลอง (เพิ่มตามคำขอเมื่อ 2026-10-06 — ดู §11) โดยต้องผูกกับ verdict ของ backtest และแสดง uncertainty เสมอ (มี test ป้องกัน) |
| R8 | Security: env secrets, validate ทุก input ภายนอก, rate limit, ป้องกัน injection, logging | ดู §9 |
| R9 | Tests: analytics, parser, validator, API, ingestion integration (ถูกต้อง/ซ้ำ/หาย/format ผิด/source ล่ม) | `npm test` และ `npm run test:integration` ผ่าน |
| R10 | เอกสารครบ + `.env.example` | README, ARCHITECTURE, DATA-SOURCE, API, DEVELOPMENT |
| R11 | ข้อความต้องห้าม (เลขเด็ด/แนะนำเลข/รับประกัน ฯลฯ) ห้ามปรากฏเชิงยืนยัน | test สแกน source UI |

## 2. ข้อจำกัด / Guardrails
- ใช้คำว่า “ความถี่ในอดีต / observed count” ไม่ใช้ “เลขเด็ด / hot / โอกาสออกสูง”
- Forecast module: backtest เรียก `predict` เฉพาะ index ที่ **มีผลจริงแล้ว**; อันดับงวดถัดไป (`nextDraw`) แยกส่วน เสิร์ฟผ่าน `/api/forecast/next-draw` เท่านั้น และผูกกับ verdict ของโมเดลเดียวกันเสมอ
- ทุกหน้ามี disclaimer; ทุก record เก็บ `source`, `source_url`, `fetched_at`
- ข้อจำกัดของ source ต้องบันทึกใน `DATA-SOURCE.md` (ไม่แก้ด้วยข้อมูลปลอม)

## 3. Architecture (ชั้นข้อมูล)

```
Source (HTTP/file) → Parser (per-source) → Validator (zod + rules) → Store (Prisma/Postgres) → Analytics → API → UI
                         │                     │
                         └── raw payload ──────┴── DataIssue / IngestionRun (observability)
```

โครงสร้างโฟลเดอร์:
```
config/sources.json         # ประกาศ source (ไม่มี secret)
prisma/schema.prisma        # schema + migrations
scripts/                    # ingest CLI, local DB (embedded-postgres)
src/lib/config              # env (zod)
src/lib/ingestion           # sources/ parsers/ validator/ pipeline
src/lib/db                  # prisma client + DrawStore (Prisma / In-memory)
src/lib/analytics           # pure functions
src/lib/forecasting         # models / backtest / metrics / significance
src/lib/quality             # data health report
src/lib/http                # fetch (timeout/retry/backoff), rate limit, api wrapper
src/app                     # pages + app/api route handlers
src/components              # charts, filters, layout
tests/                      # unit, api, integration
```

## 4. Database Schema (PostgreSQL via Prisma)
- `Draw` (canonical, unique `[lotteryCode, drawDate]`): drawDate `DATE`, drawId, result4/3/2 (`CHAR`, เก็บเป็น string เพื่อรักษา leading zero), source, sourceUrl, fetchedAt, sourceCount, hasConflict, extra JSON (animal, pattana ฯลฯ — schema ยืดหยุ่น)
- `SourceRecord` (ข้อสังเกตดิบต่อ source; unique `[sourceId, drawDate]`): ค่าที่ parse ได้ + rawPayload + sourceUrl + fetchedAt → ใช้ตรวจ source conflict
- `DataIssue`: kind, severity, sourceId, drawDate?, message, details, runId
- `IngestionRun`: sourceId, status, counters, errorCode/errorMessage, timing
- Index: `Draw(drawDate)`, `DataIssue(kind, createdAt)`

นโยบาย conflict: ใช้ source ที่ priority สูงสุดเป็น canonical, ตั้ง `hasConflict=true`, บันทึก `DataIssue(SOURCE_CONFLICT)`; ไม่เขียนทับเงียบๆ

## 5. Data Ingestion
- `SourceAdapter.fetch()` → `RawPage[]` (url, body, status); `Parser.parse(raw)` → `ParsedRecord[]` (ยังไม่เชื่อถือ)
- Adapters: `html-thelotterytoday` (หน้า list แบบแบ่งหน้า), `csv` (URL/ไฟล์ + column mapping), `json` (URL + field mapping, API key จาก env)
- Fetch: User-Agent ระบุตัวตน, timeout, retry + exponential backoff, delay ระหว่าง request, เคารพ robots.txt (เช็คก่อนดึง)
- “Source มีข้อมูลจริงก่อนบันทึก”: HTTP 2xx + content-type + parse ได้ ≥ 1 record ที่ผ่าน validation; มิฉะนั้น run = `FAILED` พร้อม error code (`SOURCE_UNAVAILABLE`, `EMPTY_RESPONSE`, `LAYOUT_CHANGED`, `PARSE_ERROR`) และ **ไม่แตะ DB**
- Validator: รูปแบบวันที่/ตัวเลข (`^\d{4}$` ฯลฯ), วันไม่อยู่ในอนาคต, 3/2 หลัก = ท้ายของ 4 หลัก, วันออกตรงตาราง `expectedWeekdays` (ผิด → quarantine ไม่เข้า Draw), duplicate ใน payload เดียว
- Idempotent upsert: รันซ้ำไม่สร้างซ้ำ

## 6. Analytics (pure, ไม่แตะ DB)
frequency (1/2/3/4 หลัก), distribution 0–9 ต่อหลัก (หลักสิบ/หน่วย/ร้อย…), chi-square เทียบ uniform (เป็น “ข้อมูลเชิงสถิติ” ไม่ใช่สัญญาณ), repeats (เลขซ้ำงวดติด/ซ้ำในช่วง), ผลต่างระหว่างงวด (`|Δ|`, signed), window 10/20/50/100, moving frequency (rolling), trend series

## 7. Forecasting (ทดลอง/ประเมินโมเดลเท่านั้น)
**เป้าหมาย (target):** `tens`, `units` (K=10), `last2` (K=100) — ลำดับตัวเลขตามเวลา
**โมเดล** (ทุกตัวคืน distribution ความน่าจะเป็นบน K คลาส จาก history ก่อน t เท่านั้น):
1. Uniform random baseline (อ้างอิง)
2. Frequency (expanding, Laplace α)
3. Rolling-window frequency
4. Moving average (EWMA ของ one-hot)
5. Markov order-1 (smoothed, backoff เข้า frequency)
6. Time-series: AR(p) (OLS) → discretized Gaussian
7. Monte Carlo (bootstrap/Dirichlet sampling, seeded)
8. ML: softmax regression บน lag features — **ทำงานเมื่อ train size ≥ threshold** ไม่เช่นนั้นรายงาน `insufficient_data`

**Backtest:** walk-forward (expanding หรือ rolling-window), `minTrain` ≥ 30, refit ทุก `refitEvery`; test กันข้อมูลอนาคตรั่ว (perturb future → prediction ที่ t ต้องไม่เปลี่ยน)
**Metrics:** Accuracy (top-1 vs 1/K), Log Loss (vs ln K), MAE (argmax vs ค่าจริง; baseline คำนวณค่าคาดหวังแบบ exact)
**หลักฐาน:** ผลต่าง log-loss รายงวด → bootstrap 95% CI (seeded) + sign-flip permutation test; binomial test ของ accuracy; Holm correction ข้ามโมเดล×target; verdict “มีหลักฐานเพียงพอ / ไม่พบหลักฐาน / ข้อมูลไม่พอ”
**UI แสดงเฉพาะ:** performance, backtest, uncertainty, เทียบ baseline, กราฟความคลาดเคลื่อน, ข้อจำกัดของโมเดล

## 8. API (Next.js Route Handlers)
`GET /api/draws` · `GET /api/analytics` · `GET /api/health` · `GET /api/sources` · `GET /api/forecast/backtest` · `POST /api/ingest` (Bearer token) · `GET /api/ingest/runs`
ทุก route: zod validate query, rate limit ต่อ IP, error format เดียวกัน, ไม่ leak stack/credential

## 9. Security
secrets ผ่าน env (`.env` ไม่ commit) · validate input/ข้อมูลภายนอกทุกครั้ง · Prisma parameterized (ไม่มี raw SQL ที่ต่อ string) · token เปรียบเทียบแบบ timing-safe · security headers (CSP, X-Content-Type-Options, frame-ancestors) · ingestion logging แบบ structured · parser ไม่ execute เนื้อหา · จำกัดขนาด response ที่ดึงมา

## 10. Testing Strategy
- Unit: analytics, models, metrics, significance, validators, parsers (fixtures จาก HTML จริงที่ย่อแล้ว)
- API: เรียก route handler โดยตรงกับ in-memory store
- Integration: pipeline + HTTP server จำลองใน test (node:http) → กรณี ถูกต้อง/ซ้ำ/หาย/format ผิด/source ล่ม/layout เปลี่ยน/conflict; และกับ PostgreSQL จริง (embedded) ผ่าน Prisma
- Guard test: สแกนข้อความต้องห้าม + ตรวจว่าเลขของงวดถัดไปอยู่ใน `nextDraw`/`/api/forecast/next-draw` เท่านั้น (backtest ไม่มี) และ UI แสดงอันดับพร้อมสถานะ verdict เสมอ

## 11. Local Environment
ไม่มี Postgres/Docker บนเครื่องนี้ → `embedded-postgres` (devDependency) ผ่าน `npm run db:local`; ทางเลือก `docker-compose.yml`; production ใช้ `DATABASE_URL` ปกติ

## 12. Risks / ข้อจำกัดที่คาด
- แหล่งข้อมูลสาธารณะเป็น HTML เปลี่ยน layout ได้ → parser แยกต่อ source + จับ `LAYOUT_CHANGED`
- ประวัติที่ source หลักให้ได้สั้น (~147 งวด) → อำนาจทางสถิติของ backtest ต่ำ (จะรายงานตรงๆ)
- Aggregator บางแห่งแสดงผลทุกวันธรรมดาซึ่งไม่ตรงตารางงวด จ/พ/ศ → ถือเป็น source conflict ไม่รวมเข้าข้อมูลหลัก
- ไม่มี API ทางการสาธารณะที่ยืนยันได้ → รองรับ JSON/CSV adapter เผื่อมีในอนาคต

## 13. Milestones
M1 scaffold + schema → M2 ingestion + quality → M3 analytics → M4 forecasting → M5 API → M6 UI/charts → M7 tests → M8 security review → M9 docs → M10 build/test/fix → `IMPLEMENTATION_SUMMARY.md`

---

## 14. สถานะและส่วนที่แตกต่างจากแผน (บันทึกหลังทำเสร็จ)

| หัวข้อ | แผน | ที่ทำจริง | เหตุผล |
|--------|-----|-----------|--------|
| ฐานข้อมูลในเครื่อง | PostgreSQL | PostgreSQL 17 จริงผ่าน `embedded-postgres` (+ `docker-compose.yml`) | เครื่องพัฒนาไม่มี PostgreSQL/Docker; ใช้ migration ชุดเดียวกับ production |
| Data source | “API หากมี” | HTML parser + CSV/JSON adapter | ไม่พบ API สาธารณะที่ยืนยันได้ (ดู DATA-SOURCE.md) |
| Time-series model | “Time-series model” | AR(2) + Gaussian ที่ปัดเป็นช่วง | ข้อมูลเป็น categorical; ระบุข้อจำกัดไว้ในหน้า Forecasting |
| ML | “ถ้ามีข้อมูลพอ” | Softmax regression; ทำงานเมื่อฝึก ≥ max(100, 10K) งวด | เป้าหมาย 100 ค่าจึงรายงาน “ข้อมูลไม่เพียงพอ” |
| API | “REST/Next.js API” | Next.js Route Handlers 8 เส้นทาง | — |
| กฎเพิ่มเติม (ไม่อยู่ในแผนเดิม) | — | quarantine วันออกรางวัลที่ผิดตาราง, ตรวจเลข 3/2 ตัวต้องเป็นส่วนท้ายของ 4 ตัว, manual redirect guard (SSRF), ตัด secret ออกจาก URL ที่เก็บ, `overrides` แก้ช่องโหว่ transitive | พบระหว่างตรวจข้อมูลจริง/ทดสอบ/security review |
| ESLint | ไม่ได้ระบุ | ไม่ได้ตั้งค่า (ใช้ `tsc --noEmit` strict) | ลดความซับซ้อน; เพิ่มภายหลังได้ |

ผลตามเกณฑ์ยอมรับ R1–R11: ผ่านทั้งหมด (หลักฐานใน IMPLEMENTATION_SUMMARY.md)

## 11. เพิ่มเติม (2026-10-06): เลขแนะนำ / อันดับเลขงวดถัดไป
**ที่มา:** ผู้ใช้ยืนยันว่าหน้า Forecasting ต้องมี “เลขแนะนำ” และ “อันดับเลขที่ควรออก” (เดิมระบบตีความว่าไม่ต้องมีและไม่แสดง)

| # | ข้อกำหนด | เกณฑ์ผ่าน |
|---|----------|-----------|
| N1 | จัดอันดับทุกค่าของ `last2`/`tens`/`units` สำหรับงวดถัดไป ต่อโมเดล | `report.nextDraw` + `GET /api/forecast/next-draw` (`top` 1–100); อันดับครบ เรียง รวมความน่าจะเป็น = 1 |
| N2 | “เลขแนะนำ” (headline) | โมเดลที่ Δ log-loss ย้อนหลังสูงสุดในกลุ่มที่มีข้อมูลเพียงพอ; ผู้ใช้เลือกโมเดลอื่นได้ |
| N3 | ไม่แสดงอันดับโดยไม่มีหลักฐานกำกับ | แบนเนอร์ verdict เหนือรายการ/ตาราง + ตาราง Top-n hit-rate ย้อนหลัง; content-guard บังคับ |
| N4 | uncertainty | ช่วง 5–95% (block bootstrap), shortlistShare, distanceFromUniform |
| N5 | ไม่ทำให้ backtest เปลี่ยนความหมาย | `/api/forecast/backtest` ไม่คืน `nextDraw`; `ModelResult` เพิ่มเฉพาะ `rankHits` (คะแนน) |
| N6 | ข้อมูลไม่พอ → ไม่แสดงอันดับ | `insufficient_data` พร้อมเหตุผล (เช่น ML บน 100 ค่า) |
| N7 | ข้อมูลล้าสมัย | แจ้งเตือนเมื่อวันออกรางวัลถัดไปตามตารางผ่านไปแล้ว |

**การตัดสินใจ:** (1) ใช้ถ้อยคำ “เลขแนะนำจากโมเดล (ทดลอง)” ตามที่ผู้ใช้ระบุ แต่เปลี่ยน “ควรออก” เป็น “โมเดลคาดว่าจะออก” เพราะ “ควร” อ่านเป็นข้อยืนยัน; (2) คงข้อความ “ไม่ใช่คำแนะนำให้ซื้อ/ไม่รับประกัน” ทุกหน้า; (3) การเลือกโมเดลจากผลย้อนหลังเสี่ยง winner's curse — ระบุใน UI; (4) hit-rate ต่อ Top-n เป็นคำอธิบาย ไม่ปรับหลายการทดสอบ จึงไม่ใช้ตัดสิน verdict
