import { z } from 'zod'

import { matchPhaseSchema, matchStatusSchema } from './enums.js'
import {
  idSchema,
  nonBlankStringSchema,
  nullableOptionalString,
  revisionSchema,
  utcDateTimeSchema,
} from './primitives.js'

const codeSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)
const nameSchema = nonBlankStringSchema.max(160)

export const categoryInputSchema = z.strictObject({
  code: codeSchema,
  label: nameSchema,
  enabled: z.boolean(),
})
export type CategoryInput = z.infer<typeof categoryInputSchema>

export const categorySchema = categoryInputSchema.extend({
  id: idSchema,
  revision: revisionSchema,
})
export type Category = z.infer<typeof categorySchema>

export const groupInputSchema = z.strictObject({
  categoryId: idSchema,
  name: nameSchema,
})
export type GroupInput = z.infer<typeof groupInputSchema>

export const groupSchema = groupInputSchema.extend({
  id: idSchema,
  revision: revisionSchema,
})
export type Group = z.infer<typeof groupSchema>

export const teamInputSchema = z.strictObject({
  categoryId: idSchema,
  code: codeSchema,
  name: nameSchema,
  institution: nullableOptionalString(200),
  groupId: idSchema.nullable().optional(),
})
export type TeamInput = z.infer<typeof teamInputSchema>

export const teamSchema = teamInputSchema.extend({
  id: idSchema,
  archived: z.boolean(),
  revision: revisionSchema,
})
export type Team = z.infer<typeof teamSchema>

export const matchScheduleInputSchema = z
  .strictObject({
    categoryId: idSchema,
    groupId: idSchema.nullable().optional(),
    stageLabel: nullableOptionalString(120),
    scheduledAt: utcDateTimeSchema.nullable().optional(),
    sequence: z.int().positive(),
    teamAId: idSchema,
    teamBId: idSchema,
  })
  .refine(({ teamAId, teamBId }) => teamAId !== teamBId, {
    message: 'Tim A dan Tim B harus berbeda',
    path: ['teamBId'],
  })
export type MatchScheduleInput = z.infer<typeof matchScheduleInputSchema>

export const matchScheduleSchema = matchScheduleInputSchema.extend({
  id: idSchema,
  status: matchStatusSchema,
  phase: matchPhaseSchema.nullable(),
  matchVersion: revisionSchema,
})
export type MatchSchedule = z.infer<typeof matchScheduleSchema>

export const expectedRevisionSchema = z.strictObject({
  expectedRevision: revisionSchema,
})
export type ExpectedRevision = z.infer<typeof expectedRevisionSchema>

export const commandEnvelopeSchema = z.strictObject({
  expectedRuntimeId: nonBlankStringSchema,
  expectedMatchVersion: revisionSchema.optional(),
  expectedArenaVersion: revisionSchema.optional(),
})
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>

export const commandReceiptSchema = z.strictObject({
  commandId: idSchema,
  replayed: z.boolean(),
  committedAt: utcDateTimeSchema,
  result: z.record(z.string(), z.unknown()),
  snapshotUrl: z.string().startsWith('/api/v1/'),
})
export type CommandReceipt = z.infer<typeof commandReceiptSchema>

export const teamImportPreviewInputSchema = z.strictObject({
  csvContent: z.string().min(1).max(5 * 1024 * 1024),
  expectedRevision: revisionSchema,
})
export type TeamImportPreviewInput = z.infer<typeof teamImportPreviewInputSchema>

export const teamImportCommitInputSchema = z.strictObject({
  previewHash: nonBlankStringSchema,
  expectedRevision: revisionSchema,
})
export type TeamImportCommitInput = z.infer<typeof teamImportCommitInputSchema>

export const categoryPatchInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  label: nameSchema.optional(),
  enabled: z.boolean().optional(),
})
export type CategoryPatchInput = z.infer<typeof categoryPatchInputSchema>

export const groupPatchInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  name: nameSchema.optional(),
  enabled: z.boolean().optional(),
})
export type GroupPatchInput = z.infer<typeof groupPatchInputSchema>

