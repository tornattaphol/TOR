# API.md

REST ผ่าน Next.js Route Handlers (Node runtime) · ฐาน URL ตัวอย่าง `http://localhost:3000` · ตอบ JSON UTF-8

ทุกคำตอบสำเร็จมีรูปแบบ
```jsonc
{ "data": { … },
  "meta": { "generatedAt": "2026-10-04T11:22:58.531Z",
            "disclaimer": "การวิเคราะห์ย้อนหลังและโมเดลทางสถิติไม่สามารถรับประกันผลของการออกรางวัลในอนาคตได้", … } }
```
ข้อผิดพลาดทุกชนิด:
```jsonc
{ "error": { "code": "BAD_REQUEST", "message": "…", "details": [ { "path": "from", "message": "…" } ] } }
```
| HTTP | `error.code` | เมื่อไร |
|------|--------------|---------|
| 400 | `BAD_REQUEST`, `UNKNOWN_SOURCE` | พารามิเตอร์/เนื้อหาไม่ผ่านการตรวจสอบ (มี `details` รายฟิลด์) |
| 401 | `UNAUTHORIZED` | token ผิด/ไม่มี (`/api/ingest`) |
| 409 | `ALREADY_RUNNING` | กำลังดึงข้อมูลอยู่ |
| 413 | `PAYLOAD_TOO_LARGE` | body > 10 KB |
| 429 | `RATE_LIMITED` | เกินโควตา (มี `Retry-After` วินาที) |
| 503 | `DISABLED` | ไม่ได้ตั้ง `INGEST_TOKEN` |
| 503 | `DATABASE_UNAVAILABLE` | เชื่อมต่อฐานข้อมูลไม่ได้/ไม่ได้ตั้ง `DATABASE_URL` (มี `Retry-After`) |
| 500 | `INTERNAL_ERROR` | ข้อผิดพลาดภายใน (ข้อความทั่วไป ไม่มี stack/SQL/credential) |

**Rate limit** ต่อ IP: ทั่วไป 120/นาที (`RATE_LIMIT_PER_MINUTE`), `forecast/backtest` และ `forecast/next-draw` 12/นาที (`RATE_LIMIT_HEAVY_PER_MINUTE`), `POST /api/ingest` 6/ชั่วโมง (`RATE_LIMIT_INGEST_PER_HOUR`)
วันที่ทั้งหมดเป็น `YYYY-MM-DD` (วันตามปฏิทินเวียงจันทน์); ตัวเลขผลเป็น **สตริง** (เก็บเลข 0 นำหน้า)

---

## GET `/api/meta`
ภาพรวมชุดข้อมูล
```jsonc
{ "data": { "totalDraws": 146, "firstDate": "2025-10-13",
            "latestDraw": { "drawDate": "2026-10-02", "drawId": "lao_dev_20261002", "result4": "4693", "result3": "693", "result2": "93",
                            "source": "thelotterytoday", "sourceUrl": "https://thelotterytoday.com/en/lottery/lao-lottery/2026-10-02",
                            "fetchedAt": "2026-10-04T11:08:20.936Z", "hasConflict": false, "sourceCount": 1 },
            "lastUpdated": "2026-10-04T11:08:53.658Z",           // เวลาที่ run ที่สำเร็จล่าสุดเสร็จ
            "sources": [ { "id": "thelotterytoday", "draws": 146 } ], "expectedWeekdays": [1,3,5] } }
```

## GET `/api/draws`
| param | ค่า | ค่าเริ่มต้น |
|-------|-----|-------------|
| `from`, `to` | `YYYY-MM-DD` (รวมปลายทั้งสอง; `from ≤ to`) | — |
| `limit` | 1–200 | 20 |
| `offset` | 0–1,000,000 | 0 |
| `order` | `asc` \| `desc` | `desc` |

`data`: `{ rows: DrawRecord[], total, limit, offset, order }` — `total` คือจำนวนที่ตรงตัวกรอง (ไม่ใช่เฉพาะหน้านี้)

