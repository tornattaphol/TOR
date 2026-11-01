# DEVELOPMENT.md

## ตั้งค่าเครื่องพัฒนา
ดู [README.md](README.md#quick-start-local). สรุป: `npm install` → `.env` → `npm run db:local` (หรือ `docker compose up -d`) → `npm run db:migrate` → `npm run ingest:full` → `npm run dev`

- **Node ≥ 20.9** (Next.js 16). ทดสอบบน Node 22 / Windows 11
- **Prisma 7**: client ถูก generate ไป `src/generated/prisma` (ignore ใน git) และสร้างใหม่ใน `npm run build`/`npm run db:generate`; การเชื่อมต่อใช้ driver adapter (`@prisma/adapter-pg`) ใน `src/lib/db/prisma.ts`; `DATABASE_URL` ถูกอ่านใน `prisma.config.ts` (โหลด `.env` ผ่าน `dotenv`)
- **embedded Postgres** (`scripts/db-local.ts`): PostgreSQL 17 จริง บังคับ UTF-8/`C` locale, ข้อมูลที่ `.data/pg`, port 5433 — ใช้เฉพาะ dev/test
- `package.json` → `overrides` (mysql2, deepmerge-ts) ยกเวอร์ชัน transitive ของ Prisma CLI เพื่อให้ `npm audit` = 0; ตรวจสอบเมื่ออัปเกรด Prisma (ลบ override ได้ถ้า Prisma รุ่นใหม่แก้เอง)
- `package.json` → `allowScripts`: npm 12 บล็อก install-script; รายการที่อนุมัติ = prisma, @prisma/engines, esbuild, @embedded-postgres/windows-x64

## การทดสอบ
| ชุด | คำสั่ง | ต้องการ | ครอบคลุม |
|-----|--------|---------|----------|
| unit + API + ingestion | `npm test` | ไม่ต้องมี DB/เครือข่ายภายนอก | analytics, math, parsers, validator, config, robots, rate limit, forecasting (รวม no-look-ahead property test, calibration), quality, content-guard, route handlers, pipeline กับ HTTP server จำลองในเครื่อง (`node:http`) |
| integration | `npm run test:integration` | embedded PostgreSQL (ดาวน์โหลดผ่าน npm แล้ว) | migration จริง, store contract บน PostgreSQL, constraint/transaction/rollback, pipeline + API บน DB จริง, ความเท่าเทียมของ analytics ระหว่าง DB กับ memory |
| live (ไม่บังคับ) | `LIVE_SOURCE_TEST=1 npm run test:integration` | เครือข่าย | ตรวจว่า parser ยังตรงกับเว็บจริง (ดึง 1 หน้า) |

กรณีที่ครอบคลุมตามข้อกำหนด: **ข้อมูลถูกต้อง** · **ข้อมูลซ้ำ** (ในหน้าเดียว/ข้ามหน้า/รันซ้ำ) · **ข้อมูลหาย** (งวดขาด, แถวถูกปฏิเสธ) · **format ผิด** (ตัวเลข/วันที่/เลขท้ายไม่สอดคล้อง/ผิดวันออกรางวัล) · **source unavailable** (5xx, 404, timeout, ปฏิเสธการเชื่อมต่อ, robots, layout เปลี่ยน, ว่าง, เกินขนาด, redirect ข้าม host)
ข้อมูลใน `tests/` เป็น fixture เพื่อทดสอบเท่านั้น (ไม่ถูก import จากโค้ด runtime — มี test ตรวจ) ลำดับสุ่มใน calibration test ไม่ถูกนำไปแสดงเป็นข้อมูลหวย

## เพิ่ม source adapter ใหม่
ชนิดที่รองรับโดยไม่ต้องเขียนโค้ด: `csv`, `json` ([DATA-SOURCE.md](DATA-SOURCE.md#4-เพิ่มเปลี่ยนแหล่งข้อมูล-ไม่ต้องแก้โค้ด)). สำหรับ HTML ของเว็บอื่น:
1. สร้าง `src/lib/ingestion/parsers/<ชื่อ>.ts` — ฟังก์ชันล้วน `(html, pageUrl, fetchedAt) → { records: RawRecord[], warnings, layoutRecognised, … }` อย่าเดา/ซ่อมค่า; ค่าที่ไม่รู้จักให้ส่งต่อให้ validator ปฏิเสธ
2. เพิ่ม schema ใน `src/lib/config/sources.ts` (ชนิดใหม่ใน discriminated union) และ `case` ใน `createAdapter` (`ingestion/adapters.ts`) — ใช้ `ctx.http.get()` เพื่อให้ได้ robots/retry/timeout/redirect guard ฟรี
3. เขียนเทสต์ parser ด้วย HTML fixture ที่ย่อจากหน้าจริง + เพิ่มกรณีใน `tests/ingestion/pipeline.test.ts`
4. เพิ่มรายการใน `config/sources.json`, อัปเดต DATA-SOURCE.md (ข้อจำกัดที่พบ)

## เพิ่มโมเดลพยากรณ์ (ประเมินเท่านั้น)
1. เพิ่ม `ModelSpec` ใน `src/lib/forecasting/models.ts` (คืน distribution บน K คลาส จาก `history` ที่ได้รับเท่านั้น; ต้องมี mixture กับ uniform เล็กน้อยเพื่อไม่ให้ log-loss เป็นอนันต์; กำหนด `minTrain(K)`)
2. ใส่ `MODEL_COLORS` ใน `components/charts.tsx` (สีตามชื่อโมเดล ไม่ใช่ตามอันดับ)
3. ชุดทดสอบ `forecasting.test.ts` จะตรวจให้อัตโนมัติ: distribution ถูกต้อง, deterministic, ไม่มี look-ahead
4. โมเดลใหม่จะถูกจัดอันดับงวดถัดไปโดยอัตโนมัติผ่าน `buildNextDraw` (`nextdraw.ts`) และได้ verdict จาก backtest เดียวกัน — ไม่ต้องแก้ UI; `nextdraw.test.ts` ตรวจ: อันดับครบ/เรียง/รวมเป็น 1, ผูก verdict, deterministic, ไม่มีอันดับเมื่อข้อมูลไม่พอ
- ตัวเลขของงวดที่ยังไม่ออกต้องอยู่ใน `report.nextDraw` และเสิร์ฟผ่าน `/api/forecast/next-draw` เท่านั้น; **ห้าม** ใส่ใน `report.targets` หรือ `/api/forecast/backtest` และ **ห้าม** แสดงอันดับใน UI โดยไม่มีแบนเนอร์สถานะ verdict — test `safety: the backtest section carries scores only…` และ `content-guard` ("a ranking is never shown without its evidence status") จะล้มเหลว

## ข้อตกลงโค้ด
- TypeScript strict; `npm run typecheck` ต้องผ่านก่อน commit
- ตรรกะคำนวณ = ฟังก์ชันล้วนใน `src/lib/*`; I/O แยกชั้น (`db/`, `http/`, `ingestion/adapters.ts`)
- ข้อความผู้ใช้เป็นภาษาไทย; ห้ามใช้ถ้อยคำเชิงแนะนำเลข/รับประกัน (ดู `tests/unit/content-guard.test.ts` และ `src/lib/disclaimer.ts`)
- ตัวเลขผลเก็บเป็นสตริงเสมอ; วันที่เป็น `YYYY-MM-DD`
- เปลี่ยน schema: แก้ `prisma/schema.prisma` → `npm run db:migrate:dev -- --name <ชื่อ>` → commit migration

## แก้ปัญหาที่พบบ่อย
| อาการ | สาเหตุ/วิธีแก้ |
|-------|----------------|
| `DATABASE_UNAVAILABLE` (503) หรือ `DATABASE_URL is not set` | ยังไม่เปิดฐานข้อมูล / ไม่มี `.env` — `npm run db:local` |
| `npm install` เตือน install-scripts blocked | `npm install-scripts approve prisma @prisma/engines esbuild @embedded-postgres/windows-x64` |
| `Cannot find module '…/generated/prisma/client'` | `npm run db:generate` |
| `npm run ingest` → `ROBOTS_DISALLOWED` | robots.txt ของ source ห้าม path นี้ หรือเข้าไม่ถึง (5xx) — ระบบหยุดดึงโดยตั้งใจ |
| `ingest` → `LAYOUT_CHANGED` / `NO_VALID_RECORDS` | เว็บเปลี่ยน HTML — ตรวจด้วย `LIVE_SOURCE_TEST=1`, ปรับ parser, ดู `/data-health` |
| port 3000/5433 ถูกใช้ | `PORT=3100 npm start`; `LOCAL_PG_PORT=5434 npm run db:local` (แก้ `DATABASE_URL` ด้วย) |
| `db:local` ค้างหลังปิดเครื่องผิดปกติ | ลบ `.data/pg/postmaster.pid` หรือโฟลเดอร์ `.data` (ข้อมูลทดสอบในเครื่อง ดึงใหม่ได้) |
