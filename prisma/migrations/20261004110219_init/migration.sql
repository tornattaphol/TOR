-- CreateEnum
CREATE TYPE "IssueKind" AS ENUM ('DUPLICATE_IN_SOURCE', 'INVALID_DATE', 'INVALID_NUMBER_FORMAT', 'DERIVED_DIGIT_MISMATCH', 'UNEXPECTED_WEEKDAY', 'FUTURE_DATE', 'MISSING_FIELD', 'SOURCE_CONFLICT');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "draws" (
    "id" SERIAL NOT NULL,
    "lottery_code" TEXT NOT NULL DEFAULT 'LAO_DEV',
    "draw_date" DATE NOT NULL,
    "draw_id" TEXT NOT NULL,
    "result_4_digit" VARCHAR(4),
    "result_3_digit" VARCHAR(3),
    "result_2_digit" VARCHAR(2) NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "source_count" INTEGER NOT NULL DEFAULT 1,
    "has_conflict" BOOLEAN NOT NULL DEFAULT false,
    "extra" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_records" (
    "id" SERIAL NOT NULL,
    "source_id" TEXT NOT NULL,
    "lottery_code" TEXT NOT NULL DEFAULT 'LAO_DEV',
    "draw_date" DATE NOT NULL,
    "draw_id" TEXT NOT NULL,
    "result_4_digit" VARCHAR(4),
    "result_3_digit" VARCHAR(3),
    "result_2_digit" VARCHAR(2) NOT NULL,
    "source_url" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "raw_payload" JSONB,

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_issues" (
    "id" SERIAL NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" "IssueKind" NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "source_id" TEXT NOT NULL,
    "draw_date" DATE,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_id" INTEGER,

    CONSTRAINT "data_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" SERIAL NOT NULL,
    "source_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'cli',
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "pages_fetched" INTEGER NOT NULL DEFAULT 0,
    "records_parsed" INTEGER NOT NULL DEFAULT 0,
    "records_valid" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "quarantined" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "draws_draw_date_idx" ON "draws"("draw_date");

-- CreateIndex
CREATE UNIQUE INDEX "draws_lottery_code_draw_date_key" ON "draws"("lottery_code", "draw_date");

-- CreateIndex
CREATE UNIQUE INDEX "draws_lottery_code_draw_id_key" ON "draws"("lottery_code", "draw_id");

-- CreateIndex
CREATE INDEX "source_records_lottery_code_draw_date_idx" ON "source_records"("lottery_code", "draw_date");

-- CreateIndex
CREATE UNIQUE INDEX "source_records_source_id_lottery_code_draw_date_key" ON "source_records"("source_id", "lottery_code", "draw_date");

-- CreateIndex
CREATE UNIQUE INDEX "data_issues_fingerprint_key" ON "data_issues"("fingerprint");

-- CreateIndex
CREATE INDEX "data_issues_kind_idx" ON "data_issues"("kind");

-- CreateIndex
CREATE INDEX "data_issues_source_id_idx" ON "data_issues"("source_id");

-- CreateIndex
CREATE INDEX "ingestion_runs_source_id_started_at_idx" ON "ingestion_runs"("source_id", "started_at");