## GET `/api/analytics`
สถิติเชิงพรรณนาย้อนหลัง
| param | ค่า | ค่าเริ่มต้น |
|-------|-----|-------------|
| `prize` | `2` \| `3` \| `4` (ประเภทผลรางวัล: เลข 2/3/4 ตัว) | `2` |
| `from`, `to` | วันที่ | — |
| `last` | `all` หรือ 1–5000 (ใช้ N งวดล่าสุด *หลัง* กรองวันที่) | all |
| `movingWindow` | 2–60 | 10 |

`data` (ย่อ):
```jsonc
{ "selection": { "prize": "2", "digits": 2, "drawCount": 50, "firstDate": "…", "lastDate": "…", "last": 50, "from": null, "to": null },
  "frequency": { "total": 50, "possible": 100, "distinct": 40, "entries": [ { "value": "77", "count": 4, "share": 0.08 } ],
                 "mostFrequent": [], "leastFrequent": [], "unobserved": ["00","01"], "grid": [/* 100 counts */] },
  "digitDistribution": { "positions": [ { "label": "หลักสิบ", "counts": [/*10*/], "shares": [], "total": 50,
                                          "chiSquare": { "statistic": 7.2, "df": 9, "pValue": 0.62, "approximationValid": true } } ],
                         "overall": { "counts": [], "shares": [], "total": 100 } },
  "repeats": { "consecutive": { "count": 1, "opportunities": 49, "rate": 0.02, "expectedRate": 0.01, "examples": [] },
               "repeatedValues": [], "distinctRepeated": 7, "doubleDigits": { "count": 4, "share": 0.08, "expectedShare": 0.1 },
               "gaps": { "count": 8, "min": 2, "median": 9, "mean": 11.4, "max": 30 } },
  "differences": { "series": [ { "date": "…", "value": 93, "diff": 12, "absDiff": 12 } ], "summary": { "meanAbs": 31.5, "…": 0 }, "histogram": [] },
  "windows": [ { "size": 10, "complete": true, "count": 10, "from": "…", "to": "…", "distinct": 10, "top": [], "positions": [] } ],   // 10, 20, 50, 100
  "moving": { "window": 10, "positions": [ { "label": "หลักสิบ", "points": [ { "date": "…", "d0": 0.1, "d1": 0.0, "…": 0 } ] } ] },
  "histogram": [ { "label": "0–9", "from": 0, "to": 9, "count": 5, "expected": 5 } ],
  "trend": [ { "date": "…", "value": 93, "movingAverage": 41.2 } ] }
```
`meta.empty = true` เมื่อไม่มีข้อมูลตรงตัวกรอง (ยังตอบ 200 พร้อมโครงสร้างว่าง)

## GET `/api/health`
รายงาน Data Health: `status` (`healthy`|`warning`|`critical`|`empty`), `reasons[]`, `totals` (records, วันแรก/ล่าสุด, records ที่ติดธง conflict, แยกตาม source), `schedule` (`expectedDraws`, `presentDraws`, `missingCount`, `coveragePercent`, `missing[{date, reason}]`, `overdue[]`), `issues` (`distinct`, `abnormalRecords`, `duplicateRows`, `invalidDate`, `invalidNumberFormat`, `derivedMismatch`, `sourceConflict`, `quarantined`, `recent[]`), `freshness`, `runs[]`

## GET `/api/sources`
แหล่งข้อมูลที่ตั้งค่า: `id`, `type`, `enabled`, `priority`, `host` (เฉพาะ host — ไม่รวม path/query), `expectedWeekdays`, `requiresApiKey` (boolean — ไม่เปิดเผยชื่อ/ค่า), และ `lastRun` (สถานะ, เวลา, `errorCode`, ตัวนับ)

## GET `/api/ingest/runs?limit=20`
ประวัติ `IngestionRun` ล่าสุด (1–100)

