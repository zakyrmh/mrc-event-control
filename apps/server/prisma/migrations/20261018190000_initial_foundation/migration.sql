-- Initial F-04 foundation schema. Apply only to a fresh database or a verified copy.
PRAGMA foreign_keys=OFF;

CREATE TABLE "EventConfig" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventName" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "dataLocation" TEXT NOT NULL,
  "catalogRevision" INTEGER NOT NULL DEFAULT 1 CHECK ("catalogRevision" > 0),
  "storageEpoch" INTEGER NOT NULL DEFAULT 1 CHECK ("storageEpoch" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Category" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Group" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Group_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Team" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "institution" TEXT,
  "archivedAt" DATETIME,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Team_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "GroupMembership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "categoryId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupMembership_groupId_categoryId_fkey" FOREIGN KEY ("groupId", "categoryId") REFERENCES "Group" ("id", "categoryId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GroupMembership_teamId_categoryId_fkey" FOREIGN KEY ("teamId", "categoryId") REFERENCES "Team" ("id", "categoryId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('SUPER_ADMIN', 'OPERATOR')),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sessionHash" TEXT NOT NULL,
  "csrfHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AuditEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "commandId" TEXT,
  "actorId" TEXT,
  "timestampUtc" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT,
  "beforeJson" TEXT,
  "afterJson" TEXT,
  "reason" TEXT,
  "authorityReference" TEXT,
  CONSTRAINT "AuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OperationLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "principalId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "targetId" TEXT,
  "expectedRuntimeId" TEXT,
  "status" TEXT NOT NULL CHECK ("status" IN ('RESERVED', 'SUCCEEDED', 'REJECTED', 'CANCELLED')),
  "terminalCode" TEXT,
  "receiptJson" TEXT,
  "reservedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "terminalAt" DATETIME,
  CHECK (("status" = 'RESERVED' AND "terminalAt" IS NULL) OR ("status" <> 'RESERVED' AND "terminalAt" IS NOT NULL))
);

CREATE TABLE "CommandReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ledgerId" TEXT NOT NULL,
  "responseJson" TEXT NOT NULL,
  "committedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommandReceipt_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "OperationLedger" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "OutboxEvent" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "broadcastRevision" INTEGER NOT NULL CHECK ("broadcastRevision" > 0),
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payloadPublicJson" TEXT NOT NULL,
  "committedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" DATETIME
);

CREATE TABLE "BackupManifest" (
  "backupId" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "schemaVersion" TEXT NOT NULL,
  "appVersion" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL CHECK ("fileSize" >= 0),
  "lastCommittedCommandAt" DATETIME,
  "lastCheckpointAt" DATETIME,
  "backupCutCommandId" TEXT,
  "backupCutCommandAt" DATETIME,
  "eventSessionId" TEXT,
  "eventSessionClosedAt" DATETIME,
  "verifiedAt" DATETIME,
  "copiedToSecondMediaAt" DATETIME,
  "storageEpoch" INTEGER NOT NULL CHECK ("storageEpoch" > 0),
  "restoreLineage" TEXT NOT NULL,
  "verifyStatus" TEXT NOT NULL CHECK ("verifyStatus" IN ('PENDING', 'VERIFIED', 'FAILED'))
);

CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");
CREATE UNIQUE INDEX "Group_categoryId_name_key" ON "Group"("categoryId", "name");
CREATE UNIQUE INDEX "Group_id_categoryId_key" ON "Group"("id", "categoryId");
CREATE INDEX "Group_categoryId_idx" ON "Group"("categoryId");
CREATE UNIQUE INDEX "Team_categoryId_code_key" ON "Team"("categoryId", "code");
CREATE UNIQUE INDEX "Team_id_categoryId_key" ON "Team"("id", "categoryId");
CREATE INDEX "Team_categoryId_idx" ON "Team"("categoryId");
CREATE UNIQUE INDEX "GroupMembership_categoryId_teamId_key" ON "GroupMembership"("categoryId", "teamId");
CREATE UNIQUE INDEX "GroupMembership_groupId_teamId_key" ON "GroupMembership"("groupId", "teamId");
CREATE INDEX "GroupMembership_groupId_idx" ON "GroupMembership"("groupId");
CREATE INDEX "GroupMembership_teamId_idx" ON "GroupMembership"("teamId");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "Session_sessionHash_key" ON "Session"("sessionHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "AuditEntry_commandId_idx" ON "AuditEntry"("commandId");
CREATE INDEX "AuditEntry_actorId_idx" ON "AuditEntry"("actorId");
CREATE INDEX "AuditEntry_resourceType_resourceId_idx" ON "AuditEntry"("resourceType", "resourceId");
CREATE INDEX "AuditEntry_timestampUtc_idx" ON "AuditEntry"("timestampUtc");
CREATE UNIQUE INDEX "OperationLedger_principalId_scope_idempotencyKey_key" ON "OperationLedger"("principalId", "scope", "idempotencyKey");
CREATE INDEX "OperationLedger_status_reservedAt_idx" ON "OperationLedger"("status", "reservedAt");
CREATE UNIQUE INDEX "CommandReceipt_ledgerId_key" ON "CommandReceipt"("ledgerId");
CREATE INDEX "CommandReceipt_committedAt_idx" ON "CommandReceipt"("committedAt");
CREATE UNIQUE INDEX "OutboxEvent_broadcastRevision_key" ON "OutboxEvent"("broadcastRevision");
CREATE INDEX "OutboxEvent_dispatchedAt_committedAt_idx" ON "OutboxEvent"("dispatchedAt", "committedAt");
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

CREATE TRIGGER "AuditEntry_no_update"
BEFORE UPDATE ON "AuditEntry"
BEGIN
  SELECT RAISE(ABORT, 'AuditEntry is append-only');
END;

CREATE TRIGGER "AuditEntry_no_delete"
BEFORE DELETE ON "AuditEntry"
BEGIN
  SELECT RAISE(ABORT, 'AuditEntry is append-only');
END;

PRAGMA foreign_keys=ON;
