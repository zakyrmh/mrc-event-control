-- Migration 20261021120000_add_goal_intent

CREATE TABLE "GoalIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "matchId" TEXT NOT NULL,
  "segmentAttemptId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY' CHECK ("status" IN ('READY', 'CONSUMED', 'INVALIDATED')),
  "consumedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "GoalIntent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalIntent_segmentAttemptId_fkey" FOREIGN KEY ("segmentAttemptId") REFERENCES "SegmentAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GoalIntent_matchId_status_idx" ON "GoalIntent"("matchId", "status");
CREATE INDEX "GoalIntent_segmentAttemptId_idx" ON "GoalIntent"("segmentAttemptId");

ALTER TABLE "GoalEvent" ADD COLUMN "logicalGoalId" TEXT;
ALTER TABLE "GoalEvent" ADD COLUMN "correctionGroupId" TEXT;

CREATE UNIQUE INDEX "GoalEvent_goalIntentId_unique" ON "GoalEvent"("goalIntentId") WHERE "goalIntentId" IS NOT NULL;
CREATE INDEX "GoalEvent_logicalGoalId_idx" ON "GoalEvent"("logicalGoalId");
