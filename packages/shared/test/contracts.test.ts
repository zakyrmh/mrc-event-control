import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  apiErrorEnvelopeSchema,
  categoryInputSchema,
  commandReceiptSchema,
  matchPhaseSchema,
  matchScheduleInputSchema,
  matchStatusSchema,
  paginationQuerySchema,
  teamInputSchema,
  userRoleSchema,
} from '../src/browser.js'

const categoryId = '4d9fc542-9b86-4fec-aadd-ea74fce90d56'
const teamAId = 'ff543b22-954d-492b-8e5f-bad12936f53c'
const teamBId = '26642988-f4c8-4811-813d-eb191475ae37'

describe('shared DTO contracts', () => {
  it('matches the complete match status and phase state-machine enums', () => {
    const matchStatuses = [
      'SCHEDULED',
      'PREPARING',
      'IN_PROGRESS',
      'PAUSED',
      'POSTPONED',
      'COMPLETED',
      'CORRECTION_PENDING',
      'CANCELLED',
    ]
    const matchPhases = [
      'PRE_MATCH',
      'CALLING',
      'VERIFICATION',
      'WARMUP',
      'READY',
      'COMPETITION',
      'INTERMISSION',
      'RESULT',
      'FINISHED',
    ]

    assert.deepEqual(matchStatusSchema.options, matchStatuses)
    assert.deepEqual(matchPhaseSchema.options, matchPhases)
    assert.equal(matchStatusSchema.safeParse('ACTIVE').success, false)
  })

  it('accepts valid Feature 001 inputs', () => {
    assert.equal(userRoleSchema.parse('OPERATOR'), 'OPERATOR')
    assert.deepEqual(categoryInputSchema.parse({
      code: 'LF-JUNIOR',
      label: 'Line Follower Digital Junior',
      enabled: true,
    }), {
      code: 'LF-JUNIOR',
      label: 'Line Follower Digital Junior',
      enabled: true,
    })
    assert.equal(teamInputSchema.parse({
      categoryId,
      code: 'A_01',
      name: 'Tim A',
      institution: null,
      groupId: null,
    }).code, 'A_01')
  })

  it('rejects malformed and unknown fields', () => {
    assert.equal(userRoleSchema.safeParse('ADMIN').success, false)
    assert.equal(categoryInputSchema.safeParse({
      code: 'kode dengan spasi',
      label: '',
      enabled: true,
      passwordHash: 'must-not-cross-the-boundary',
    }).success, false)
    assert.equal(teamInputSchema.safeParse({
      categoryId: 'not-a-uuid',
      code: 'A',
      name: 'Tim A',
    }).success, false)
  })

  it('rejects a schedule with the same team on both sides', () => {
    const parsed = matchScheduleInputSchema.safeParse({
      categoryId,
      sequence: 1,
      teamAId,
      teamBId: teamAId,
    })

    assert.equal(parsed.success, false)
    assert.deepEqual(parsed.error?.issues[0]?.path, ['teamBId'])
  })

  it('accepts distinct teams and an ISO-8601 UTC schedule', () => {
    assert.equal(matchScheduleInputSchema.safeParse({
      categoryId,
      scheduledAt: '2026-10-31T02:00:00.000Z',
      sequence: 1,
      teamAId,
      teamBId,
    }).success, true)
  })

  it('bounds and normalizes pagination input', () => {
    assert.deepEqual(paginationQuerySchema.parse({}), { limit: 50 })
    assert.deepEqual(paginationQuerySchema.parse({ limit: '200' }), { limit: 200 })
    assert.equal(paginationQuerySchema.safeParse({ limit: 201 }).success, false)
  })

  it('validates error envelopes without leaking arbitrary details', () => {
    assert.equal(apiErrorEnvelopeSchema.safeParse({
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Data berubah di perangkat lain.',
        requestId: 'req-01',
        currentMatchVersion: 14,
        retryable: false,
      },
    }).success, true)
    assert.equal(apiErrorEnvelopeSchema.safeParse({
      error: {
        code: 'VERSION_CONFLICT',
        message: 'SQL stack trace',
        requestId: 'req-01',
        retryable: false,
        stack: 'secret internals',
      },
    }).success, false)
    assert.equal(apiErrorEnvelopeSchema.safeParse({
      error: {
        code: 'MADE_UP_ERROR',
        message: 'Unknown contract code',
        requestId: 'req-02',
        retryable: false,
      },
    }).success, false)
  })

  it('rejects malformed command receipts', () => {
    assert.equal(commandReceiptSchema.safeParse({
      commandId: 'cmd-01',
      replayed: false,
      committedAt: 'not-a-date',
      result: {},
      snapshotUrl: '/admin/secrets',
    }).success, false)
  })
})