## GET `/api/forecast/backtest` (ทดลอง)
ผลประเมินโมเดลแบบ walk-forward เทียบกับการสุ่ม — มีเฉพาะคะแนนและความไม่แน่นอน **ไม่คืนตัวเลขสำหรับงวดที่ยังไม่ออก** (ส่วนนั้นอยู่ที่ `/api/forecast/next-draw`)
| param | ค่า | ค่าเริ่มต้น |
|-------|-----|-------------|
| `target` | `all` \| `last2` \| `tens` \| `units` | `all` |
| `minTrain` | 30–200 (จำนวนงวดฝึกเริ่มต้น) | 50 |
| `window` | `expanding` หรือ 20–500 (rolling) | `expanding` |
| `last` | `all` หรือ N | all |

`data` (ย่อ):
```jsonc
{ "status": "ok",                       // หรือ "insufficient_data" พร้อม "message" และ targets: []
  "dataRange": { "from": "…", "to": "…", "draws": 146 },
  "config": { "minTrain": 50, "trainWindow": null, "refitEvery": 5, "alpha": 0.05, "minTestSteps": 30, … },
  "targets": [ { "target": "tens", "classes": 10, "testSteps": 96,
                 "baseline": { "accuracy": 0.1, "logLoss": 2.3026, "mae": 3.29 },
                 "models": [ { "modelId": "markov1", "status": "ok", "nTest": 96,
                               "accuracy": 0.073, "accuracyCI": [0.036, 0.143], "accuracyPValue": 0.9, "accuracyAdjustedPValue": 1,
                               "logLoss": 2.58, "logLossAdvantage": -0.277, "logLossAdvantageCI": [-0.40, -0.13],
                               "logLossPValue": 1, "logLossAdjustedPValue": 1, "mae": 3.4, "maeAdvantage": -0.1,
                               "rankHits": [ { "n": 3, "hits": 27, "rate": 0.281, "expected": 0.3, "ci": [0.2, 0.38] } ],  // ผลจริงอยู่ใน Top-n ของโมเดลกี่ครั้ง (เชิงอธิบาย ไม่ปรับหลายการทดสอบ)
                               "verdict": "worse_than_random",   // insufficient_data | no_evidence | worse_than_random | evidence_better_than_random | reference
                               "series": { "cumulativeLogLossAdvantage": [ {"date":"…","value":-0.1} ], "rollingMae": [ {"date":"…","model":3.1,"baseline":3.3} ] },
                               "errorHistogram": [ { "label": "0", "model": 0.1, "expectedRandom": 0.1 } ] } ] } ],
  "multipleComparisons": { "method": "Holm-Bonferroni", "testsCount": 20, "alpha": 0.05, "expectedFalsePositivesUncorrected": 1 },
  "conclusion": { "evidenceCount": 0, "testsCount": 20, "summary": "…" },
  "limitations": ["…"], "disclaimer": "…" }
```
ผลถูก cache ในหน่วยความจำตามเวอร์ชันข้อมูล (hash ของผลทุกงวด + พารามิเตอร์)

## GET `/api/forecast/next-draw` (ทดลอง)
**ผลลัพธ์ของโมเดลทดลอง ไม่ใช่คำแนะนำให้ซื้อ/เดิมพัน และไม่รับประกันผล** — อันดับของแต่ละค่าสำหรับงวดถัดไป ต่อโมเดล โดยทุกโมเดลแนบ `verdict` จาก backtest เดียวกัน (ใช้ cache ร่วมกับ `/api/forecast/backtest`)
| param | ค่า | ค่าเริ่มต้น |
|-------|-----|-------------|
| `target`, `minTrain`, `window`, `last` | เหมือน `/api/forecast/backtest` | |
| `top` | 1–100 (จำนวนอันดับต่อโมเดลที่ตัดมาแสดง) | 10 |

