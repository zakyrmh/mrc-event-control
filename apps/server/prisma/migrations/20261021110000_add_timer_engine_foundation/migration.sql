-- Migration 20261021110000_add_timer_engine_foundation

CREATE TABLE "TimerConfig" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "phaseType" TEXT NOT NULL CHECK ("phaseType" IN ('CALLING', 'WARMUP', 'COMPETITION', 'INTERMISSION')),
  "stageLabel" TEXT,
  "initialMs" INTEGER CHECK ("initialMs" IS NULL OR "initialMs" > 0),
  "approvedBy" TEXT,
  "sourceNote" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TimerConfig_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("categoryId", "phaseType")
);

CREATE INDEX "TimerConfig_categoryId_idx" ON "TimerConfig"("categoryId");

CREATE TABLE "TimerInstance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "matchId" TEXT NOT NULL,
  "segmentAttemptId" TEXT,
  "type" TEXT NOT NULL CHECK ("type" IN ('CALLING', 'WARMUP', 'COMPETITION', 'INTERMISSION')),
  "state" TEXT NOT NULL DEFAULT 'IDLE' CHECK ("state" IN ('IDLE', 'RUNNING', 'PAUSED', 'STOPPED', 'EXPIRED', 'RECOVERY_REQUIRED')),
  "initialMs" INTEGER NOT NULL CHECK ("initialMs" > 0),
  "remainingAtAnchorMs" INTEGER NOT NULL CHECK ("remainingAtAnchorMs" >= 0),
  "anchorWallUtc" DATETIME,
  "checkpointWallUtc" DATETIME,
  "runtimeId" TEXT NOT NULL,
  "checkpointSeq" INTEGER NOT NULL DEFAULT 1 CHECK ("checkpointSeq" > 0),
  "timerGeneration" INTEGER NOT NULL DEFAULT 1 CHECK ("timerGeneration" > 0),
  "storageHealth" TEXT NOT NULL DEFAULT 'HEALTHY' CHECK ("storageHealth" IN ('HEALTHY', 'DEGRADED', 'RECOVERY_PENDING')),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TimerInstance_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TimerInstance_segmentAttemptId_fkey" FOREIGN KEY ("segmentAttemptId") REFERENCES "SegmentAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "TimerInstance_matchId_idx" ON "TimerInstance"("matchId");
CREATE INDEX "TimerInstance_segmentAttemptId_idx" ON "TimerInstance"("segmentAttemptId");
CREATE INDEX "TimerInstance_state_idx" ON "TimerInstance"("state");
