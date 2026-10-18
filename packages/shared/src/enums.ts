import { z } from 'zod'

export const userRoleSchema = z.enum(['SUPER_ADMIN', 'OPERATOR'])
export type UserRole = z.infer<typeof userRoleSchema>

export const matchStatusSchema = z.enum([
  'SCHEDULED',
  'PREPARING',
  'IN_PROGRESS',
  'PAUSED',
  'POSTPONED',
  'COMPLETED',
  'CORRECTION_PENDING',
  'CANCELLED',
])
export type MatchStatus = z.infer<typeof matchStatusSchema>

export const matchPhaseSchema = z.enum([
  'PRE_MATCH',
  'CALLING',
  'VERIFICATION',
  'WARMUP',
  'READY',
  'COMPETITION',
  'INTERMISSION',
  'RESULT',
  'FINISHED',
])
export type MatchPhase = z.infer<typeof matchPhaseSchema>

export const teamSideSchema = z.enum(['A', 'B'])
export type TeamSide = z.infer<typeof teamSideSchema>

export const errorCodeSchema = z.enum([
  'INVALID_INPUT',
  'DURATION_UNCONFIRMED',
  'SESSION_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'INVALID_TRANSITION',
  'ARENA_BUSY',
  'RESULT_LOCKED',
  'KEY_REUSED',
  'RUNTIME_CHANGED',
  'REVIEW_STALE',
  'GOAL_INTENT_CONSUMED',
  'GOAL_REVISION_CONFLICT',
  'INTENT_CONSUMED',
  'AUTHORITY_UNCONFIRMED',
  'IMPORT_TOO_LARGE',
  'STORAGE_DEGRADED',
  'STORAGE_UNAVAILABLE',
  'STORAGE_FULL',
  'INTERNAL_ERROR',
])
export type ErrorCode = z.infer<typeof errorCodeSchema>
