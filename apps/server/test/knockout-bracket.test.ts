import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import type { FastifyInstance } from 'fastify'

import { buildServer } from '../src/app.js'
import { bootstrapAdmin } from '../src/auth.js'
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

describe('Sumobot Bracket Progression & Triangular Final', () => {
  let db: DatabaseConnection
  let server: FastifyInstance
  let auth: { cookie: string; csrfToken: string }
  let categoryId: string
  const teamIds: Record<string, string> = {}

  before(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sumobot-bracket-test-'))
    const dbPath = join(dir, 'test.db')
    await createMigratedDatabase(dbPath)
    db = new DatabaseConnection(`file:${dbPath}`)
    await db.client.$connect()

    await bootstrapAdmin(db.client, 'admin', 'admin-secret-password')

    server = buildServer({
      auth: { allowedOrigins: [origin], client: db.client },
      client: db.client,
    })
    auth = await login(server, 'admin', 'admin-secret-password')

    // Buat Kategori Sumo
    const catRes = await server.inject({
      headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
      method: 'POST',
      url: '/api/v1/categories',
      payload: { code: 'SUMO', label: 'Robot Sumo', enabled: true },
    })
    assert.equal(catRes.statusCode, 201)
    categoryId = catRes.json().id

    // Buat 10 Tim (Juara Grup A sampai J)
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
    for (const letter of letters) {
      const tmRes = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: '/api/v1/teams',
        payload: {
          categoryId,
          code: `SUMO-${letter}`,
          name: `Juara Grup ${letter}`,
          institution: null,
          groupId: null,
        },
      })
      assert.equal(tmRes.statusCode, 201)
      teamIds[letter] = tmRes.json().id
    }
  })

  after(async () => {
    await server.close()
    await db.client.$disconnect()
  })

  it('progresses R1 winners to Babak 2 and triangular Final', async () => {
    // 1. Commit Babak 1 matches (R1_AB, R1_CD, R1_EF, R1_GH, R1_IJ)
    const seedRes = await server.inject({
      headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/bracket-seed-commit`,
      payload: {
        matches: [
          { slotId: 'R1_AB', stageLabel: 'Babak 1 (Match 1)', teamAId: teamIds['A'], teamBId: teamIds['B'] },
          { slotId: 'R1_CD', stageLabel: 'Babak 1 (Match 2)', teamAId: teamIds['C'], teamBId: teamIds['D'] },
          { slotId: 'R1_EF', stageLabel: 'Babak 1 (Match 3)', teamAId: teamIds['E'], teamBId: teamIds['F'] },
          { slotId: 'R1_GH', stageLabel: 'Babak 1 (Match 4)', teamAId: teamIds['G'], teamBId: teamIds['H'] },
          { slotId: 'R1_IJ', stageLabel: 'Babak 1 (Match 5)', teamAId: teamIds['I'], teamBId: teamIds['J'] },
        ],
      },
    })
    assert.equal(seedRes.statusCode, 200)

    const finishMatch = async (slotId: string, winnerId: string) => {
      let match = await db.client.match.findFirstOrThrow({
        where: { categoryId, bracketSlot: slotId },
      })
      await db.client.match.update({
        where: { id: match.id },
        data: { phase: 'RESULT' },
      })
      match = await db.client.match.findUniqueOrThrow({ where: { id: match.id } })

      const draftId = randomUUID()
      await db.client.resultRevision.create({
        data: {
          id: draftId,
          matchId: match.id,
          revision: 1,
          status: 'DRAFT',
          winnerTeamId: winnerId,
          pointsA: winnerId === match.teamAId ? 3 : 0,
          pointsB: winnerId === match.teamBId ? 3 : 0,
        },
      })
      const res = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: `/api/v1/matches/${match.id}/commands`,
        payload: {
          action: 'result.finalize',
          draftRevisionId: draftId,
          expectedMatchVersion: match.matchVersion,
        },
      })
      if (res.statusCode !== 200) console.log('DEBUG 409:', res.statusCode, res.json())
      assert.equal(res.statusCode, 200)
    }

    // Match 1: Juara A vs Juara B -> Pemenang A
    await finishMatch('R1_AB', teamIds['A']!)
    // Match 2: Juara C vs Juara D -> Pemenang C
    await finishMatch('R1_CD', teamIds['C']!)

    // Setelah Match 1 & Match 2 selesai, R2_1 harus otomatis terbuat dengan Tim A vs Tim C!
    const r2_1 = await db.client.match.findFirst({
      where: { categoryId, bracketSlot: 'R2_1' },
    })
    assert.ok(r2_1, 'R2_1 harus dibuat otomatis')
    assert.equal(r2_1.teamAId, teamIds['A'])
    assert.equal(r2_1.teamBId, teamIds['C'])

    // Match 3: Juara E vs Juara F -> Pemenang E
    await finishMatch('R1_EF', teamIds['E']!)
    // Match 4: Juara G vs Juara H -> Pemenang G
    await finishMatch('R1_GH', teamIds['G']!)

    // Setelah Match 3 & Match 4 selesai, R2_2 harus otomatis terbuat dengan Tim E vs Tim G!
    const r2_2 = await db.client.match.findFirst({
      where: { categoryId, bracketSlot: 'R2_2' },
    })
    assert.ok(r2_2, 'R2_2 harus dibuat otomatis')
    assert.equal(r2_2.teamAId, teamIds['E'])
    assert.equal(r2_2.teamBId, teamIds['G'])

    // Match 5: Juara I vs Juara J -> Pemenang I (Tim Z)
    await finishMatch('R1_IJ', teamIds['I']!)

    // Selesaikan Babak 2 Match 1 (R2_1: A vs C) -> Pemenang A (Tim X)
    await finishMatch('R2_1', teamIds['A']!)

    // Selesaikan Babak 2 Match 2 (R2_2: E vs G) -> Pemenang E (Tim Y)
    await finishMatch('R2_2', teamIds['E']!)

    // Sekarang 3 Finalis adalah:
    // Tim X = Juara A
    // Tim Y = Juara E
    // Tim Z = Juara I
    // Ketiga pertandingan final segitiga (FINAL_1, FINAL_2, FINAL_3) harus otomatis terbuat!
    const final1 = await db.client.match.findFirst({
      where: { categoryId, bracketSlot: 'FINAL_1' },
    })
    const final2 = await db.client.match.findFirst({
      where: { categoryId, bracketSlot: 'FINAL_2' },
    })
    const final3 = await db.client.match.findFirst({
      where: { categoryId, bracketSlot: 'FINAL_3' },
    })

    assert.ok(final1, 'Final 1 (X vs Y) harus dibuat')
    assert.equal(final1.teamAId, teamIds['A']) // X
    assert.equal(final1.teamBId, teamIds['E']) // Y

    assert.ok(final2, 'Final 2 (X vs Z) harus dibuat')
    assert.equal(final2.teamAId, teamIds['A']) // X
    assert.equal(final2.teamBId, teamIds['I']) // Z

    assert.ok(final3, 'Final 3 (Y vs Z) harus dibuat')
    assert.equal(final3.teamAId, teamIds['E']) // Y
    assert.equal(final3.teamBId, teamIds['I']) // Z
  })

  it('progresses Soccer R1 + Grup K to Babak 2 and triangular Final', async () => {
    // Buat Kategori Soccer
    const catRes = await server.inject({
      headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
      method: 'POST',
      url: '/api/v1/categories',
      payload: { code: 'SOCCER', label: 'Robot Soccer', enabled: true },
    })
    assert.equal(catRes.statusCode, 201)
    const soccerCatId = catRes.json().id

    // Buat 11 Tim (Juara Grup A sampai K)
    const soccerTeamIds: Record<string, string> = {}
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']
    for (const letter of letters) {
      const tmRes = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: '/api/v1/teams',
        payload: {
          categoryId: soccerCatId,
          code: `SOCCER-${letter}`,
          name: `Juara Grup ${letter}`,
          institution: null,
          groupId: null,
        },
      })
      assert.equal(tmRes.statusCode, 201)
      soccerTeamIds[letter] = tmRes.json().id
    }

    // Commit Babak 1 matches (R1_AB, R1_CD, R1_EF, R1_GH, R1_IJ)
    const seedRes = await server.inject({
      headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
      method: 'POST',
      url: `/api/v1/categories/${soccerCatId}/bracket-seed-commit`,
      payload: {
        matches: [
          { slotId: 'R1_AB', stageLabel: 'Babak 1 (Match 1)', teamAId: soccerTeamIds['A'], teamBId: soccerTeamIds['B'] },
          { slotId: 'R1_CD', stageLabel: 'Babak 1 (Match 2)', teamAId: soccerTeamIds['C'], teamBId: soccerTeamIds['D'] },
          { slotId: 'R1_EF', stageLabel: 'Babak 1 (Match 3)', teamAId: soccerTeamIds['E'], teamBId: soccerTeamIds['F'] },
          { slotId: 'R1_GH', stageLabel: 'Babak 1 (Match 4)', teamAId: soccerTeamIds['G'], teamBId: soccerTeamIds['H'] },
          { slotId: 'R1_IJ', stageLabel: 'Babak 1 (Match 5)', teamAId: soccerTeamIds['I'], teamBId: soccerTeamIds['J'] },
        ],
      },
    })
    assert.equal(seedRes.statusCode, 200)

    const finishSoccerMatch = async (slotId: string, winnerId: string) => {
      let match = await db.client.match.findFirstOrThrow({
        where: { categoryId: soccerCatId, bracketSlot: slotId },
      })
      await db.client.match.update({
        where: { id: match.id },
        data: { phase: 'RESULT' },
      })
      match = await db.client.match.findUniqueOrThrow({ where: { id: match.id } })

      const draftId = randomUUID()
      await db.client.resultRevision.create({
        data: {
          id: draftId,
          matchId: match.id,
          revision: 1,
          status: 'DRAFT',
          winnerTeamId: winnerId,
          pointsA: winnerId === match.teamAId ? 3 : 0,
          pointsB: winnerId === match.teamBId ? 3 : 0,
        },
      })
      const res = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: `/api/v1/matches/${match.id}/commands`,
        payload: {
          action: 'result.finalize',
          draftRevisionId: draftId,
          expectedMatchVersion: match.matchVersion,
        },
      })
      assert.equal(res.statusCode, 200)
    }

    // Buat Grup K dan set timnya
    const grpK = await db.client.competitionGroup.create({
      data: {
        id: randomUUID(),
        categoryId: soccerCatId,
        name: 'Grup K',
      },
    })
    await db.client.groupMembership.create({
      data: {
        id: randomUUID(),
        categoryId: soccerCatId,
        groupId: grpK.id,
        teamId: soccerTeamIds['K']!,
      },
    })

    // Selesaikan Match 1 & Match 2
    await finishSoccerMatch('R1_AB', soccerTeamIds['A']!)
    await finishSoccerMatch('R1_CD', soccerTeamIds['C']!)

    const r2_1 = await db.client.match.findFirst({
      where: { categoryId: soccerCatId, bracketSlot: 'R2_1' },
    })
    assert.ok(r2_1, 'R2_1 (Soccer) harus dibuat otomatis')
    assert.equal(r2_1.teamAId, soccerTeamIds['A'])
    assert.equal(r2_1.teamBId, soccerTeamIds['C'])

    // Selesaikan Match 3 & Match 4
    await finishSoccerMatch('R1_EF', soccerTeamIds['E']!)
    await finishSoccerMatch('R1_GH', soccerTeamIds['G']!)

    const r2_2 = await db.client.match.findFirst({
      where: { categoryId: soccerCatId, bracketSlot: 'R2_2' },
    })
    assert.ok(r2_2, 'R2_2 (Soccer) harus dibuat otomatis')
    assert.equal(r2_2.teamAId, soccerTeamIds['E'])
    assert.equal(r2_2.teamBId, soccerTeamIds['G'])

    // Selesaikan Match 5 (R1_IJ) & Grup K
    // Karena Grup K belum ada match grup COMPLETED, set R2_3 manual atau pastikan group K punya winner
    // Simulasikan grup K selesai dengan tim K menang
    const dummyOpponent = await db.client.team.create({
      data: {
        id: randomUUID(),
        categoryId: soccerCatId,
        code: 'SOCCER-K2',
        name: 'Tim K2',
      },
    })
    await db.client.groupMembership.create({
      data: {
        id: randomUUID(),
        categoryId: soccerCatId,
        groupId: grpK.id,
        teamId: dummyOpponent.id,
      },
    })
    const grpKMatch = await db.client.match.create({
      data: {
        id: randomUUID(),
        categoryId: soccerCatId,
        groupId: grpK.id,
        sequence: 999,
        teamAId: soccerTeamIds['K']!,
        teamBId: dummyOpponent.id,
        status: 'COMPLETED',
        stage: 'GROUP',
      },
    })
    await db.client.resultRevision.create({
      data: {
        id: randomUUID(),
        matchId: grpKMatch.id,
        revision: 1,
        status: 'FINAL',
        winnerTeamId: soccerTeamIds['K']!,
        pointsA: 3,
        pointsB: 0,
      },
    })

    // Selesaikan Match 5
    await finishSoccerMatch('R1_IJ', soccerTeamIds['I']!)

    // R2_3 harus otomatis terbuat dengan Tim I (Winner M5) vs Tim K (Juara Grup K)
    const r2_3 = await db.client.match.findFirst({
      where: { categoryId: soccerCatId, bracketSlot: 'R2_3' },
    })
    assert.ok(r2_3, 'R2_3 (Soccer: Match 5 vs Grup K) harus dibuat otomatis')
    assert.equal(r2_3.teamAId, soccerTeamIds['I'])
    assert.equal(r2_3.teamBId, soccerTeamIds['K'])

    // Selesaikan ketiga pertandingan Babak 2
    await finishSoccerMatch('R2_1', soccerTeamIds['A']!) // Tim X
    await finishSoccerMatch('R2_2', soccerTeamIds['E']!) // Tim Y
    await finishSoccerMatch('R2_3', soccerTeamIds['K']!) // Tim Z

    // Ketiga pertandingan final segitiga (FINAL_1, FINAL_2, FINAL_3) harus otomatis terbuat!
    const final1 = await db.client.match.findFirst({
      where: { categoryId: soccerCatId, bracketSlot: 'FINAL_1' },
    })
    const final2 = await db.client.match.findFirst({
      where: { categoryId: soccerCatId, bracketSlot: 'FINAL_2' },
    })
    const final3 = await db.client.match.findFirst({
      where: { categoryId: soccerCatId, bracketSlot: 'FINAL_3' },
    })

    assert.ok(final1, 'Final 1 (Soccer: X vs Y) harus dibuat')
    assert.equal(final1.teamAId, soccerTeamIds['A']) // X
    assert.equal(final1.teamBId, soccerTeamIds['E']) // Y

    assert.ok(final2, 'Final 2 (Soccer: X vs Z) harus dibuat')
    assert.equal(final2.teamAId, soccerTeamIds['A']) // X
    assert.equal(final2.teamBId, soccerTeamIds['K']) // Z

    assert.ok(final3, 'Final 3 (Soccer: Y vs Z) harus dibuat')
    assert.equal(final3.teamAId, soccerTeamIds['E']) // Y
    assert.equal(final3.teamBId, soccerTeamIds['K']) // Z
  })

  it('automatically creates R1 knockout matches when paired groups complete in Sumo', async () => {
    // Buat Kategori Sumo baru
    const catRes = await server.inject({
      headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
      method: 'POST',
      url: '/api/v1/categories',
      payload: { code: 'SUMO_AUTO', label: 'Sumo Auto Test', enabled: true },
    })
    assert.equal(catRes.statusCode, 201)
    const autoCatId = catRes.json().id

    // Buat Grup A, B, E, F
    const grpLetters = ['A', 'B', 'E', 'F']
    const groupIds: Record<string, string> = {}
    for (const letter of grpLetters) {
      const gRes = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: '/api/v1/groups',
        payload: { categoryId: autoCatId, name: `Grup ${letter}` },
      })
      assert.equal(gRes.statusCode, 201)
      groupIds[letter] = gRes.json().id
    }

    // Buat 2 Tim per grup
    const teamMap: Record<string, { t1: string; t2: string }> = {}
    for (const letter of grpLetters) {
      const t1Res = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: '/api/v1/teams',
        payload: { categoryId: autoCatId, code: `TM-${letter}1`, name: `Tim ${letter} 1`, groupId: groupIds[letter] },
      })
      const t2Res = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: '/api/v1/teams',
        payload: { categoryId: autoCatId, code: `TM-${letter}2`, name: `Tim ${letter} 2`, groupId: groupIds[letter] },
      })
      assert.equal(t1Res.statusCode, 201)
      assert.equal(t2Res.statusCode, 201)
      teamMap[letter] = { t1: t1Res.json().id, t2: t2Res.json().id }
    }

    // Buat 1 match grup per grup
    let seq = 1
    const matchMap: Record<string, string> = {}
    for (const letter of grpLetters) {
      const mRes = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: '/api/v1/matches',
        payload: {
          categoryId: autoCatId,
          groupId: groupIds[letter]!,
          sequence: seq++,
          teamAId: teamMap[letter]!.t1,
          teamBId: teamMap[letter]!.t2,
        },
      })
      assert.equal(mRes.statusCode, 201)
      matchMap[letter] = mRes.json().id
    }

    const completeGroupMatch = async (matchId: string, winnerId: string) => {
      let m = await db.client.match.findUniqueOrThrow({ where: { id: matchId } })
      await db.client.match.update({
        where: { id: m.id },
        data: { phase: 'RESULT' },
      })
      m = await db.client.match.findUniqueOrThrow({ where: { id: m.id } })

      const draftId = randomUUID()
      await db.client.resultRevision.create({
        data: {
          id: draftId,
          matchId: m.id,
          revision: 1,
          status: 'DRAFT',
          winnerTeamId: winnerId,
          pointsA: winnerId === m.teamAId ? 3 : 0,
          pointsB: winnerId === m.teamBId ? 3 : 0,
        },
      })
      const res = await server.inject({
        headers: { cookie: auth.cookie, origin, 'x-csrf-token': auth.csrfToken },
        method: 'POST',
        url: `/api/v1/matches/${m.id}/commands`,
        payload: {
          action: 'result.finalize',
          draftRevisionId: draftId,
          expectedMatchVersion: m.matchVersion,
        },
      })
      assert.equal(res.statusCode, 200)
    }

    // 1. Selesaikan Match Grup A (Pemenang: Tim A 1)
    await completeGroupMatch(matchMap['A']!, teamMap['A']!.t1)

    // Slot R1_AB belum boleh dibuat karena Grup B belum selesai
    let r1_ab = await db.client.match.findFirst({
      where: { categoryId: autoCatId, bracketSlot: 'R1_AB' },
    })
    assert.equal(r1_ab, null, 'R1_AB belum boleh terbuat jika Grup B belum selesai')

    // 2. Selesaikan Match Grup B (Pemenang: Tim B 1)
    await completeGroupMatch(matchMap['B']!, teamMap['B']!.t1)

    // Sekarang R1_AB harus OTOMATIS dibuat dengan Tim A 1 vs Tim B 1!
    r1_ab = await db.client.match.findFirst({
      where: { categoryId: autoCatId, bracketSlot: 'R1_AB' },
    })
    assert.ok(r1_ab, 'R1_AB harus otomatis terbuat saat Grup A dan B selesai')
    assert.equal(r1_ab.teamAId, teamMap['A']!.t1)
    assert.equal(r1_ab.teamBId, teamMap['B']!.t1)
    assert.equal(r1_ab.stage, 'KNOCKOUT')
    assert.equal(r1_ab.status, 'SCHEDULED')

    // 3. Selesaikan Match Grup E (Arena 1 selesai, Grup F di Arena 2 belum selesai)
    await completeGroupMatch(matchMap['E']!, teamMap['E']!.t1)

    let r1_ef = await db.client.match.findFirst({
      where: { categoryId: autoCatId, bracketSlot: 'R1_EF' },
    })
    assert.equal(r1_ef, null, 'R1_EF belum boleh dibuat jika Grup F di Arena 2 belum selesai')

    // 4. Selesaikan Match Grup F (Arena 2 menyusul selesai)
    await completeGroupMatch(matchMap['F']!, teamMap['F']!.t1)

    r1_ef = await db.client.match.findFirst({
      where: { categoryId: autoCatId, bracketSlot: 'R1_EF' },
    })
    assert.ok(r1_ef, 'R1_EF harus otomatis terbuat saat Grup E dan F selesai')
    assert.equal(r1_ef.teamAId, teamMap['E']!.t1)
    assert.equal(r1_ef.teamBId, teamMap['F']!.t1)
    assert.equal(r1_ef.stage, 'KNOCKOUT')
  })
})
