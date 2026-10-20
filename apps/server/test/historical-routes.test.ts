import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'

import { buildServer } from '../src/app.js'
import { bootstrapAdmin, hashPassword } from '../src/auth.js'
import { DatabaseConnection } from '../src/database.js'

function cookie(response: { headers: Record<string, unknown> }): string {
  const setCookie = response.headers['set-cookie']
  if (Array.isArray(setCookie)) {
    return setCookie.map((c) => String(c).split(';')[0]).join('; ')
  }
  return typeof setCookie === 'string' ? setCookie.split(';')[0] ?? '' : ''
}

const origin = 'http://localhost:5173'

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

describe('Historical REC Import (L-10 / TC-16 / TC-17 / TC-25)', () => {
  let directory: string
  let databasePath: string
  let connection: DatabaseConnection
  let server: FastifyInstance
  let adminSession: { cookie: string; csrfToken: string }
  let operatorSession: { cookie: string; csrfToken: string }
  let matchId: string
  const origin = 'http://localhost:5173'

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'mrc-x-rec-'))
    databasePath = join(directory, 'rec.db')

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

    await bootstrapAdmin(connection.client, 'admin', 'admin-secret-password')
    await connection.client.user.create({
      data: {
        id: 'op-1',
        username: 'operator',
        passwordHash: await hashPassword('operator-secret-password'),
        role: 'OPERATOR',
      },
    })

    // Seed category, teams, match
    await connection.client.category.create({
      data: {
        id: 'cat-soccer',
        code: 'SOCCER',
        label: 'Robot Soccer',
      },
    })
    await connection.client.team.create({
      data: {
        id: 'team-a',
        categoryId: 'cat-soccer',
        code: 'TA',
        name: 'Tim Alpha',
      },
    })
    await connection.client.team.create({
      data: {
        id: 'team-b',
        categoryId: 'cat-soccer',
        code: 'TB',
        name: 'Tim Beta',
      },
    })

    matchId = 'match-historical-1'
    await connection.client.match.create({
      data: {
        id: matchId,
        categoryId: 'cat-soccer',
        teamAId: 'team-a',
        teamBId: 'team-b',
        sequence: 1,
        scheduledAt: new Date('2026-10-21T08:00:00Z'),
        status: 'SCHEDULED',
      },
    })

    server = buildServer({
      auth: { allowedOrigins: [origin], client: connection.client },
      client: connection.client,
    })

    adminSession = await login(server, 'admin', 'admin-secret-password')
    operatorSession = await login(server, 'operator', 'operator-secret-password')
  })

  after(async () => {
    await server.close()
    await connection.disconnect()
  })

  it('forbids operator from historical import preview (403 FORBIDDEN / REC / TC-18)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/historical-imports/preview',
      headers: {
        cookie: operatorSession.cookie,
        origin,
        'x-csrf-token': operatorSession.csrfToken,
      },
      payload: {
        records: [
          {
            eventId: 'EVT-01',
            recordId: 'REC-01',
            matchId,
            occurredAt: '2026-10-21T08:30:00Z',
            refereeReference: 'REF-01',
            authorityReference: 'JURY-01',
            decisionText: 'Tim Alpha menang',
          },
        ],
      },
    })

    assert.equal(res.statusCode, 403)
  })

  it('previews historical batch, detecting validation errors or generating batchId (REC / TC-25)', async () => {
    // 1. Preview with non-existent match fails validation
    const invalidRes = await server.inject({
      method: 'POST',
      url: '/api/v1/historical-imports/preview',
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        records: [
          {
            eventId: 'EVT-01',
            recordId: 'REC-01',
            matchId: 'match-does-not-exist',
            occurredAt: '2026-10-21T08:30:00Z',
            refereeReference: 'REF-01',
            authorityReference: 'JURY-01',
            decisionText: 'Tim Alpha menang',
          },
        ],
      },
    })

    assert.equal(invalidRes.statusCode, 200)
    assert.equal(invalidRes.json().valid, false)
    assert.equal(invalidRes.json().errors.length, 1)

    // 2. Valid preview returns valid batch
    const validRes = await server.inject({
      method: 'POST',
      url: '/api/v1/historical-imports/preview',
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        records: [
          {
            eventId: 'EVT-01',
            recordId: 'REC-01',
            matchId,
            occurredAt: '2026-10-21T08:30:00Z',
            refereeReference: 'REF-01',
            authorityReference: 'JURY-01',
            decisionText: 'Tim Alpha menang 3 - 1 atas Tim Beta',
            winnerTeamId: 'team-a',
            finalGoalsA: 3,
            finalGoalsB: 1,
          },
        ],
      },
    })

    assert.equal(validRes.statusCode, 200)
    const validData = validRes.json()
    assert.equal(validData.valid, true)
    assert.ok(validData.batchId)
    assert.ok(validData.batchHash)

    // 3. Commit batch atomically
    const commitRes = await server.inject({
      method: 'POST',
      url: `/api/v1/historical-imports/${validData.batchId}/commit`,
      headers: {
        cookie: adminSession.cookie,
        origin,
        'x-csrf-token': adminSession.csrfToken,
      },
      payload: {
        expectedBatchHash: validData.batchHash,
      },
    })

    assert.equal(commitRes.statusCode, 200)
    assert.equal(commitRes.json().committed, true)

    // Verify in DB: Match is COMPLETED and FINISHED, ResultRevision is FINAL, without live replay
    const matchInDb = await connection.client.match.findUnique({
      where: { id: matchId },
      include: { results: true },
    })
    assert.equal(matchInDb?.status, 'COMPLETED')
    assert.equal(matchInDb?.phase, 'FINISHED')
    assert.equal(matchInDb?.results.length, 1)
    const resultItem = matchInDb?.results[0]
    assert.ok(resultItem)
    assert.equal(resultItem.status, 'FINAL')
    assert.equal(resultItem.finalGoalsA, 3)
    assert.equal(resultItem.finalGoalsB, 1)
    assert.equal(resultItem.winnerTeamId, 'team-a')

    // Verify Audit entry
    const audit = await connection.client.auditEntry.findFirst({
      where: { action: 'historical.import' },
    })
    assert.ok(audit)
    assert.equal(audit?.authorityReference, 'JURY-01')
  })
})
