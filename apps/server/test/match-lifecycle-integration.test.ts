import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'
import { FakeClock } from '@mrc-x/shared'

import { buildServer } from '../src/app.js'
import { bootstrapAdmin, hashPassword } from '../src/auth.js'
import { DatabaseConnection } from '../src/database.js'
import { createMigratedDatabase } from './helpers/migrations.js'
import { TimerService } from '../src/timer-service.js'


const origin = 'http://localhost:3000'

function cookie(reply: { headers: Record<string, unknown> }): string {
  const setCookie = reply.headers['set-cookie']
  if (Array.isArray(setCookie)) return setCookie[0]?.split(';')[0] ?? ''
  if (typeof setCookie === 'string') return setCookie.split(';')[0] ?? ''
  return ''
}

async function login(server: FastifyInstance, username: string, password: string) {
  const bootstrap = await server.inject({
    method: 'GET',
    url: '/api/v1/auth/bootstrap',
  })
  const response = await server.inject({
    headers: {
      cookie: cookie(bootstrap),
      origin,
      'x-csrf-token': bootstrap.json().csrfToken as string,
    },
    method: 'POST',
    payload: { password, username },
    url: '/api/v1/auth/login',
  })
  assert.equal(response.statusCode, 200)
  return {
    cookie: cookie(response),
    csrfToken: response.json().csrfToken as string,
  }
}

