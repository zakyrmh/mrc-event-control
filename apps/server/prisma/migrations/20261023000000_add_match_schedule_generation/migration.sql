-- Migration 20261023000000_add_match_schedule_generation
-- Adds stage/tie/ronde tracking for generated group-stage schedules plus
-- per-category tie configuration and generation batch bookkeeping.

ALTER TABLE "Match" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'GROUP';
ALTER TABLE "Match" ADD COLUMN "tieId" TEXT;
ALTER TABLE "Match" ADD COLUMN "rondeNumber" INTEGER;
ALTER TABLE "Match" ADD COLUMN "generationBatchId" TEXT;
ALTER TABLE "Match" ADD COLUMN "bracketSlot" TEXT;

CREATE TABLE "TieConfig" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "rondeCount" INTEGER NOT NULL CHECK ("rondeCount" > 0),
  "approvedBy" TEXT,
  "sourceNote" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TieConfig_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("stage" IN ('GROUP', 'KNOCKOUT', 'FINAL'))
);

CREATE TABLE "MatchGenerationBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "rondeCount" INTEGER NOT NULL CHECK ("rondeCount" > 0),
  "stageLabel" TEXT,
  "createdCount" INTEGER NOT NULL,
  "actorId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolledBackAt" DATETIME
);

CREATE UNIQUE INDEX "TieConfig_categoryId_stage_key" ON "TieConfig"("categoryId", "stage");
CREATE INDEX "TieConfig_categoryId_idx" ON "TieConfig"("categoryId");

CREATE INDEX "MatchGenerationBatch_categoryId_idx" ON "MatchGenerationBatch"("categoryId");
CREATE INDEX "MatchGenerationBatch_rolledBackAt_idx" ON "MatchGenerationBatch"("rolledBackAt");

CREATE INDEX "Match_generationBatchId_idx" ON "Match"("generationBatchId");

-- One sequence number per category keeps operator ordering unambiguous.
CREATE UNIQUE INDEX "Match_categoryId_sequence_key" ON "Match"("categoryId", "sequence");

-- A tie can only have one match per ronde. Manual matches leave tieId NULL,
-- and SQLite permits repeated NULLs in a unique index.
CREATE UNIQUE INDEX "Match_tieId_rondeNumber_key" ON "Match"("tieId", "rondeNumber");
