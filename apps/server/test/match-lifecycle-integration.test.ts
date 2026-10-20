import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'
import Database from 'better-sqlite3'
import { FakeClock } from '@mrc-x/shared'

import { buildServer } from '../src/app.js'
import { bootstrapAdmin, hashPassword } from '../src/auth.js'
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
    const m1 = await readFile(m1Url, 'utf8')
    const m2 = await readFile(m2Url, 'utf8')
    const m3 = await readFile(m3Url, 'utf8')
    const m4 = await readFile(m4Url, 'utf8')

    const db = new Database(databasePath)
    db.exec(m1)
    db.exec(m2)
    db.exec(m3)
    db.exec(m4)
    db.close()

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

    // 2. Advance to COMPETITION -> first attempt becomes ACTIVE atomically
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
})
