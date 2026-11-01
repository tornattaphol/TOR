# Lao Lottery Statistics Dashboard

เว็บแอปวิเคราะห์ **สถิติย้อนหลัง** ของผลสลากลาวพัฒนา (Lao Development Lottery) เพื่อการศึกษา — ดึงข้อมูลจากแหล่งสาธารณะ ตรวจสอบคุณภาพ เก็บใน PostgreSQL แล้วแสดงเป็นตาราง กราฟ และสถิติ พร้อมโมดูลทดลองประเมินว่าโมเดลทางสถิติทำได้ดีกว่าการสุ่มหรือไม่

> ⚠ **การวิเคราะห์ย้อนหลังและโมเดลทางสถิติไม่สามารถรับประกันผลของการออกรางวัลในอนาคตได้**
> ระบบนี้ไม่ให้คำแนะนำการซื้อสลากหรือการเดิมพัน ไม่รับประกันผล และไม่สร้างข้อมูลจำลอง · อันดับเลขในหน้า `/forecasting` เป็นผลของโมเดลทดลองเพื่อศึกษาเท่านั้น และแสดงคู่กับผลทดสอบย้อนหลังเสมอ

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL · Prisma 7 · Recharts · Vitest

| หน้า | เนื้อหา |
|------|---------|
| `/` | งวดล่าสุด, จำนวนงวด, อัปเดตล่าสุด, แหล่งข้อมูล, สถิติโดยสรุป, กราฟความถี่/การกระจาย/แนวโน้ม, ตารางผลย้อนหลัง + ตัวกรอง |
| `/analytics` | หน้าต่าง 10/20/50/100 งวด, ความถี่ 00–99, เลขซ้ำ, ผลต่างระหว่างงวด, ความถี่แบบเคลื่อนที่, χ² ต่อหลัก |
| `/forecasting` | ประเมินโมเดล (ทดลอง): backtest แบบ walk-forward เทียบกับการสุ่ม + **เลขแนะนำจากโมเดลและอันดับเลขสำหรับงวดถัดไป** (ทดลอง) — ทุกอันดับแสดงคู่กับสถานะผลทดสอบย้อนหลังของโมเดลนั้นเสมอ ไม่ใช่คำแนะนำให้ซื้อ/เดิมพัน และไม่รับประกันผล |
| `/data-health` | จำนวน records, ข้อมูลผิดปกติ, duplicate, งวดที่ขาด, ประวัติการดึงข้อมูล, สถานะแหล่งข้อมูล |
| `/about` | วิธีการและข้อจำกัด |

เอกสารเพิ่มเติม: [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA-SOURCE.md](DATA-SOURCE.md) · [API.md](API.md) · [DEVELOPMENT.md](DEVELOPMENT.md) · [PLAN.md](PLAN.md) · [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)

---

## Quick start (local)

ต้องการ Node.js ≥ 20.9 (ทดสอบกับ 22) และ PostgreSQL (ทดสอบกับ 17) — ถ้าไม่มี PostgreSQL/Docker ใช้ตัวเลือก B

### 1) Install
```bash
npm install
```
> npm 12 บล็อก install-script ของแพ็กเกจโดยค่าเริ่มต้น; `package.json` มี `allowScripts` สำหรับ prisma / @prisma/engines / esbuild / @embedded-postgres แล้ว หากเห็นคำเตือน ให้รัน `npm install-scripts approve <pkg>`

### 2) ตั้งค่า environment
```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```
ค่าเริ่มต้นใน `.env.example` ใช้ได้กับ PostgreSQL ในเครื่องที่ port 5433 (ดู [.env.example](.env.example))

### 3) เปิดฐานข้อมูล — เลือกอย่างใดอย่างหนึ่ง
**A. Docker**
```bash
docker compose up -d
```
**B. Embedded PostgreSQL (ไม่ต้องติดตั้งอะไร)** — เปิดค้างไว้ในอีก terminal
```bash
npm run db:local
```

### 4) Database migration + ดึงข้อมูลจริง
```bash
npm run db:migrate          # prisma migrate deploy (production-safe)
npm run ingest:full         # ดึงประวัติทั้งหมดจากแหล่งข้อมูลที่เปิดใช้ (~20 วินาที)
```
### 5) Development
```bash
npm run dev                 # http://localhost:3000
```

---

## คำสั่งทั้งหมด