describe('Match Lifecycle Integration with Timer & Arena (L-04 / TC-02, TC-03, TC-12)', () => {
  let connection: DatabaseConnection
  let server: FastifyInstance
  let timerService: TimerService
  let adminSession: { cookie: string; csrfToken: string }
  let operatorSession: { cookie: string; csrfToken: string }
  let categoryId: string
  let teamAId: string
  let teamBId: string
  let match1Id: string
  let match2Id: string

  let arenaVersion = 1
  let match1Version = 1

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-lifecycle-integration-'))
    const databasePath = join(directory, 'lifecycle-int.db')

    await createMigratedDatabase(databasePath)

    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()

    await bootstrapAdmin(connection.client, 'admin', 'admin-secret-password')
    await connection.client.user.create({
      data: {
        id: 'operator-1',
        username: 'operator',
        passwordHash: await hashPassword('operator-secret-password'),
        role: 'OPERATOR',
      },
    })

    const clock = new FakeClock(100_000, '2026-10-21T10:00:00.000Z')
    timerService = new TimerService({
      client: connection.client,
      runtimeId: 'integration-runtime-1',
      clock,
    })

    server = buildServer({
      auth: { allowedOrigins: [origin], client: connection.client },
      client: connection.client,
      timerService,
    })

    adminSession = await login(server, 'admin', 'admin-secret-password')
    operatorSession = await login(server, 'operator', 'operator-secret-password')

    categoryId = randomUUID()
    await connection.client.category.create({
      data: { id: categoryId, code: 'SOCCER', label: 'Robot Soccer', enabled: true },
    })

    teamAId = randomUUID()
    await connection.client.team.create({
      data: { id: teamAId, categoryId, code: 'SOC-A', name: 'Alpha Soccer', institution: 'Politeknik A' },
    })

    teamBId = randomUUID()
    await connection.client.team.create({
      data: { id: teamBId, categoryId, code: 'SOC-B', name: 'Beta Soccer', institution: 'Politeknik B' },
    })

    match1Id = randomUUID()
    await connection.client.match.create({
      data: {
        id: match1Id,
        categoryId,
        sequence: 1,
        teamAId,
        teamBId,
        status: 'SCHEDULED',
      },
    })

    match2Id = randomUUID()
    await connection.client.match.create({
      data: {
        id: match2Id,
        categoryId,
        sequence: 2,
        teamAId,
        teamBId,
        status: 'SCHEDULED',
      },
    })
  })

  after(async () => {
    await server.close()
    await connection.disconnect()
  })

  it('selects match to arena, freezes team identity snapshot, and bumps versions', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/arenas/main/commands',
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'match.select',
        matchId: match1Id,
        expectedArenaVersion: arenaVersion,
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(res.statusCode, 200)
    const data = res.json()
    assert.equal(data.status, 'PREPARING')
    assert.equal(data.activeMatchId, match1Id)
    assert.equal(data.arenaVersion, arenaVersion + 1)
    assert.equal(data.matchVersion, match1Version + 1)

    arenaVersion = data.arenaVersion
    match1Version = data.matchVersion

    // Verify snapshot was frozen in DB
    const matchInDb = await connection.client.match.findUnique({ where: { id: match1Id } })
    assert.ok(matchInDb?.teamASnapshotJson)
    assert.match(matchInDb.teamASnapshotJson, /Alpha Soccer/)
  })

  it('rejects selecting match 2 while arena is busy with match 1 (ARENA_BUSY)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/arenas/main/commands',
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'match.select',
        matchId: match2Id,
        expectedArenaVersion: arenaVersion,
        expectedMatchVersion: 1,
      },
    })

    assert.equal(res.statusCode, 409)
    assert.equal(res.json().error.code, 'ARENA_BUSY')
  })

  it('advances pre-match phases normally: CALLING -> VERIFICATION -> WARMUP -> READY', async () => {
    for (const phase of ['CALLING', 'VERIFICATION', 'WARMUP', 'READY'] as const) {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/matches/${match1Id}/commands`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          action: 'phase.advance',
          targetPhase: phase,
          expectedMatchVersion: match1Version,
        },
      })
      assert.equal(res.statusCode, 200)
      assert.equal(res.json().phase, phase)
      match1Version = res.json().matchVersion
    }
  })

  it('prepares segment attempt (status PREPARED) and starts competition (status ACTIVE)', async () => {
    // 1. Prepare segment
    const prepRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'segment.prepare',
        kind: 'ROUND',
        ordinal: 1,
        durationMs: 300_000,
        expectedMatchVersion: match1Version,
      },
    })
    assert.equal(prepRes.statusCode, 200)
    match1Version = prepRes.json().matchVersion

    // Verify segment is PREPARED in DB
    const segInDb = await connection.client.segmentAttempt.findUnique({
      where: { id: prepRes.json().currentSegmentId },
    })
    assert.equal(segInDb?.status, 'PREPARED')

    // 2. Arm start before kickoff (L-08 / match.arm-start)
    const armRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'match.arm-start',
        expectedMatchVersion: match1Version,
      },
    })
    assert.equal(armRes.statusCode, 200)
    const readinessToken = armRes.json().readinessToken
    assert.ok(readinessToken)

    // 3. Advance to COMPETITION with readinessToken -> first attempt becomes ACTIVE atomically
    const advRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'phase.advance',
        targetPhase: 'COMPETITION',
        readinessToken,
        expectedMatchVersion: match1Version,
      },
    })
    assert.equal(advRes.statusCode, 200)
    assert.equal(advRes.json().status, 'IN_PROGRESS')
    assert.equal(advRes.json().hasStarted, true)
    match1Version = advRes.json().matchVersion

    // Segment attempt in DB must now be ACTIVE
    const activeSeg = await connection.client.segmentAttempt.findUnique({
      where: { id: segInDb?.id ?? '' },
    })
    assert.equal(activeSeg?.status, 'ACTIVE')
    assert.ok(activeSeg?.startedAt)
  })

  it('forbids match.release once match has started (TC-12 / must postpone)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/arenas/main/commands',
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'match.release',
        matchId: match1Id,
        expectedArenaVersion: arenaVersion,
        expectedMatchVersion: match1Version,
      },
    })
    assert.equal(res.statusCode, 409)
    assert.equal(res.json().error.code, 'INVALID_TRANSITION')
  })

  it('pauses and postpones match, releasing arena cleanly', async () => {
    // 1. Pause
    const pauseRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'match.pause',
        expectedMatchVersion: match1Version,
        reason: 'Hujan deras atau masalah arena',
      },
    })
    assert.equal(pauseRes.statusCode, 200)
    assert.equal(pauseRes.json().status, 'PAUSED')
    match1Version = pauseRes.json().matchVersion

    // 2. Postpone
    const postRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'match.postpone',
        expectedMatchVersion: match1Version,
        expectedArenaVersion: arenaVersion,
        reason: 'Ditunda atas instruksi juri',
        authorityReference: 'JURI-UTAMA-1',
      },
    })
    assert.equal(postRes.statusCode, 200)
    assert.equal(postRes.json().status, 'POSTPONED')
    match1Version = postRes.json().matchVersion
    arenaVersion = postRes.json().arenaVersion

    // Arena is now free
    const arenaInDb = await connection.client.arenaState.findUnique({ where: { id: 'main' } })
    assert.equal(arenaInDb?.activeMatchId, null)
  })

  it('select-resumes postponed match back to arena in PAUSED status (hasStarted: true)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/arenas/main/commands',
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'match.select',
        matchId: match1Id,
        expectedArenaVersion: arenaVersion,
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(res.statusCode, 200)
    assert.equal(res.json().status, 'PAUSED') // Resumes into PAUSED because hasStarted: true
    assert.equal(res.json().activeMatchId, match1Id)
    arenaVersion = res.json().arenaVersion
    match1Version = res.json().matchVersion
  })

  it('rejects phase override without reason or authority reference (422 / ML-03)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'phase.override',
        targetPhase: 'WARMUP',
        expectedMatchVersion: match1Version,
        reason: '',
        authorityReference: '',
      },
    })
    assert.equal(res.statusCode, 422)
    assert.equal(res.json().error.code, 'INVALID_INPUT')
  })

  it('executes phase override with reason and authorityReference (ML-03 / AC-04)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'phase.override',
        targetPhase: 'WARMUP',
        expectedMatchVersion: match1Version,
        reason: 'Robot rusak sebelum kickoff resmi, pemanasan ulang diminta juri',
        authorityReference: 'JURI-UTAMA-SOCCER-1',
      },
    })
    assert.equal(res.statusCode, 200)
    assert.equal(res.json().phase, 'WARMUP')
    match1Version = res.json().matchVersion

    // Verify audit entry contains before/after and authority reference
    const audit = await connection.client.auditEntry.findFirst({
      where: { resourceType: 'Match', resourceId: match1Id, action: 'phase.override' },
    })
    assert.ok(audit)
    assert.equal(audit.authorityReference, 'JURI-UTAMA-SOCCER-1')
    assert.match(audit.beforeJson ?? '', /PAUSED/)
    assert.match(audit.afterJson ?? '', /WARMUP/)
  })

  it('generates canonical review digest and restarts segment attempt (ML-04 / AC-07)', async () => {
    const match = await connection.client.match.findUnique({
      where: { id: match1Id },
      include: { segments: true },
    })
    const segmentToRestart = match?.segments[0]
    assert.ok(segmentToRestart)

    // 1. Request review digest
    const reviewRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/review`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'segment.restart',
        targetId: segmentToRestart.id,
      },
    })
    assert.equal(reviewRes.statusCode, 200)
    const reviewDigest = reviewRes.json().reviewDigest
    assert.ok(reviewDigest)

    // 2. Reject if digest is stale
    const staleRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'segment.restart',
        segmentAttemptId: segmentToRestart.id,
        expectedMatchVersion: match1Version,
        reason: 'Sinyal terputus saat kickoff',
        authorityReference: 'JURI-1',
        confirmImpactDigest: 'invalid-stale-hash',
      },
    })
    assert.equal(staleRes.statusCode, 409)
    assert.equal(staleRes.json().error.code, 'REVIEW_STALE')

    // 3. Restart with valid digest succeeds
    const restartRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'segment.restart',
        segmentAttemptId: segmentToRestart.id,
        expectedMatchVersion: match1Version,
        reason: 'Sinyal terputus saat kickoff',
        authorityReference: 'JURI-1',
        confirmImpactDigest: reviewDigest,
      },
    })
    assert.equal(restartRes.statusCode, 200)
    const data = restartRes.json()
    assert.equal(data.ordinal, segmentToRestart.ordinal)
    assert.equal(data.attempt, segmentToRestart.attempt + 1)
    match1Version = data.matchVersion

    // Verify in database: old segment is REPLACED, new segment is PREPARED
    const oldSeg = await connection.client.segmentAttempt.findUnique({
      where: { id: segmentToRestart.id },
    })
    assert.equal(oldSeg?.status, 'REPLACED')
    assert.equal(oldSeg?.reason, 'Sinyal terputus saat kickoff')

    const newSeg = await connection.client.segmentAttempt.findUnique({
      where: { id: data.currentSegmentId },
    })
    assert.equal(newSeg?.status, 'PREPARED')
    assert.equal(newSeg?.supersedesAttemptId, segmentToRestart.id)
  })

  // --- L-06: GoalIntent, Soccer goal.add, rearm, correct, and goal.reassign ---
  let activeGoalIntentId: string
  let firstGoalId: string
  let secondGoalId: string

  it('generates a single READY GoalIntent when entering COMPETITION (SC-01)', async () => {
    const advRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'phase.advance',
        targetPhase: 'COMPETITION',
        expectedMatchVersion: match1Version,
      },
    })
    assert.equal(advRes.statusCode, 200)
    assert.equal(advRes.json().phase, 'COMPETITION')
    assert.ok(advRes.json().activeGoalIntentId)
    activeGoalIntentId = advRes.json().activeGoalIntentId
    match1Version = advRes.json().matchVersion

    // Verify GoalIntent in DB is READY
    const intentInDb = await connection.client.goalIntent.findUnique({
      where: { id: activeGoalIntentId },
    })
    assert.equal(intentInDb?.status, 'READY')
  })

  it('records a goal (goal.add), consumes the GoalIntent, and updates score (SC-01 / TC-08)', async () => {
    const goalRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'goal.add',
        goalIntentId: activeGoalIntentId,
        side: 'A',
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(goalRes.statusCode, 200)
    const data = goalRes.json()
    assert.equal(data.side, 'A')
    assert.equal(data.score.goalsA, 1)
    assert.equal(data.score.goalsB, 0)
    firstGoalId = data.goalEventId
    match1Version = data.matchVersion

    // Verify intent is CONSUMED in DB
    const intentInDb = await connection.client.goalIntent.findUnique({
      where: { id: activeGoalIntentId },
    })
    assert.equal(intentInDb?.status, 'CONSUMED')
  })

  it('rejects double-submission with consumed GoalIntent (409 GOAL_INTENT_CONSUMED / SC-01 / TC-22)', async () => {
    const doubleRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'goal.add',
        goalIntentId: activeGoalIntentId,
        side: 'A',
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(doubleRes.statusCode, 409)
    assert.equal(doubleRes.json().error.code, 'GOAL_INTENT_CONSUMED')
  })

  it('re-arms next goal intent explicitly via goal.prepare-next (SC-02)', async () => {
    const rearmRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'goal.prepare-next',
        previousGoalIntentId: activeGoalIntentId,
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(rearmRes.statusCode, 200)
    assert.equal(rearmRes.json().status, 'READY')
    activeGoalIntentId = rearmRes.json().goalIntentId

    // Record second goal for Team B
    const goal2Res = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'goal.add',
        goalIntentId: activeGoalIntentId,
        side: 'B',
        expectedMatchVersion: match1Version,
      },
    })
    assert.equal(goal2Res.statusCode, 200)
    assert.equal(goal2Res.json().score.goalsA, 1)
    assert.equal(goal2Res.json().score.goalsB, 1)
    secondGoalId = goal2Res.json().goalEventId
    match1Version = goal2Res.json().matchVersion
  })

  it('reassigns goal side atomically via goal.reassign (-1 on B, +1 on A / SC-04)', async () => {
    const reassignRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'goal.reassign',
        sourceGoalEventId: secondGoalId,
        targetSide: 'A',
        reason: 'Wasit mengoreksi bahwa gol tadi dicetak Tim A bukan Tim B',
        authorityReference: 'JURI-1',
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(reassignRes.statusCode, 200)
    const data = reassignRes.json()
    assert.equal(data.newSide, 'A')
    assert.equal(data.score.goalsA, 2)
    assert.equal(data.score.goalsB, 0)
    match1Version = data.matchVersion

    // Verify database lineage: both events share logicalGoalId and correctionGroupId
    const cancelEvent = await connection.client.goalEvent.findFirst({
      where: { correctsGoalId: secondGoalId },
    })
    assert.ok(cancelEvent)
    assert.equal(cancelEvent.delta, -1)
    assert.equal(cancelEvent.side, 'B')

    const newEvent = await connection.client.goalEvent.findUnique({
      where: { id: data.reassignedGoalId },
    })
    assert.ok(newEvent)
    assert.equal(newEvent.delta, 1)
    assert.equal(newEvent.side, 'A')
    assert.equal(newEvent.correctionGroupId, cancelEvent.correctionGroupId)
  })

  it('corrects an invalid goal via goal.correct (-1 delta / SC-03)', async () => {
    const correctRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'goal.correct',
        correctsGoalId: firstGoalId,
        reason: 'Pelanggaran terjadi sesaat sebelum bola masuk',
        authorityReference: 'JURI-1',
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(correctRes.statusCode, 200)
    const data = correctRes.json()
    assert.equal(data.correctedGoalId, firstGoalId)
    assert.equal(data.score.goalsA, 1)
    assert.equal(data.score.goalsB, 0)
    match1Version = data.matchVersion

    // Verify in DB that cancel event was recorded
    const cancelEvent = await connection.client.goalEvent.findFirst({
      where: { id: data.cancelEventId },
    })
    assert.equal(cancelEvent?.delta, -1)
    assert.equal(cancelEvent?.reason, 'Pelanggaran terjadi sesaat sebelum bola masuk')
  })

  // --- L-07: Result drafting, finalization, reopen, refinalize, cancel-correction ---
  let draftRevisionId: string

  it('moves to RESULT phase and creates a draft result revision (result.draft / TC-09)', async () => {
    // 1. Advance to RESULT
    const resRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'phase.advance',
        targetPhase: 'RESULT',
        expectedMatchVersion: match1Version,
      },
    })
    assert.equal(resRes.statusCode, 200)
    assert.equal(resRes.json().phase, 'RESULT')
    match1Version = resRes.json().matchVersion

    // 2. Draft result revision
    const draftRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'result.draft',
        decisionText: 'Tim Alpha Soccer menang 1 - 0 atas Tim Beta Soccer',
        winnerTeamId: teamAId,
        finalGoalsA: 1,
        finalGoalsB: 0,
        pointsA: 3,
        pointsB: 0,
        refereeReference: 'JURI-UTAMA-SOCCER-1',
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(draftRes.statusCode, 200)
    const data = draftRes.json()
    assert.equal(data.status, 'DRAFT')
    assert.equal(data.winnerTeamId, teamAId)
    assert.equal(data.finalGoalsA, 1)
    assert.equal(data.finalGoalsB, 0)
    // Points are the jury's decision, recorded verbatim; the system never derives them.
    assert.equal(data.pointsA, 3)
    assert.equal(data.pointsB, 0)
    draftRevisionId = data.resultRevisionId
    match1Version = data.matchVersion
  })

  it('finalizes result (result.finalize), marking match COMPLETED and releasing arena (TC-09)', async () => {
    const finRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'result.finalize',
        draftRevisionId,
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(finRes.statusCode, 200)
    const data = finRes.json()
    assert.equal(data.status, 'COMPLETED')
    assert.equal(data.phase, 'FINISHED')
    match1Version = data.matchVersion
    arenaVersion = data.arenaVersion

    // Verify in database: result revision is FINAL, arena has activeMatchId: null
    const finalRev = await connection.client.resultRevision.findUnique({
      where: { id: draftRevisionId },
    })
    assert.equal(finalRev?.status, 'FINAL')
    assert.ok(finalRev?.finalizedAt)

    const arena = await connection.client.arenaState.findUnique({ where: { id: 'main' } })
    assert.equal(arena?.activeMatchId, null)
  })

  it('forbids operator from reopening finalized match (403 FORBIDDEN / TC-19)', async () => {
    const reopenRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        action: 'result.reopen',
        reason: 'Sengketa hasil diajukan manajer tim',
        authorityReference: 'DEWAN-JURI-1',
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(reopenRes.statusCode, 403)
    assert.equal(reopenRes.json().error.code, 'FORBIDDEN')
  })

  it('allows super-admin to reopen match into CORRECTION_PENDING and refinalize (TC-10)', async () => {
    // 1. Reopen
    const reopenRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'result.reopen',
        reason: 'Koreksi administratif nama pengesah juri',
        authorityReference: 'KETUA-JURI-1',
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(reopenRes.statusCode, 200)
    const reopenData = reopenRes.json()
    assert.equal(reopenData.status, 'CORRECTION_PENDING')
    assert.equal(reopenData.revision, 2)
    match1Version = reopenData.matchVersion
    const correctionDraftId = reopenData.draftRevisionId

    // 2. Refinalize as super-admin
    const refinalizeRes = await server.inject({
      method: 'POST',
      url: `/api/v1/matches/${match1Id}/commands`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        action: 'result.refinalize',
        draftRevisionId: correctionDraftId,
        reason: 'Pembaruan pengesah selesai diverifikasi',
        authorityReference: 'KETUA-JURI-1',
        expectedMatchVersion: match1Version,
      },
    })

    assert.equal(refinalizeRes.statusCode, 200)
    const refinalData = refinalizeRes.json()
    assert.equal(refinalData.status, 'COMPLETED')
    match1Version = refinalData.matchVersion

    // Verify older revision is SUPERSEDED and new revision is FINAL
    const rev1 = await connection.client.resultRevision.findUnique({
      where: { id: draftRevisionId },
    })
    assert.equal(rev1?.status, 'SUPERSEDED')

    const rev2 = await connection.client.resultRevision.findUnique({
      where: { id: correctionDraftId },
    })
    assert.equal(rev2?.status, 'FINAL')
  })
})
