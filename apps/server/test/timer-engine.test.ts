import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import Database from 'better-sqlite3'
import { FakeClock } from '@mrc-x/shared'

import { DatabaseConnection } from '../src/database.js'
import { TimerService } from '../src/timer-service.js'

const m1Url = new URL(
  '../prisma/migrations/20261018190000_initial_foundation/migration.sql',
  import.meta.url,
)
const m2Url = new URL(
  '../prisma/migrations/20261020200000_add_match_schedule/migration.sql',
  import.meta.url,
)
const m3Url = new URL(
  '../prisma/migrations/20261021100000_add_match_lifecycle_foundation/migration.sql',
  import.meta.url,
)
const m4Url = new URL(
  '../prisma/migrations/20261021110000_add_timer_engine_foundation/migration.sql',
  import.meta.url,
)
const m5Url = new URL(
  '../prisma/migrations/20261021120000_add_goal_intent/migration.sql',
  import.meta.url,
)

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
    const m1 = await readFile(m1Url, 'utf8')
    const m2 = await readFile(m2Url, 'utf8')
    const m3 = await readFile(m3Url, 'utf8')
    const m4 = await readFile(m4Url, 'utf8')
    const m5 = await readFile(m5Url, 'utf8')

    const db = new Database(databasePath)
    db.exec(m1)
    db.exec(m2)
    db.exec(m3)
    db.exec(m4)
    db.exec(m5)
    db.close()

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
})
