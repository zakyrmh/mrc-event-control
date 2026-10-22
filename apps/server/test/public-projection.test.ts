import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { DatabaseConnection } from '../src/database.js'
import { createMigratedDatabase } from './helpers/migrations.js'
import { ProjectionService } from '../src/projection-service.js'


describe('Public Broadcast Projection & Sanitization (004 O-01 / OB-01 / OB-04)', () => {
  let connection: DatabaseConnection
  let projectionService: ProjectionService

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-proj-'))
    const databasePath = join(directory, 'projection.db')

    await createMigratedDatabase(databasePath)

    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()

    projectionService = new ProjectionService({
      client: connection.client,
      runtimeId: 'test-runtime-proj',
    })
  })

  after(async () => {
    await connection.disconnect()
  })

  it('returns clean WAITING snapshot when no match is active in arena', async () => {
    await connection.client.arenaState.upsert({
      where: { id: 'main' },
      create: { id: 'main', activeMatchId: null, arenaVersion: 1 },
      update: { activeMatchId: null, arenaVersion: 1 },
    })

    const snapshot = await projectionService.getPublicSnapshot()
    assert.equal(snapshot.runtimeId, 'test-runtime-proj')
    assert.equal(snapshot.match, null)
    assert.equal(snapshot.mode, 'AUTO')
    assert.equal(snapshot.safeDisplay, false)

    // Verify sanitization: no private fields
    const jsonString = JSON.stringify(snapshot)
    assert.equal(jsonString.includes('password'), false)
    assert.equal(jsonString.includes('csrfToken'), false)
    assert.equal(jsonString.includes('sessionHash'), false)
    assert.equal(jsonString.includes('auditEntry'), false)
  })

  it('projects SOCCER match with scores, segment, and display mode without leaking private fields', async () => {
    const categoryId = randomUUID()
    await connection.client.category.create({
      data: { id: categoryId, code: 'SOCCER', label: 'Robot Soccer', revision: 1 },
    })

    const teamAId = randomUUID()
    const teamBId = randomUUID()
    await connection.client.team.createMany({
      data: [
        { id: teamAId, categoryId, code: 'SOC-A', name: 'Garuda Soccer', institution: 'Kampus A', revision: 1 },
        { id: teamBId, categoryId, code: 'SOC-B', name: 'Elang Soccer', institution: 'Kampus B', revision: 1 },
      ],
    })

    const matchId = randomUUID()
    await connection.client.match.create({
      data: {
        id: matchId,
        categoryId,
        sequence: 1,
        teamAId,
        teamBId,
        status: 'IN_PROGRESS',
        phase: 'COMPETITION',
        hasStarted: true,
        matchVersion: 1,
      },
    })

    const segId = randomUUID()
    await connection.client.segmentAttempt.create({
      data: {
        id: segId,
        matchId,
        kind: 'ROUND',
        ordinal: 1,
        attempt: 1,
        status: 'ACTIVE',
      },
    })

    // Record goals: 3 for A, 1 for B
    await connection.client.goalEvent.createMany({
      data: [
        { id: randomUUID(), matchId, segmentAttemptId: segId, side: 'A', delta: 1 },
        { id: randomUUID(), matchId, segmentAttemptId: segId, side: 'A', delta: 1 },
        { id: randomUUID(), matchId, segmentAttemptId: segId, side: 'A', delta: 1 },
        { id: randomUUID(), matchId, segmentAttemptId: segId, side: 'B', delta: 1 },
      ],
    })

    // Set arena to this match
    await connection.client.arenaState.update({
      where: { id: 'main' },
      data: { activeMatchId: matchId, arenaVersion: 2 },
    })

    const snapshot = await projectionService.getPublicSnapshot()
    assert.ok(snapshot.match)
    assert.equal(snapshot.match.matchId, matchId)
    assert.equal(snapshot.match.category.code, 'SOCCER')
    assert.equal(snapshot.match.teamA.code, 'SOC-A')
    assert.equal(snapshot.match.teamB.code, 'SOC-B')
    assert.equal(snapshot.match.scoreA, 3)
    assert.equal(snapshot.match.scoreB, 1)
    assert.equal(snapshot.match.displayMode, 'Pertandingan')
    assert.equal(snapshot.match.isOfficialResult, false)
    assert.equal(snapshot.match.officialWinnerSide, null)

    // Invariant: no private details
    const serialized = JSON.stringify(snapshot)
    assert.equal(serialized.includes('audit'), false)
    assert.equal(serialized.includes('actorId'), false)
    assert.equal(serialized.includes('authorityReference'), false)
  })

  it('projects non-soccer categories (SUMO, LINE_FOLLOWER, DRC) correctly', async () => {
    const testCategories: ReadonlyArray<readonly [string, string]> = [
      ['SUMO', 'Robot Sumo 3kg'],
      ['LINE_FOLLOWER', 'Line Follower Analog'],
      ['DRC', 'Drone Racing Challenge'],
    ]
    for (const [code, label] of testCategories) {
      const catId = randomUUID()
      await connection.client.category.create({
        data: { id: catId, code, label, revision: 1 },
      })
      const tA = randomUUID()
      const tB = randomUUID()
      await connection.client.team.createMany({
        data: [
          { id: tA, categoryId: catId, code: `${code}-A`, name: `Team A ${code}`, revision: 1 },
          { id: tB, categoryId: catId, code: `${code}-B`, name: `Team B ${code}`, revision: 1 },
        ],
      })
      const mId = randomUUID()
      await connection.client.match.create({
        data: {
          id: mId,
          categoryId: catId,
          sequence: 2,
          teamAId: tA,
          teamBId: tB,
          status: 'PREPARING',
          phase: 'READY',
          matchVersion: 1,
        },
      })

      await connection.client.arenaState.update({
        where: { id: 'main' },
        data: { activeMatchId: mId },
      })

      const snap = await projectionService.getPublicSnapshot()
      assert.ok(snap.match)
      assert.equal(snap.match.category.code, code)
      assert.equal(snap.match.displayMode, 'Siap Pertandingan')
      assert.equal(snap.match.scoreA, null) // non-soccer with 0 score is null
      assert.equal(snap.match.scoreB, null)
    }
  })

  it('identifies official winner side only after finalization (COMPLETED + finalized revision)', async () => {
    const categoryId = randomUUID()
    await connection.client.category.create({
      data: { id: categoryId, code: 'SOCCER_FINAL', label: 'Soccer Final', revision: 1 },
    })
    const tA = randomUUID()
    const tB = randomUUID()
    await connection.client.team.createMany({
      data: [
        { id: tA, categoryId, code: 'FIN-A', name: 'Team A', revision: 1 },
        { id: tB, categoryId, code: 'FIN-B', name: 'Team B', revision: 1 },
      ],
    })
    const matchId = randomUUID()
    await connection.client.match.create({
      data: {
        id: matchId,
        categoryId,
        sequence: 10,
        teamAId: tA,
        teamBId: tB,
        status: 'COMPLETED',
        phase: 'RESULT',
        hasStarted: true,
        matchVersion: 5,
      },
    })

    // Create finalized result revision
    await connection.client.resultRevision.create({
      data: {
        id: randomUUID(),
        matchId,
        revision: 1,
        status: 'FINAL',
        finalGoalsA: 2,
        finalGoalsB: 4,
        decisionText: 'Tim B menang mutlak',
        refereeReference: 'DEWAN-JURI',
      },
    })

    await connection.client.arenaState.update({
      where: { id: 'main' },
      data: { activeMatchId: matchId },
    })

    const snap = await projectionService.getPublicSnapshot()
    assert.ok(snap.match)
    assert.equal(snap.match.isOfficialResult, true)
    assert.equal(snap.match.officialWinnerSide, 'B')
    assert.equal(snap.match.displayMode, 'Selesai')
  })

  it('renders EMERGENCY safe display mode immediately without changing underlying match state', async () => {
    projectionService.setBroadcastMode('EMERGENCY')
    assert.equal(projectionService.getBroadcastMode(), 'EMERGENCY')

    const snap = await projectionService.getPublicSnapshot()
    assert.equal(snap.safeDisplay, true)
    assert.equal(snap.mode, 'EMERGENCY')
    assert.equal(snap.match, null) // Neutral broadcast hiding match details during emergency

    // Restore to AUTO
    projectionService.setBroadcastMode('AUTO')
    const restored = await projectionService.getPublicSnapshot()
    assert.equal(restored.safeDisplay, false)
    assert.equal(restored.mode, 'AUTO')
    assert.ok(restored.match)
  })
})
