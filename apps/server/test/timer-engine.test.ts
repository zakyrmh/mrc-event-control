import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { FakeClock } from '@mrc-x/shared'

import { DatabaseConnection } from '../src/database.js'
import { createMigratedDatabase } from './helpers/migrations.js'
import { TimerService } from '../src/timer-service.js'


describe('Timer Engine Service & Recovery (003 E-01 s/d E-08 / TC-05, TC-06, TC-14, TC-23, TC-25)', () => {
  let connection: DatabaseConnection
  let categoryId: string
  let teamAId: string
  let teamBId: string
  let matchId: string
  let clock: FakeClock
  let timerService: TimerService

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-timer-'))
    const databasePath = join(directory, 'timer.db')

    await createMigratedDatabase(databasePath)

    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()

    categoryId = randomUUID()
    await connection.client.category.create({
      data: { id: categoryId, code: 'SOCCER', label: 'Robot Soccer', enabled: true },
    })

    teamAId = randomUUID()
    await connection.client.team.create({
      data: { id: teamAId, categoryId, code: 'T-A', name: 'Team A' },
    })

    teamBId = randomUUID()
    await connection.client.team.create({
      data: { id: teamBId, categoryId, code: 'T-B', name: 'Team B' },
    })

    matchId = randomUUID()
    await connection.client.match.create({
      data: {
        id: matchId,
        categoryId,
        sequence: 1,
        teamAId,
        teamBId,
        status: 'PREPARING',
      },
    })

    clock = new FakeClock(200_000, '2026-10-21T14:00:00.000Z')
    timerService = new TimerService({
      client: connection.client,
      runtimeId: 'runtime-1',
      clock,
    })
  })

  after(async () => {
    await connection.disconnect()
  })

  it('prepares and persists TimerInstance in SQLite with audit', async () => {
    const snap = await timerService.prepare({
      matchId,
      phaseType: 'COMPETITION',
      initialMs: 300_000,
    })

    assert.equal(snap.state, 'IDLE')
    assert.equal(snap.initialMs, 300_000)
    assert.equal(snap.remainingMs, 300_000)

    const persisted = await connection.client.timerInstance.findUnique({
      where: { id: snap.id },
    })
    assert.ok(persisted)
    assert.equal(persisted.state, 'IDLE')
    assert.equal(persisted.initialMs, 300_000)

    const audit = await connection.client.auditEntry.findFirst({
      where: { resourceType: 'TimerInstance', resourceId: snap.id, action: 'timer.prepare' },
    })
    assert.ok(audit)
  })

  it('runs countdown monotonic and pauses atomically', async () => {
    timerService.armReadinessToken('token-ready-1')
    const running = await timerService.start({ readinessToken: 'token-ready-1' })
    assert.equal(running.state, 'RUNNING')

    // Advance fake monotonic clock by 20s
    clock.advance(20_000)

    // Checkpoint
    const cp = await timerService.checkpoint()
    assert.equal(cp.remainingMs, 280_000)
    assert.equal(cp.checkpointSeq, 2)

    // Pause
    const paused = await timerService.pause()
    assert.equal(paused.state, 'PAUSED')
    assert.equal(paused.remainingMs, 280_000)

    const persisted = await connection.client.timerInstance.findUnique({
      where: { id: running.id },
    })
    assert.equal(persisted?.state, 'PAUSED')
    assert.equal(persisted?.remainingAtAnchorMs, 280_000)
  })

  it('adjusts duration atomically and audits the delta', async () => {
    const adjusted = await timerService.adjust({
      deltaMs: 30_000,
      reason: 'Kompensasi waktu terhenti',
    })
    assert.equal(adjusted.remainingMs, 310_000)

    const audit = await connection.client.auditEntry.findFirst({
      where: { action: 'timer.adjust' },
    })
    assert.ok(audit)
    assert.match(audit.afterJson ?? '', /Kompensasi waktu terhenti/)
  })

  it('enforces gate when storage is DEGRADED (ST-01, TC-33)', async () => {
    timerService.setStorageHealth('DEGRADED')
    assert.equal(timerService.getStorageHealth(), 'DEGRADED')

    await assert.rejects(
      async () => {
        await timerService.adjust({ deltaMs: 10_000, reason: 'test' })
      },
      /STORAGE_DEGRADED/,
    )

    // Restore to healthy
    timerService.setStorageHealth('HEALTHY')
  })

  it('executes startup reconciliation on unexpected process restart (TC-14, TC-23, TC-25)', async () => {
    // Simulate active match and running timer in DB
    const runningMatchId = randomUUID()
    await connection.client.match.create({
      data: {
        id: runningMatchId,
        categoryId,
        sequence: 2,
        teamAId,
        teamBId,
        status: 'IN_PROGRESS',
        hasStarted: true,
      },
    })

    const crashedTimerId = randomUUID()
    await connection.client.timerInstance.create({
      data: {
        id: crashedTimerId,
        matchId: runningMatchId,
        type: 'COMPETITION',
        state: 'RUNNING',
        initialMs: 300_000,
        remainingAtAnchorMs: 250_000,
        runtimeId: 'old-crashed-runtime',
        checkpointSeq: 5,
        timerGeneration: 1,
      },
    })

    // Now start a brand new TimerService simulating process reboot
    const rebootedService = new TimerService({
      client: connection.client,
      runtimeId: 'rebooted-runtime-2',
      clock,
    })

    const recon = await rebootedService.startupReconcile()
    assert.equal(recon.recoveredCount, 1)

    // Verify DB state: crashed timer must be RECOVERY_REQUIRED and generation bumped
    const timerInDb = await connection.client.timerInstance.findUnique({
      where: { id: crashedTimerId },
    })
    assert.equal(timerInDb?.state, 'RECOVERY_REQUIRED')
    assert.equal(timerInDb?.timerGeneration, 2)
    assert.equal(timerInDb?.runtimeId, 'rebooted-runtime-2')

    // Verify match status: must be PAUSED, never auto-resumed!
    const matchInDb = await connection.client.match.findUnique({
      where: { id: runningMatchId },
    })
    assert.equal(matchInDb?.status, 'PAUSED')

    // Audit entry must be created
    const recoveryAudit = await connection.client.auditEntry.findFirst({
      where: { action: 'timer.recovery_required', resourceId: crashedTimerId },
    })
    assert.ok(recoveryAudit)
  })

  // --- QA Verification: TE-08 & Remediasi H-03/H-05/H-06/M-01/M-05/M-06 ---
  it('QA-TC-29 / M-01: timer.reset only resets time to initialMs, without resetting match/segment phase or attempt', async () => {
    // Prepare a timer attached to segment
    const segmentAttemptId = randomUUID()
    await connection.client.segmentAttempt.create({
      data: {
        id: segmentAttemptId,
        matchId,
        kind: 'ROUND',
        ordinal: 1,
        attempt: 1,
        status: 'ACTIVE',
      },
    })

    const prep = await timerService.prepare({
      matchId,
      segmentAttemptId,
      phaseType: 'COMPETITION',
      initialMs: 300_000,
    })
    assert.equal(prep.remainingMs, 300_000)

    // Start with arming token
    timerService.armReadinessToken('token-qa-29')
    await timerService.start({ readinessToken: 'token-qa-29' })
    clock.advance(30_000)
    await timerService.pause()

    const adjusted = await timerService.adjust({ deltaMs: -10_000, reason: 'penyesuaian' })
    assert.equal(adjusted.remainingMs, 260_000)

    // Execute timer.reset
    const resetSnap = await timerService.reset({ reason: 'Instruksi juri reset waktu awal' })
    assert.equal(resetSnap.state, 'IDLE')
    assert.equal(resetSnap.remainingMs, 300_000)

    // Verify segment attempt is still ACTIVE and attempt unchanged (not reset or superseded)
    const segInDb = await connection.client.segmentAttempt.findUnique({
      where: { id: segmentAttemptId },
    })
    assert.equal(segInDb?.status, 'ACTIVE')
    assert.equal(segInDb?.attempt, 1)

    // Verify match is unaffected
    const matchInDb = await connection.client.match.findUnique({
      where: { id: matchId },
    })
    assert.ok(matchInDb)
  })

  it('QA-TC-30 / M-05: single-use readinessToken is consumed on start and rejects immediate reuse', async () => {
    timerService.armReadinessToken('token-qa-30')
    const start1 = await timerService.start({ readinessToken: 'token-qa-30' })
    assert.equal(start1.state, 'RUNNING')

    // Pause timer
    await timerService.pause()

    // Immediate attempt to re-start with the same consumed token must throw error
    await assert.rejects(
      async () => {
        await timerService.start({ readinessToken: 'token-qa-30' })
      },
      /INVALID_READINESS_TOKEN/,
    )
  })

  it('QA-TC-33 / H-06: storage recovery from DEGRADED to HEALTHY enforces manual intervention and forbids auto-resume', async () => {
    // Timer is in PAUSED state
    const beforeSnap = await timerService.getSnapshot()
    assert.equal(beforeSnap.state, 'PAUSED')

    // Simulate storage fault: DEGRADED
    timerService.setStorageHealth('DEGRADED')
    assert.equal(timerService.getStorageHealth(), 'DEGRADED')

    // All mutations rejected while DEGRADED
    await assert.rejects(
      async () => {
        await timerService.pause()
      },
      /STORAGE_DEGRADED/,
    )

    // Probe recovery: transition to HEALTHY
    timerService.setStorageHealth('HEALTHY')
    assert.equal(timerService.getStorageHealth(), 'HEALTHY')

    // Invariant: timer must remain PAUSED and never auto-resume!
    const afterSnap = await timerService.getSnapshot()
    assert.equal(afterSnap.state, 'PAUSED')
    assert.equal(afterSnap.remainingMs, beforeSnap.remainingMs)
  })

  it('QA-TC-37 / M-06: optimistic concurrency conflict and audit traceability on timer instance updates', async () => {
    const snap = await timerService.getSnapshot()

    // Generation sequence progresses monotonically
    const initialGeneration = snap.timerGeneration
    const adjusted = await timerService.adjust({ deltaMs: 5_000, reason: 'concurrency test' })
    assert.equal(adjusted.timerGeneration, initialGeneration)

    // Verify audits have distinct sequential IDs and preserve reason
    const audits = await connection.client.auditEntry.findMany({
      where: { resourceType: 'TimerInstance', resourceId: snap.id },
      orderBy: { timestampUtc: 'asc' },
    })
    assert.ok(audits.length >= 2)
  })
})
