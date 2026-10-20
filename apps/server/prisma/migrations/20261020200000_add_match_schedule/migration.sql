-- Migration 20261020200000_add_match_schedule
CREATE TABLE "Match" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "groupId" TEXT,
  "stageLabel" TEXT,
  "scheduledAt" DATETIME,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "teamAId" TEXT NOT NULL,
  "teamBId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK ("status" IN ('SCHEDULED', 'PREPARING', 'IN_PROGRESS', 'PAUSED', 'POSTPONED', 'COMPLETED', 'CORRECTION_PENDING', 'CANCELLED', 'WARMUP', 'READY', 'RUNNING', 'ABORTED')),
  "phase" TEXT,
  "matchVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("matchVersion" > 0),
  "hasStarted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Match_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Match_groupId_categoryId_fkey" FOREIGN KEY ("groupId", "categoryId") REFERENCES "Group" ("id", "categoryId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Match_teamAId_categoryId_fkey" FOREIGN KEY ("teamAId", "categoryId") REFERENCES "Team" ("id", "categoryId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Match_teamBId_categoryId_fkey" FOREIGN KEY ("teamBId", "categoryId") REFERENCES "Team" ("id", "categoryId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("teamAId" <> "teamBId")
);

CREATE INDEX "Match_categoryId_idx" ON "Match"("categoryId");
CREATE INDEX "Match_groupId_idx" ON "Match"("groupId");
CREATE INDEX "Match_teamAId_idx" ON "Match"("teamAId");
CREATE INDEX "Match_teamBId_idx" ON "Match"("teamBId");
CREATE INDEX "Match_status_idx" ON "Match"("status");
CREATE INDEX "Match_sequence_idx" ON "Match"("sequence");
