import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'

import { buildServer } from '../src/app.js'
import { bootstrapAdmin, hashPassword } from '../src/auth.js'
import { DatabaseConnection } from '../src/database.js'
import { createMigratedDatabase } from './helpers/migrations.js'

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

describe('Match schedule generation (005 SG-01..SG-09)', () => {
  let connection: DatabaseConnection
  let server: FastifyInstance
  let admin: { cookie: string; csrfToken: string }
  let operator: { cookie: string; csrfToken: string }
  let categoryId: string

  function authHeaders(session: { cookie: string; csrfToken: string }) {
    return {
      cookie: session.cookie,
      origin,
      'x-csrf-token': session.csrfToken,
    }
  }

  async function catalogRevision(): Promise<number> {
    const config = await connection.client.eventConfig.findFirst()
    return config?.catalogRevision ?? 1
  }

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-schedule-'))
    const databasePath = join(directory, 'schedule.db')
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

    server = buildServer({
      auth: { allowedOrigins: [origin], client: connection.client },
      client: connection.client,
    })

    admin = await login(server, 'admin', 'admin-secret-password')
    operator = await login(server, 'operator', 'operator-secret-password')
  })

  after(async () => {
    await server.close()
    await connection.disconnect()
  })

  async function seedCategoryWithGroups(
    code: string,
    groupSpecs: Array<{ name: string; teamCodes: string[] }>,
  ): Promise<{ categoryId: string; groupIds: string[] }> {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: authHeaders(admin),
      payload: { code, label: `Kategori ${code}`, enabled: true },
    })
    assert.equal(created.statusCode, 201)
    const catId = created.json().id as string

    const groupIds: string[] = []
    for (const spec of groupSpecs) {
      const group = await server.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: authHeaders(admin),
        payload: { categoryId: catId, name: spec.name },
      })
      assert.equal(group.statusCode, 201)
      const groupId = group.json().id as string
      groupIds.push(groupId)

      for (const teamCode of spec.teamCodes) {
        const team = await server.inject({
          method: 'POST',
          url: '/api/v1/teams',
          headers: authHeaders(admin),
          payload: {
            categoryId: catId,
            code: teamCode,
            name: `Tim ${teamCode}`,
            groupId,
          },
        })
        assert.equal(team.statusCode, 201)
      }
    }

    return { categoryId: catId, groupIds }
  }

  it('creates a category with three groups of three teams', async () => {
    const seeded = await seedCategoryWithGroups('LF-GEN', [
      { name: 'Group A', teamCodes: ['LFU-01', 'LFU-02', 'LFU-03'] },
      { name: 'Group B', teamCodes: ['LFU-04', 'LFU-05', 'LFU-06'] },
      { name: 'Group C', teamCodes: ['LFU-07', 'LFU-08', 'LFU-09'] },
    ])
    categoryId = seeded.categoryId
    assert.equal(seeded.groupIds.length, 3)
  })

  it('rejects preview without rondeCount (no default is assumed)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/match-schedules/group-preview?categoryId=${categoryId}`,
      headers: authHeaders(admin),
    })
    assert.equal(res.statusCode, 422)
    assert.equal(res.json().error.code, 'INVALID_INPUT')
  })

  it('previews 27 matches for 3 groups x 3 ties x 3 ronde', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/match-schedules/group-preview?categoryId=${categoryId}&rondeCount=3`,
      headers: authHeaders(admin),
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.totalPlanned, 27)
    assert.equal(body.totalNew, 27)
    assert.equal(body.totalExisting, 0)
    assert.equal(body.groups.length, 3)
    for (const group of body.groups) {
      assert.equal(group.teamCount, 3)
      assert.equal(group.plannedCount, 9)
      assert.equal(group.newCount, 9)
    }
  })

  it('assigns Tim A by ascending team code on ronde 1 and swaps on ronde 2', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/match-schedules/group-preview?categoryId=${categoryId}&rondeCount=2`,
      headers: authHeaders(admin),
    })
    const groupA = res.json().groups[0]
    const ronde1 = groupA.matches.filter((m: any) => m.rondeNumber === 1)
    const ronde2 = groupA.matches.filter((m: any) => m.rondeNumber === 2)

    assert.equal(ronde1.length, 3)
    assert.equal(ronde2.length, 3)

    for (const first of ronde1) {
      assert.ok(first.teamACode < first.teamBCode, 'ronde 1 uses ascending code for Tim A')
      const mirror = ronde2.find((m: any) => m.tieId === first.tieId)
      assert.ok(mirror, 'expected a mirrored ronde 2 for the same tie')
      assert.equal(mirror.teamAId, first.teamBId)
      assert.equal(mirror.teamBId, first.teamAId)
    }
  })

  it('generates all matches in one atomic call', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/match-schedules/generate',
      headers: authHeaders(admin),
      payload: {
        categoryId,
        stage: 'GROUP',
        rondeCount: 3,
        stageLabel: 'Babak Grup',
        expectedCatalogRevision: await catalogRevision(),
      },
    })
    assert.equal(res.statusCode, 201)
    const body = res.json()
    assert.equal(body.created, 27)
    assert.equal(body.skipped.length, 0)
    assert.equal(body.groups.length, 3)
    assert.ok(body.batchId)

    const stored = await connection.client.match.findMany({
      where: { categoryId },
      orderBy: { sequence: 'asc' },
    })
    assert.equal(stored.length, 27)
    assert.deepEqual(
      stored.map((m) => m.sequence),
      Array.from({ length: 27 }, (_, i) => i + 1),
    )
    for (const match of stored) {
      assert.equal(match.stage, 'GROUP')
      assert.equal(match.stageLabel, 'Babak Grup')
      assert.equal(match.status, 'SCHEDULED')
      assert.ok(match.tieId)
      assert.ok(match.rondeNumber)
      assert.equal(match.generationBatchId, body.batchId)
    }
  })

  it('is idempotent: a second generate creates nothing and reports every skip', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/match-schedules/generate',
      headers: authHeaders(admin),
      payload: {
        categoryId,
        stage: 'GROUP',
        rondeCount: 3,
        stageLabel: 'Babak Grup',
        expectedCatalogRevision: await catalogRevision(),
      },
    })
    assert.equal(res.statusCode, 200)
    const body = res.json()
    assert.equal(body.created, 0)
    assert.equal(body.skipped.length, 27)
    assert.ok(body.skipped.every((s: any) => s.reason === 'ALREADY_EXISTS'))

    const count = await connection.client.match.count({ where: { categoryId } })
    assert.equal(count, 27)
  })

  it('skips only the ronde that already exist when rondeCount grows', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/match-schedules/generate',
      headers: authHeaders(admin),
      payload: {
        categoryId,
        stage: 'GROUP',
        rondeCount: 4,
        stageLabel: 'Babak Grup',
        expectedCatalogRevision: await catalogRevision(),
      },
    })
    assert.equal(res.statusCode, 201)
    const body = res.json()
    assert.equal(body.created, 9)
    assert.equal(body.skipped.length, 27)

    const count = await connection.client.match.count({ where: { categoryId } })
    assert.equal(count, 36)
  })

  it('rejects a stale catalog revision', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/match-schedules/generate',
      headers: authHeaders(admin),
      payload: {
        categoryId,
        stage: 'GROUP',
        rondeCount: 1,
        expectedCatalogRevision: 1,
      },
    })
    assert.equal(res.statusCode, 409)
    assert.equal(res.json().error.code, 'VERSION_CONFLICT')
  })

  it('rejects a category whose selected group has fewer than two teams', async () => {
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: authHeaders(admin),
      payload: { code: 'LF-TINY', label: 'Kategori Kecil', enabled: true },
    })
    const tinyCategoryId = created.json().id as string

    const group = await server.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: authHeaders(admin),
      payload: { categoryId: tinyCategoryId, name: 'Group Solo' },
    })
    const groupId = group.json().id as string

    await server.inject({
      method: 'POST',
      url: '/api/v1/teams',
      headers: authHeaders(admin),
      payload: {
        categoryId: tinyCategoryId,
        code: 'TINY-01',
        name: 'Tim Sendiri',
        groupId,
      },
    })

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/match-schedules/generate',
      headers: authHeaders(admin),
      payload: {
        categoryId: tinyCategoryId,
        stage: 'GROUP',
        rondeCount: 3,
        expectedCatalogRevision: await catalogRevision(),
      },
    })
    assert.equal(res.statusCode, 422)

    const count = await connection.client.match.count({
      where: { categoryId: tinyCategoryId },
    })
    assert.equal(count, 0, 'no partial write on validation failure')
  })

  it('denies operators on every mutation', async () => {
    const payloads: Array<{ url: string; method: 'POST' | 'PUT'; body: unknown }> = [
      {
        url: '/api/v1/match-schedules/generate',
        method: 'POST',
        body: {
          categoryId,
          stage: 'GROUP',
          rondeCount: 3,
          expectedCatalogRevision: await catalogRevision(),
        },
      },
      {
        url: '/api/v1/match-schedules/reorder',
        method: 'POST',
        body: {
          categoryId,
          expectedCatalogRevision: await catalogRevision(),
          orderedMatchIds: ['x'],
        },
      },
      {
        url: '/api/v1/tie-configs',
        method: 'PUT',
        body: { categoryId, stage: 'GROUP', rondeCount: 3 },
      },
    ]

    for (const entry of payloads) {
      const res = await server.inject({
        method: entry.method,
        url: entry.url,
        headers: authHeaders(operator),
        payload: entry.body as any,
      })
      assert.equal(res.statusCode, 403, `expected 403 for ${entry.url}`)
    }
  })

  it('reorders matches and renumbers sequence contiguously', async () => {
    const matches = await connection.client.match.findMany({
      where: { categoryId },
      orderBy: { sequence: 'asc' },
    })
    const reversed = matches.map((m) => m.id).reverse()

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/match-schedules/reorder',
      headers: authHeaders(admin),
      payload: {
        categoryId,
        expectedCatalogRevision: await catalogRevision(),
        orderedMatchIds: reversed,
      },
    })
    assert.equal(res.statusCode, 200)
    assert.equal(res.json().reordered, reversed.length)

    const after = await connection.client.match.findMany({
      where: { categoryId },
      orderBy: { sequence: 'asc' },
    })
    assert.deepEqual(
      after.map((m) => m.id),
      reversed,
      'stored order follows the submitted list',
    )
    assert.deepEqual(
      after.map((m) => m.sequence),
      Array.from({ length: after.length }, (_, i) => i + 1),
    )
  })

  it('rejects a reorder list that omits matches', async () => {
    const matches = await connection.client.match.findMany({
      where: { categoryId },
      orderBy: { sequence: 'asc' },
    })
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/match-schedules/reorder',
      headers: authHeaders(admin),
      payload: {
        categoryId,
        expectedCatalogRevision: await catalogRevision(),
        orderedMatchIds: matches.slice(1).map((m) => m.id),
      },
    })
    assert.equal(res.statusCode, 422)
    assert.equal(res.json().error.code, 'INVALID_INPUT')
  })

  it('stores tie configuration and guards its revision', async () => {
    const first = await server.inject({
      method: 'PUT',
      url: '/api/v1/tie-configs',
      headers: authHeaders(admin),
      payload: { categoryId, stage: 'GROUP', rondeCount: 3 },
    })
    assert.equal(first.statusCode, 201)
    assert.equal(first.json().revision, 1)

    const missingRevision = await server.inject({
      method: 'PUT',
      url: '/api/v1/tie-configs',
      headers: authHeaders(admin),
      payload: { categoryId, stage: 'GROUP', rondeCount: 5 },
    })
    assert.equal(missingRevision.statusCode, 409)

    const updated = await server.inject({
      method: 'PUT',
      url: '/api/v1/tie-configs',
      headers: authHeaders(admin),
      payload: {
        categoryId,
        stage: 'GROUP',
        rondeCount: 5,
        expectedRevision: 1,
      },
    })
    assert.equal(updated.statusCode, 200)
    assert.equal(updated.json().rondeCount, 5)
    assert.equal(updated.json().revision, 2)

    const listed = await server.inject({
      method: 'GET',
      url: `/api/v1/tie-configs?categoryId=${categoryId}`,
      headers: authHeaders(admin),
    })
    assert.equal(listed.statusCode, 200)
    assert.equal(listed.json().length, 1)
  })

  it('rolls back a batch and deletes only its untouched matches', async () => {
    const batch = await connection.client.matchGenerationBatch.findFirst({
      where: { categoryId },
      orderBy: { createdAt: 'desc' },
    })
    assert.ok(batch)

    const before = await connection.client.match.count({ where: { categoryId } })
    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/match-schedules/${batch!.id}/rollback`,
      headers: authHeaders(admin),
    })
    assert.equal(res.statusCode, 200)
    assert.equal(res.json().deleted, batch!.createdCount)

    const after = await connection.client.match.count({ where: { categoryId } })
    assert.equal(after, before - batch!.createdCount)

    const marked = await connection.client.matchGenerationBatch.findUnique({
      where: { id: batch!.id },
    })
    assert.ok(marked?.rolledBackAt)

    const again = await server.inject({
      method: 'POST',
      url: `/api/v1/match-schedules/${batch!.id}/rollback`,
      headers: authHeaders(admin),
    })
    assert.equal(again.statusCode, 409)
  })

  it('refuses rollback when a batch match has already started', async () => {    const batches = await connection.client.matchGenerationBatch.findMany({
      where: { categoryId, rolledBackAt: null },
    })
    const target = batches[0]
    assert.ok(target, 'expected an active batch to test against')

    const match = await connection.client.match.findFirst({
      where: { generationBatchId: target!.id },
    })
    assert.ok(match)
    await connection.client.match.update({
      where: { id: match!.id },
      data: { hasStarted: true, status: 'IN_PROGRESS' },
    })

    const res = await server.inject({
      method: 'POST',
      url: `/api/v1/match-schedules/${target!.id}/rollback`,
      headers: authHeaders(admin),
    })
    assert.equal(res.statusCode, 409)
    assert.equal(res.json().error.code, 'INVALID_TRANSITION')

    const stillThere = await connection.client.match.count({
      where: { generationBatchId: target!.id },
    })
    assert.ok(stillThere > 0, 'nothing is deleted when the guard fails')
  })

  it('keeps manual matches in the same category numbering space', async () => {
    const manualCategory = await server.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: authHeaders(admin),
      payload: { code: 'LF-MANUAL', label: 'Kategori Manual', enabled: true },
    })
    const manualCategoryId = manualCategory.json().id as string

    const group = await server.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: authHeaders(admin),
      payload: { categoryId: manualCategoryId, name: 'Group A' },
    })
    const groupId = group.json().id as string

    const teamIds: string[] = []
    for (const code of ['MAN-01', 'MAN-02']) {
      const team = await server.inject({
        method: 'POST',
        url: '/api/v1/teams',
        headers: authHeaders(admin),
        payload: {
          categoryId: manualCategoryId,
          code,
          name: `Tim ${code}`,
          groupId,
        },
      })
      teamIds.push(team.json().id as string)
    }

    const manual = await server.inject({
      method: 'POST',
      url: '/api/v1/matches',
      headers: authHeaders(admin),
      payload: {
        categoryId: manualCategoryId,
        groupId,
        stage: 'KNOCKOUT',
        stageLabel: 'Semifinal',
        sequence: 1,
        teamAId: teamIds[0],
        teamBId: teamIds[1],
      },
    })
    assert.equal(manual.statusCode, 201)
    assert.equal(manual.json().stage, 'KNOCKOUT')

    // Generate continues after the manual match instead of restarting at 1.
    const generated = await server.inject({
      method: 'POST',
      url: '/api/v1/match-schedules/generate',
      headers: authHeaders(admin),
      payload: {
        categoryId: manualCategoryId,
        stage: 'GROUP',
        rondeCount: 1,
        expectedCatalogRevision: await catalogRevision(),
      },
    })
    assert.equal(generated.statusCode, 201)
    assert.equal(generated.json().created, 1)

    const stored = await connection.client.match.findMany({
      where: { categoryId: manualCategoryId },
      orderBy: { sequence: 'asc' },
    })
    assert.deepEqual(
      stored.map((m) => m.sequence),
      [1, 2],
      'manual sequence 1 is preserved and the generated match takes 2',
    )
    assert.equal(stored[0]?.stage, 'KNOCKOUT')
    assert.equal(stored[1]?.stage, 'GROUP')
  })

  it('reports a duplicate sequence as a conflict instead of a server error', async () => {
    const categories = await connection.client.category.findMany({
      where: { code: 'LF-MANUAL' },
    })
    const manualCategoryId = categories[0]?.id as string
    const teams = await connection.client.team.findMany({
      where: { categoryId: manualCategoryId },
    })

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/matches',
      headers: authHeaders(admin),
      payload: {
        categoryId: manualCategoryId,
        sequence: 1,
        teamAId: teams[0]?.id,
        teamBId: teams[1]?.id,
      },
    })
    assert.equal(res.statusCode, 409)
    assert.equal(res.json().error.code, 'VERSION_CONFLICT')
  })
})