| งาน | คำสั่ง |
|-----|--------|
| Install | `npm install` |
| Development | `npm run dev` |
| Type check | `npm run typecheck` |
| Test (unit + API + ingestion, ไม่ต้องใช้ฐานข้อมูล) | `npm test` |
| Test integration (PostgreSQL จริงแบบ embedded) | `npm run test:integration` |
| Test กับแหล่งข้อมูลจริง (เลือกได้, ใช้เครือข่าย) | `LIVE_SOURCE_TEST=1 npm run test:integration` (PowerShell: `$env:LIVE_SOURCE_TEST=1; npm run test:integration`) |
| Build | `npm run build` (รัน `prisma generate` + `next build`) |
| Production | `npm run db:migrate && npm start` |
| Database migration (production) | `npm run db:migrate` |
| Database migration (สร้างใหม่ตอนพัฒนา) | `npm run db:migrate:dev -- --name <ชื่อ>` |
| Generate Prisma client | `npm run db:generate` |
| Data refresh (เพิ่มเติม: 2 หน้าแรก) | `npm run ingest` |
| Data refresh (backfill ทั้งหมด) | `npm run ingest:full` |
| Data refresh เฉพาะ source | `npm run ingest -- --source=thelotterytoday --max-pages=5` |

## Data refresh

ทุกวิธีผ่านขั้นตอนเดียวกัน Source → Parser → Validator → Database และบันทึก `IngestionRun` (ดูผลที่ `/data-health`):

1. **CLI** — `npm run ingest` (ตั้ง cron/Task Scheduler ได้ เช่น ทุก 6 ชั่วโมง; งวดออก จันทร์/พุธ/ศุกร์ ประมาณ 20:00 เวลาเวียงจันทน์)
2. **HTTP** — ตั้ง `INGEST_TOKEN` (≥ 16 ตัวอักษร) แล้วเรียก
   ```bash
   curl -X POST http://localhost:3000/api/ingest \
     -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
     -d '{"source":"thelotterytoday","maxPages":2}'
   ```
3. หากแหล่งข้อมูลล่ม/เปลี่ยนรูปแบบ/ไม่มีข้อมูล ระบบจะ **ไม่เขียนข้อมูลใดๆ** และบันทึก error code ที่ชัดเจน (`SOURCE_UNAVAILABLE`, `EMPTY_RESPONSE`, `LAYOUT_CHANGED`, `ROBOTS_DISALLOWED`, `NO_VALID_RECORDS`, …) — ดู [DATA-SOURCE.md](DATA-SOURCE.md)

## Production checklist

- ตั้ง `DATABASE_URL` (role เฉพาะแอป + SSL), `INGEST_TOKEN` (ถ้าต้องการ endpoint refresh) ผ่าน environment ของโฮสต์ ไม่ใช่ไฟล์ที่ commit
- `npm run build && npm run db:migrate && npm start` (หรือ `node` ใต้ process manager)
- วางหลัง reverse proxy ที่เขียนทับ `X-Forwarded-For` (rate limiter ใช้ค่านี้) — ดู [ARCHITECTURE.md](ARCHITECTURE.md#security)
- ตรวจสอบเงื่อนไขการใช้งาน (Terms of Service) ของแหล่งข้อมูลก่อนเปิดใช้จริง — ระบบตรวจ robots.txt ให้ แต่ไม่ได้ตรวจเงื่อนไขทางกฎหมาย
- ตั้ง `INGEST_USER_AGENT` ให้มีข้อมูลติดต่อของผู้ดูแลเว็บไซต์

## โครงสร้างโปรเจกต์

```
config/sources.json        # ประกาศแหล่งข้อมูล (ไม่มี secret)
prisma/                    # schema.prisma + migrations
scripts/                   # ingest CLI, db-local (embedded PostgreSQL)
src/app/                   # หน้าเว็บ (App Router) + app/api/* (REST)
src/components/            # UI, ตัวกรอง, กราฟ (Recharts)
src/lib/ingestion/         # adapters (Source) · parsers · validator · reconcile · pipeline
src/lib/db/                # DrawStore (Prisma + in-memory), planBatch
src/lib/analytics/         # สถิติเชิงพรรณนา (ฟังก์ชันล้วน)
src/lib/forecasting/       # โมเดล · walk-forward backtest · metrics · significance · nextdraw (อันดับงวดถัดไป) · ranking
src/lib/quality/           # Data Health report
src/lib/http/              # HTTP client (robots, retry), rate limit, API wrapper
tests/                     # unit · api · ingestion · integration (+ helpers)
```

## ข้อจำกัดที่ควรรู้

- แหล่งข้อมูลหลักให้ประวัติราว 1 ปี (~147 งวด) → กำลังการทดสอบทางสถิติของโมดูลประเมินโมเดลต่ำ (ระบบรายงานตรงๆ)
- แหล่งข้อมูลสาธารณะบางแห่งแสดงผลทุกวันจันทร์–ศุกร์ ซึ่งไม่ตรงกับตารางงวด จ/พ/ศ → ถูกกักกันเป็น `UNEXPECTED_WEEKDAY`
- พบรายการที่ source ให้เลขไม่สอดคล้องกันเอง (2026-04-20) → ถูกปฏิเสธ ไม่เข้าชุดข้อมูล
- รายละเอียดทั้งหมดใน [DATA-SOURCE.md](DATA-SOURCE.md)
