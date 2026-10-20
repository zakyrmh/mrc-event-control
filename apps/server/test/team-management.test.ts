import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'
import Database from 'better-sqlite3'

import { buildServer } from '../src/app.js'
import { bootstrapAdmin, hashPassword } from '../src/auth.js'
import { DatabaseConnection } from '../src/database.js'

const migration1Url = new URL(
  '../prisma/migrations/20261018190000_initial_foundation/migration.sql',
  import.meta.url,
)
const migration2Url = new URL(
  '../prisma/migrations/20261020200000_add_match_schedule/migration.sql',
  import.meta.url,
)
const migration3Url = new URL(
  '../prisma/migrations/20261021100000_add_match_lifecycle_foundation/migration.sql',
  import.meta.url,
)
const migration4Url = new URL(
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

async function login(
  server: FastifyInstance,
  username: string,
  password: string,
) {
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

describe('Team & Match Management (T-01 - T-04)', () => {
  let connection: DatabaseConnection
  let server: FastifyInstance
  let adminSession: { cookie: string; csrfToken: string }
  let operatorSession: { cookie: string; csrfToken: string }

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-teams-'))
    const databasePath = join(directory, 'teams.db')
    const m1 = await readFile(migration1Url, 'utf8')
    const m2 = await readFile(migration2Url, 'utf8')
    const m3 = await readFile(migration3Url, 'utf8')
    const m4 = await readFile(migration4Url, 'utf8')
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

    server = buildServer({
      auth: { allowedOrigins: [origin], client: connection.client },
      client: connection.client,
    })

    adminSession = await login(server, 'admin', 'admin-secret-password')
    operatorSession = await login(
      server,
      'operator',
      'operator-secret-password',
    )
  })

  after(async () => {
    await server.close()
    await connection.disconnect()
  })

  describe('T-01: Category, Group, and Team CRUD & Archive', () => {
    let categoryId: string
    let categoryRevision: number
    let groupId: string
    let team1Id: string
    let team2Id: string

    it('creates a category as super-admin and bumps catalogRevision', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          code: 'LF-OPEN',
          label: 'Line Follower Open',
          enabled: true,
        },
      })
      assert.equal(res.statusCode, 201)
      const data = res.json()
      assert.equal(data.code, 'LF-OPEN')
      assert.equal(data.revision, 1)
      categoryId = data.id
      categoryRevision = data.revision

      const config = await connection.client.eventConfig.findFirstOrThrow()
      assert.equal(config.catalogRevision, 2)

      const audit = await connection.client.auditEntry.findFirst({
        where: { resourceType: 'Category', resourceId: categoryId },
      })
      assert.ok(audit)
      assert.equal(audit.action, 'category.create')
    })

    it('rejects duplicate category code', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          code: 'LF-OPEN',
          label: 'Line Follower Open Duplikat',
          enabled: true,
        },
      })
      assert.equal(res.statusCode, 422)
      assert.equal(res.json().error.code, 'DUPLICATE_CODE')
    })

    it('patches category with CAS and rejects stale revision', async () => {
      const staleRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/categories/${categoryId}`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          expectedRevision: 999,
          label: 'Updated Label',
        },
      })
      assert.equal(staleRes.statusCode, 409)
      assert.equal(staleRes.json().error.code, 'VERSION_CONFLICT')

      const successRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/categories/${categoryId}`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          expectedRevision: categoryRevision,
          label: 'Line Follower Open 2026',
        },
      })
      assert.equal(successRes.statusCode, 200)
      assert.equal(successRes.json().label, 'Line Follower Open 2026')
      assert.equal(successRes.json().revision, 2)
      categoryRevision = 2
    })

    it('creates a group and rejects duplicate name in same category', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          categoryId,
          name: 'Grup A',
        },
      })
      assert.equal(res.statusCode, 201)
      groupId = res.json().id

      const dupRes = await server.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          categoryId,
          name: 'Grup A',
        },
      })
      assert.equal(dupRes.statusCode, 422)
      assert.equal(dupRes.json().error.code, 'DUPLICATE_GROUP_NAME')
    })

    it('creates teams, rejects category mismatch for group, and archives team', async () => {
      // Category 2
      const cat2Res = await server.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: { code: 'ROBO-SOCCER', label: 'Robo Soccer', enabled: true },
      })
      const cat2Id = cat2Res.json().id

      // Mismatch: team in cat2 with groupId from cat1
      const mismatchRes = await server.inject({
        method: 'POST',
        url: '/api/v1/teams',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          categoryId: cat2Id,
          code: 'RS-01',
          name: 'Soccer Team 1',
          groupId,
        },
      })
      assert.equal(mismatchRes.statusCode, 422)
      assert.equal(mismatchRes.json().error.code, 'CATEGORY_MISMATCH')

      // Create Team 1 in cat1
      const team1Res = await server.inject({
        method: 'POST',
        url: '/api/v1/teams',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          categoryId,
          code: 'LF-01',
          name: 'Garuda Team',
          institution: 'Politeknik Negeri Padang',
          groupId,
        },
      })
      assert.equal(team1Res.statusCode, 201)
      team1Id = team1Res.json().id

      // Create Team 2 in cat1
      const team2Res = await server.inject({
        method: 'POST',
        url: '/api/v1/teams',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          categoryId,
          code: 'LF-02',
          name: 'Elang Team',
          institution: 'Politeknik Negeri Padang',
          groupId,
        },
      })
      assert.equal(team2Res.statusCode, 201)
      team2Id = team2Res.json().id

      // Archive Team 2
      const archiveRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/teams/${team2Id}`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          expectedRevision: 1,
          archived: true,
        },
      })
      assert.equal(archiveRes.statusCode, 200)
      assert.ok(archiveRes.json().archivedAt)

      // Query teams: default excludes archived
      const activeTeamsRes = await server.inject({
        method: 'GET',
        url: `/api/v1/teams?categoryId=${categoryId}`,
        headers: { cookie: operatorSession.cookie },
      })
      assert.equal(activeTeamsRes.statusCode, 200)
      const activeTeams = activeTeamsRes.json()
      assert.equal(activeTeams.length, 1)
      assert.equal(activeTeams[0].id, team1Id)

      // Query teams including archived
      const allTeamsRes = await server.inject({
        method: 'GET',
        url: `/api/v1/teams?categoryId=${categoryId}&includeArchived=true`,
        headers: { cookie: operatorSession.cookie },
      })
      assert.equal(allTeamsRes.json().length, 2)

      // Unarchive Team 2 for subsequent tests
      const unarchiveRes = await server.inject({
        method: 'PATCH',
        url: `/api/v1/teams/${team2Id}`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          expectedRevision: 2,
          archived: false,
        },
      })
      assert.equal(unarchiveRes.statusCode, 200)
      assert.equal(unarchiveRes.json().archivedAt, null)
    })
  })

  describe('T-02: All-or-Nothing CSV Import (TM-02)', () => {
    it('previews and commits valid CSV, creating teams atomically', async () => {
      const config = await connection.client.eventConfig.findFirstOrThrow()
      const csv = [
        'categoryCode,teamCode,teamName,institution,groupName',
        'LF-OPEN,LF-IMPORT-1,Imported One,Institut Teknologi,Grup A',
        'LF-OPEN,LF-IMPORT-2,Imported Two,Universitas Indonesia,Grup A',
      ].join('\n')

      const previewRes = await server.inject({
        method: 'POST',
        url: '/api/v1/team-imports/preview',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          csvContent: csv,
          expectedRevision: config.catalogRevision,
        },
      })
      assert.equal(previewRes.statusCode, 200)
      const preview = previewRes.json()
      assert.equal(preview.valid, true)
      assert.equal(preview.summary.totalRows, 2)
      assert.equal(preview.summary.validRows, 2)
      assert.equal(preview.errors.length, 0)
      assert.ok(preview.previewHash)

      // Commit
      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/v1/team-imports/${preview.id}/commit`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          previewHash: preview.previewHash,
          expectedRevision: config.catalogRevision,
        },
      })
      assert.equal(commitRes.statusCode, 200)
      assert.equal(commitRes.json().committed, true)
      assert.equal(commitRes.json().importedCount, 2)

      const imported1 = await connection.client.team.findFirst({
        where: { code: 'LF-IMPORT-1' },
      })
      assert.ok(imported1)
      assert.equal(imported1.name, 'Imported One')
    })

    it('rejects preview with invalid rows and blocks commit (All-or-Nothing)', async () => {
      const config = await connection.client.eventConfig.findFirstOrThrow()
      const badCsv = [
        'categoryCode,teamCode,teamName,institution,groupName',
        'LF-OPEN,LF-VALID-3,Team Three,,Grup A',
        'UNKNOWN-CAT,LF-INVALID-4,Team Four,,Grup A', // non-existent category
        'LF-OPEN,LF-VALID-3,Team Five Duplicate Code,,Grup A', // duplicate teamCode
      ].join('\n')

      const previewRes = await server.inject({
        method: 'POST',
        url: '/api/v1/team-imports/preview',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          csvContent: badCsv,
          expectedRevision: config.catalogRevision,
        },
      })
      assert.equal(previewRes.statusCode, 200)
      const preview = previewRes.json()
      assert.equal(preview.valid, false)
      assert.equal(preview.summary.errorRows, 2)
      assert.ok(preview.errors.length >= 2)

      // Commit must fail all-or-nothing
      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/v1/team-imports/${preview.id}/commit`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          previewHash: preview.previewHash,
          expectedRevision: config.catalogRevision,
        },
      })
      assert.equal(commitRes.statusCode, 422)

      // Ensure zero rows were written
      const notWritten = await connection.client.team.findFirst({
        where: { code: 'LF-VALID-3' },
      })
      assert.equal(notWritten, null)
    })

    it('rejects commit when catalogRevision changes (stale preview conflict)', async () => {
      const config = await connection.client.eventConfig.findFirstOrThrow()
      const csv = [
        'categoryCode,teamCode,teamName,institution,groupName',
        'LF-OPEN,LF-STALE-1,Stale Team,,Grup A',
      ].join('\n')

      const previewRes = await server.inject({
        method: 'POST',
        url: '/api/v1/team-imports/preview',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          csvContent: csv,
          expectedRevision: config.catalogRevision,
        },
      })
      const preview = previewRes.json()

      // Mutate catalog in between (create another category)
      await server.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: { code: 'DRONE', label: 'Drone Race', enabled: true },
      })

      // Commit should now be rejected due to stale catalog
      const commitRes = await server.inject({
        method: 'POST',
        url: `/api/v1/team-imports/${preview.id}/commit`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          previewHash: preview.previewHash,
          expectedRevision: config.catalogRevision,
        },
      })
      assert.equal(commitRes.statusCode, 409)
      assert.equal(commitRes.json().error.code, 'VERSION_CONFLICT')
    })
  })

  describe('T-03: Manual Match Scheduling & Invariant Guard (TM-03 / TM-06)', () => {
    let category: { id: string }
    let teamA: { id: string }
    let teamB: { id: string }
    let teamOtherCat: { id: string }
    let matchId: string

    before(async () => {
      const cat = await connection.client.category.findUniqueOrThrow({
        where: { code: 'LF-OPEN' },
      })
      category = cat
      const teams = await connection.client.team.findMany({
        where: { categoryId: cat.id, archivedAt: null },
      })
      teamA = teams[0]!
      teamB = teams[1]!

      const otherCat = await connection.client.category.findUniqueOrThrow({
        where: { code: 'ROBO-SOCCER' },
      })
      teamOtherCat = await connection.client.team.create({
        data: {
          id: randomUUID(),
          categoryId: otherCat.id,
          code: 'RS-99',
          name: 'Soccer 99',
        },
      })
    })

    it('rejects match schedule when teamA === teamB', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/matches',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          categoryId: category.id,
          sequence: 1,
          teamAId: teamA.id,
          teamBId: teamA.id,
        },
      })
      assert.equal(res.statusCode, 422)
      assert.equal(res.json().error.code, 'SAME_TEAM_FORBIDDEN')
    })

    it('rejects match schedule when teams belong to different categories', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/matches',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          categoryId: category.id,
          sequence: 1,
          teamAId: teamA.id,
          teamBId: teamOtherCat.id,
        },
      })
      assert.equal(res.statusCode, 422)
      assert.equal(res.json().error.code, 'CATEGORY_MISMATCH')
    })

    it('creates match schedule with valid invariant and audit entry', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/matches',
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          categoryId: category.id,
          sequence: 1,
          stageLabel: 'Babak Penyisihan',
          scheduledAt: '2026-10-25T09:00:00.000Z',
          teamAId: teamA.id,
          teamBId: teamB.id,
        },
      })
      assert.equal(res.statusCode, 201)
      const data = res.json()
      assert.equal(data.status, 'SCHEDULED')
      assert.equal(data.matchVersion, 1)
      matchId = data.id

      const audit = await connection.client.auditEntry.findFirst({
        where: { resourceType: 'Match', resourceId: matchId },
      })
      assert.ok(audit)
      assert.equal(audit.action, 'match.schedule')
    })

    it('allows reschedule before match starts and bumps matchVersion', async () => {
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/matches/${matchId}`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          expectedMatchVersion: 1,
          stageLabel: 'Babak Penyisihan - Lapangan 1',
          sequence: 2,
        },
      })
      assert.equal(res.statusCode, 200)
      assert.equal(res.json().matchVersion, 2)
      assert.equal(res.json().stageLabel, 'Babak Penyisihan - Lapangan 1')
      assert.equal(res.json().sequence, 2)
    })

    it('rejects match correction once match has started (TM-06)', async () => {
      // Simulate match started
      await connection.client.match.update({
        where: { id: matchId },
        data: { hasStarted: true, status: 'RUNNING' },
      })

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/matches/${matchId}`,
        headers: {
          cookie: adminSession.cookie,
          origin,
          'x-csrf-token': adminSession.csrfToken,
        },
        payload: {
          expectedMatchVersion: 2,
          stageLabel: 'Percobaan Koreksi Saat Main',
        },
      })
      assert.equal(res.statusCode, 422)
      assert.equal(res.json().error.code, 'MATCH_ALREADY_STARTED')
    })
  })

  describe('T-04: RBAC & Audit Verification (TC-18 / TC-19)', () => {
    it('allows operator to read lists but forbids mutations', async () => {
      // Operator GET matches
      const getMatches = await server.inject({
        method: 'GET',
        url: '/api/v1/matches',
        headers: { cookie: operatorSession.cookie },
      })
      assert.equal(getMatches.statusCode, 200)

      // Operator GET teams
      const getTeams = await server.inject({
        method: 'GET',
        url: '/api/v1/teams',
        headers: { cookie: operatorSession.cookie },
      })
      assert.equal(getTeams.statusCode, 200)

      // Operator POST category -> 403 Forbidden
      const postCat = await server.inject({
        method: 'POST',
        url: '/api/v1/categories',
        headers: {
          cookie: operatorSession.cookie,
          origin,
          'x-csrf-token': operatorSession.csrfToken,
        },
        payload: { code: 'OP-FORBIDDEN', label: 'Test', enabled: true },
      })
      assert.equal(postCat.statusCode, 403)

      // Unauthenticated -> 401 Unauthorized
      const unauth = await server.inject({
        method: 'GET',
        url: '/api/v1/categories',
      })
      assert.equal(unauth.statusCode, 401)
    })
  })
})
