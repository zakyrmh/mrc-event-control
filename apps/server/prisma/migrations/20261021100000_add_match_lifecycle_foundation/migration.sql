-- Migration 20261021100000_add_match_lifecycle_foundation

ALTER TABLE "Match" ADD COLUMN "resumePhase" TEXT;
ALTER TABLE "Match" ADD COLUMN "currentSegmentId" TEXT;
ALTER TABLE "Match" ADD COLUMN "teamASnapshotJson" TEXT;
ALTER TABLE "Match" ADD COLUMN "teamBSnapshotJson" TEXT;

CREATE TABLE "ArenaState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activeMatchId" TEXT UNIQUE,
  "arenaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("arenaVersion" > 0),
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ArenaState_activeMatchId_fkey" FOREIGN KEY ("activeMatchId") REFERENCES "Match" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "MatchParticipant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "matchId" TEXT NOT NULL,
  "side" TEXT NOT NULL CHECK ("side" IN ('A', 'B')),
  "teamId" TEXT NOT NULL,
  "attendance" TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK ("attendance" IN ('UNKNOWN', 'PRESENT', 'ABSENT')),
  "verification" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("verification" IN ('PENDING', 'READY', 'NOT_READY', 'FAILED')),
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MatchParticipant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  UNIQUE ("matchId", "side")
);

CREATE INDEX "MatchParticipant_matchId_idx" ON "MatchParticipant"("matchId");
CREATE INDEX "MatchParticipant_teamId_idx" ON "MatchParticipant"("teamId");

CREATE TABLE "SegmentAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "matchId" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('START', 'ROUND', 'HALF')),
  "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
  "attempt" INTEGER NOT NULL CHECK ("attempt" > 0),
  "supersedesAttemptId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PREPARED' CHECK ("status" IN ('PREPARED', 'ACTIVE', 'ENDED', 'REPLACED')),
  "activatedAt" DATETIME,
  "startedAt" DATETIME,
  "endedAt" DATETIME,
  "durationMs" INTEGER,
  "reason" TEXT,
  "actorId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SegmentAttempt_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("matchId", "ordinal", "attempt")
);

CREATE INDEX "SegmentAttempt_matchId_idx" ON "SegmentAttempt"("matchId");

CREATE TABLE "GoalEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "matchId" TEXT NOT NULL,
  "segmentAttemptId" TEXT NOT NULL,
  "side" TEXT NOT NULL CHECK ("side" IN ('A', 'B')),
  "delta" INTEGER NOT NULL CHECK ("delta" IN (1, -1)),
  "occurredAtMs" INTEGER,
  "reason" TEXT,
  "actorId" TEXT,
  "commandId" TEXT,
  "goalIntentId" TEXT,
  "correctsGoalId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoalEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalEvent_segmentAttemptId_fkey" FOREIGN KEY ("segmentAttemptId") REFERENCES "SegmentAttempt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GoalEvent_correctsGoalId_fkey" FOREIGN KEY ("correctsGoalId") REFERENCES "GoalEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "GoalEvent_matchId_idx" ON "GoalEvent"("matchId");
CREATE INDEX "GoalEvent_segmentAttemptId_idx" ON "GoalEvent"("segmentAttemptId");

CREATE TABLE "ResultRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "matchId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "status" TEXT NOT NULL CHECK ("status" IN ('DRAFT', 'FINAL', 'SUPERSEDED')),
  "decisionText" TEXT,
  "winnerTeamId" TEXT,
  "finalGoalsA" INTEGER CHECK ("finalGoalsA" IS NULL OR "finalGoalsA" >= 0),
  "finalGoalsB" INTEGER CHECK ("finalGoalsB" IS NULL OR "finalGoalsB" >= 0),
  "refereeReference" TEXT,
  "authorityReference" TEXT,
  "reason" TEXT,
  "finalizedBy" TEXT,
  "finalizedAt" DATETIME,
  "previousRevisionId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResultRevision_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("matchId", "revision")
);

CREATE INDEX "ResultRevision_matchId_idx" ON "ResultRevision"("matchId");