export const teamPatchInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  name: nameSchema.optional(),
  institution: nullableOptionalString(200),
  groupId: idSchema.nullable().optional(),
  archived: z.boolean().optional(),
})
export type TeamPatchInput = z.infer<typeof teamPatchInputSchema>

export const matchSchedulePatchInputSchema = z.strictObject({
  expectedMatchVersion: revisionSchema,
  stageLabel: nullableOptionalString(120),
  scheduledAt: utcDateTimeSchema.nullable().optional(),
  sequence: z.int().positive().optional(),
  teamAId: idSchema.optional(),
  teamBId: idSchema.optional(),
})
export type MatchSchedulePatchInput = z.infer<typeof matchSchedulePatchInputSchema>

// --- Public Broadcast & Overlay Projections (004 OB-01 s/d OB-04) ---
export const broadcastModeSchema = z.enum(['AUTO', 'WAITING', 'EMERGENCY'])
export type BroadcastMode = z.infer<typeof broadcastModeSchema>

export const publicTeamProjectionSchema = z.strictObject({
  id: idSchema,
  code: codeSchema,
  name: nameSchema,
  institution: nullableOptionalString(200),
})
export type PublicTeamProjection = z.infer<typeof publicTeamProjectionSchema>

export const publicTimerProjectionSchema = z.strictObject({
  timerId: idSchema.nullable(),
  state: z.enum(['IDLE', 'RUNNING', 'PAUSED', 'STOPPED', 'EXPIRED', 'RECOVERY_REQUIRED']),
  initialMs: z.int().nonnegative(),
  remainingMs: z.int().nonnegative(),
  serverNowUtc: utcDateTimeSchema,
  anchorWallUtc: utcDateTimeSchema.nullable(),
  timerGeneration: z.int().nonnegative(),
  syncSeq: z.int().nonnegative(),
})
export type PublicTimerProjection = z.infer<typeof publicTimerProjectionSchema>

export const publicMatchProjectionSchema = z.strictObject({
  matchId: idSchema,
  sequence: z.int().positive(),
  stageLabel: nullableOptionalString(120),
  category: z.strictObject({
    code: codeSchema,
    label: nameSchema,
  }),
  displayMode: nonBlankStringSchema,
  phase: matchPhaseSchema.nullable(),
  status: matchStatusSchema,
  teamA: publicTeamProjectionSchema,
  teamB: publicTeamProjectionSchema,
  scoreA: z.int().nonnegative().nullable(),
  scoreB: z.int().nonnegative().nullable(),
  currentSegment: z
    .strictObject({
      kind: z.string(),
      ordinal: z.int().positive(),
      attempt: z.int().positive(),
    })
    .nullable(),
  timer: publicTimerProjectionSchema,
  officialWinnerSide: z.enum(['A', 'B', 'DRAW']).nullable(),
  isOfficialResult: z.boolean(),
})
export type PublicMatchProjection = z.infer<typeof publicMatchProjectionSchema>

export const publicBroadcastSnapshotSchema = z.strictObject({
  runtimeId: nonBlankStringSchema,
  broadcastRevision: revisionSchema,
  arenaVersion: revisionSchema,
  mode: broadcastModeSchema,
  safeDisplay: z.boolean(),
  match: publicMatchProjectionSchema.nullable(),
  serverNowUtc: utcDateTimeSchema,
})
export type PublicBroadcastSnapshot = z.infer<typeof publicBroadcastSnapshotSchema>

export const obsTelemetryInputSchema = z.strictObject({
  clientInstanceId: nonBlankStringSchema,
  clientRole: z.enum(['OBS_BROWSER_SOURCE', 'DASHBOARD_PREVIEW']),
  runtimeId: nonBlankStringSchema,
  lastReceivedRevision: revisionSchema,
  lastRenderedRevision: revisionSchema,
  timerGeneration: z.int().nonnegative().optional(),
  syncSeq: z.int().nonnegative().optional(),
  renderLatencyMs: z.number().nonnegative().optional(),
})
export type ObsTelemetryInput = z.infer<typeof obsTelemetryInputSchema>