`data` (ย่อ):
```jsonc
{ "status": "ok",            // หรือ "insufficient_data" → "nextDraw": null พร้อม "message"
  "dataRange": { … }, "conclusion": { … },
  "nextDraw": {
    "basedOnDraws": 146, "latestDrawDate": "2026-10-02",
    "nextScheduledDate": "2026-10-05",      // วันออกรางวัลถัดไปตามตาราง (expectedWeekdays ใน config)
    "scheduledDatePassed": true,            // true = ข้อมูลอาจล้าสมัย ควรรัน ingest ก่อน
    "bootstrapResamples": 200, "notes": ["…"],
    "targets": [ { "target": "tens", "classes": 10, "shortlistSize": 3,
                   "recommendedModelId": "frequency",     // โมเดลที่ Δ log-loss ย้อนหลังสูงสุดในกลุ่มที่มีข้อมูลเพียงพอ (null ถ้าไม่มี)
                   "selectionRule": "…",
                   "models": [ { "modelId": "frequency", "status": "ok",     // หรือ "insufficient_data" + "reason", ranking: []
                                 "verdict": "no_evidence", "logLossAdvantage": 0.023,   // ของโมเดล+เป้าหมายเดียวกันใน backtest
                                 "bootstrapResamples": 200, "distanceFromUniform": 0.118,  // total-variation จากการสุ่ม (0 = แยกไม่ออก)
                                 "ranking": [ { "rank": 1, "tied": false, "value": 7, "label": "7",
                                                "probability": 0.1474, "vsRandom": 1.47,       // เทียบ 1/K
                                                "interval": [0.09, 0.21],                       // 5–95% จาก block bootstrap
                                                "shortlistShare": 0.84 } ] } ] } ] } }
```
`rank` เป็น competition rank (1,2,2,4…) — ค่าที่ความน่าจะเป็นเท่ากันมี `tied: true` และเรียงตามค่าตัวเลขเท่านั้น · `verdict` ∈ `insufficient_data | no_evidence | worse_than_random | evidence_better_than_random` — ถ้าไม่ใช่ `evidence_better_than_random` อันดับนั้นไม่ต่างจากการเลือกเลขแบบสุ่มทางสถิติ และแม้จะผ่านเกณฑ์ก็ไม่รับประกันผลของงวดถัดไป

## POST `/api/ingest`
สั่งดึงข้อมูลใหม่ (ปิดไว้จนกว่าจะตั้ง `INGEST_TOKEN`)
```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $INGEST_TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"thelotterytoday","full":false,"maxPages":2}'
```
Body (ทุกฟิลด์ไม่บังคับ; ฟิลด์ที่ไม่รู้จักถูกปฏิเสธ): `source` (id ใน config), `full` (boolean — ดึงทุกหน้า), `maxPages` (1–100; ค่าเริ่มต้น 2 หรือทุกหน้าเมื่อ `full`)
```jsonc
{ "data": { "outcomes": [ { "sourceId": "thelotterytoday", "runId": 7, "status": "SUCCESS",   // SUCCESS | PARTIAL | FAILED
            "errorCode": null, "errorMessage": null, "pagesFetched": 2, "recordsParsed": 20, "recordsValid": 20,
            "inserted": 0, "updated": 0, "unchanged": 20, "quarantined": 0, "invalid": 0, "duplicates": 0, "conflicts": 0 } ] } }
```
แหล่งข้อมูลล่มไม่ใช่ HTTP error: ตอบ 200 พร้อม `status: "FAILED"` และ `errorCode` (`SOURCE_UNAVAILABLE`, `ROBOTS_DISALLOWED`, `EMPTY_RESPONSE`, `LAYOUT_CHANGED`, `PARSE_ERROR`, `NO_VALID_RECORDS`, `CONFIG_ERROR`, `UNEXPECTED`)

ทุก endpoint (ยกเว้น POST) เป็นแบบอ่านอย่างเดียว เปิดสาธารณะได้
