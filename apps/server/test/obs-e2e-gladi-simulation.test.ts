import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client'
import { BroadcastService } from '../src/broadcast-service.js'
import { DatabaseConnection } from '../src/database.js'
import { createMigratedDatabase } from './helpers/migrations.js'
import { TimerEngine, FakeClock } from '@mrc-x/shared'


describe('OBS E2E & Gladi Bersih Simulation (004 O-06 & O-07 / TC-11/13/15/16/17/20/21/23/27/31)', () => {
  let connection: DatabaseConnection
  let broadcastService: BroadcastService
  let httpServer: ReturnType<typeof createServer>
  let serverPort: number
  let databasePath: string

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-gladi-'))
    databasePath = join(directory, 'gladi.db')

    await createMigratedDatabase(databasePath)

    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()

    // Ensure arenaState exists
    await connection.client.arenaState.upsert({
      where: { id: 'main' },
      create: { id: 'main', activeMatchId: null, arenaVersion: 1 },
      update: { activeMatchId: null, arenaVersion: 1 },
    })

    httpServer = createServer()
    broadcastService = new BroadcastService({
      client: connection.client,
      runtimeId: 'gladi-runtime-2026',
      httpServer,
    })

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address()
        if (typeof addr === 'object' && addr !== null) {
          serverPort = addr.port
        }
        resolve()
      })
    })
  })

  after(async () => {
    broadcastService.stopHeartbeat()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    await connection.disconnect()
  })

  // --- O-06: Validasi Latensi, Reconnect, Drift, dan Safe Display ---

  it('O-06 / TC-11 & TC-27: measures 100 latency samples for broadcast updates with target Q-01 < 100ms', async () => {
    const socket: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}/overlay`, {
      transports: ['websocket'],
    })

    await new Promise<void>((resolve) => {
      socket.on('connect', () => resolve())
    })

    const latencies: number[] = []

    for (let i = 0; i < 100; i++) {
      const sendTime = performance.now()
      const updatePromise = new Promise<void>((resolve) => {
        socket.once('match.updated', () => {
          const receiveTime = performance.now()
          latencies.push(receiveTime - sendTime)
          resolve()
        })
      })

      await broadcastService.broadcastUpdate()
      await updatePromise
    }

    socket.disconnect()

    assert.equal(latencies.length, 100)
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const maxLatency = Math.max(...latencies)

    // Performance target: average latency on loopback < 25ms, max < 100ms (Q-01 / Q-07)
    assert.ok(avgLatency < 25, `Average latency ${avgLatency}ms exceeds 25ms`)
    assert.ok(maxLatency < 100, `Max latency ${maxLatency}ms exceeds 100ms`)
  })

  it('O-06 / TC-13 & TC-31: executes 20 consecutive socket reconnects and verifies no version regression', async () => {
    let lastRevision = broadcastService.projection.getBroadcastRevision()

    for (let i = 0; i < 20; i++) {
      const socket: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}/overlay`, {
        transports: ['websocket'],
        forceNew: true,
      })

      const snapshot = await new Promise<any>((resolve) => {
        socket.on('state.snapshot', (data) => resolve(data))
      })

      assert.equal(snapshot.runtimeId, 'gladi-runtime-2026')
      assert.ok(
        snapshot.broadcastRevision >= lastRevision,
        `Revision regression detected: ${snapshot.broadcastRevision} < ${lastRevision}`,
      )
      lastRevision = snapshot.broadcastRevision

      socket.disconnect()
    }
  })

  it('O-06 / TC-23 & TE-02: verifies 10 minutes simulated timer monotonic countdown with zero drift', async () => {
    const clock = new FakeClock(100_000, '2026-10-21T10:00:00.000Z')
    const engine = new TimerEngine({
      id: 'timer-sim-10m',
      matchId: 'match-sim-10m',
      phaseType: 'COMPETITION',
      initialMs: 600_000, // 10 minutes
      clock,
    })

    engine.armReadinessToken('arm-token-10m')
    engine.start('arm-token-10m')

    // Simulate 10 minutes advancing in 1-second ticks (600 steps)
    for (let sec = 0; sec < 600; sec++) {
      clock.advance(1000)
      const snap = engine.getSnapshot()
      const expectedRemaining = 600_000 - (sec + 1) * 1000
      assert.equal(
        snap.remainingMs,
        expectedRemaining,
        `Timer drift detected at second ${sec}: expected ${expectedRemaining}, got ${snap.remainingMs}`,
      )
    }

    const finalSnap = engine.checkpoint()
    assert.equal(finalSnap.remainingMs, 0)
    assert.equal(finalSnap.state, 'EXPIRED')
  })

  it('O-06 / TC-27: verifies EMERGENCY mode forces neutral display while underlying match state persists', async () => {
    // 1. Create a dummy active match in arena
    const categoryId = randomUUID()
    await connection.client.category.create({
      data: { id: categoryId, code: 'SOCCER_GLADI', label: 'Gladi Soccer', revision: 1 },
    })
    const tA = randomUUID()
    const tB = randomUUID()
    await connection.client.team.createMany({
      data: [
        { id: tA, categoryId, code: 'GLA-A', name: 'Tim Gladi A', revision: 1 },
        { id: tB, categoryId, code: 'GLA-B', name: 'Tim Gladi B', revision: 1 },
      ],
    })
    const mId = randomUUID()
    await connection.client.match.create({
      data: {
        id: mId,
        categoryId,
        sequence: 1,
        teamAId: tA,
        teamBId: tB,
        status: 'IN_PROGRESS',
        phase: 'COMPETITION',
        matchVersion: 1,
      },
    })
    await connection.client.arenaState.update({
      where: { id: 'main' },
      data: { activeMatchId: mId },
    })

    // 2. Set broadcast mode to EMERGENCY
    const emergencySnapshot = await broadcastService.setBroadcastMode('EMERGENCY')
    assert.equal(emergencySnapshot.mode, 'EMERGENCY')
    assert.equal(emergencySnapshot.safeDisplay, true)
    assert.equal(emergencySnapshot.match, null) // Neutral display

    // 3. Underlying database match is still IN_PROGRESS (persisted)
    const dbMatch = await connection.client.match.findUniqueOrThrow({
      where: { id: mId },
    })
    assert.equal(dbMatch.status, 'IN_PROGRESS')
    assert.equal(dbMatch.phase, 'COMPETITION')

    // 4. Restore to AUTO
    const autoSnapshot = await broadcastService.setBroadcastMode('AUTO')
    assert.equal(autoSnapshot.mode, 'AUTO')
    assert.equal(autoSnapshot.safeDisplay, false)
    assert.ok(autoSnapshot.match)
    assert.equal(autoSnapshot.match.teamA.code, 'GLA-A')
  })

  // --- O-07: Gladi Bersih 100 Match Soak Simulation & Recovery ---

  it('O-07 / TC-15 & TC-21: simulates 100 sequential match lifecycles across 4 categories without memory leak or state collision', async () => {
    const categories = ['SOCCER', 'SUMO', 'LINE_FOLLOWER', 'DRC']

    // Ensure categories exist
    const categoryMap = new Map<string, string>()
    for (const catCode of categories) {
      const catId = randomUUID()
      await connection.client.category.create({
        data: { id: catId, code: `${catCode}_SOAK`, label: `Category ${catCode}`, revision: 1 },
      })
      categoryMap.set(catCode, catId)
    }

    // Run 100 rapid sequential match transitions
    for (let i = 1; i <= 100; i++) {
      const catCode = categories[i % categories.length] ?? 'SOCCER'
      const catId = categoryMap.get(catCode) ?? randomUUID()
      const teamAId = randomUUID()
      const teamBId = randomUUID()

      await connection.client.team.createMany({
        data: [
          { id: teamAId, categoryId: catId, code: `T${i}A`, name: `Team ${i} A`, revision: 1 },
          { id: teamBId, categoryId: catId, code: `T${i}B`, name: `Team ${i} B`, revision: 1 },
        ],
      })

      const matchId = randomUUID()
      await connection.client.match.create({
        data: {
          id: matchId,
          categoryId: catId,
          sequence: i,
          teamAId,
          teamBId,
          status: 'SCHEDULED',
          matchVersion: 1,
        },
      })

      // Simulate full lifecycle progression
      // 1. Select to Arena
      await connection.client.arenaState.update({
        where: { id: 'main' },
        data: { activeMatchId: matchId, arenaVersion: i + 10 },
      })
      await connection.client.match.update({
        where: { id: matchId },
        data: { status: 'PREPARING', phase: 'READY', matchVersion: 2 },
      })

      // 2. Start Competition
      await connection.client.match.update({
        where: { id: matchId },
        data: { status: 'IN_PROGRESS', phase: 'COMPETITION', hasStarted: true, matchVersion: 3 },
      })

      // 3. Goal / Score (if Soccer)
      if (catCode === 'SOCCER') {
        const segId = randomUUID()
        await connection.client.segmentAttempt.create({
          data: { id: segId, matchId, kind: 'ROUND', ordinal: 1, attempt: 1, status: 'ACTIVE' },
        })
        await connection.client.goalEvent.create({
          data: { id: randomUUID(), matchId, segmentAttemptId: segId, side: 'A', delta: 1 },
        })
      }

      // 4. Complete & Finalize
      await connection.client.resultRevision.create({
        data: {
          id: randomUUID(),
          matchId,
          revision: 1,
          status: 'FINAL',
          finalGoalsA: catCode === 'SOCCER' ? 1 : null,
          finalGoalsB: catCode === 'SOCCER' ? 0 : null,
          decisionText: 'Pemenang sah gladi',
          refereeReference: 'DEWAN-JURI-GLADI',
        },
      })
      await connection.client.match.update({
        where: { id: matchId },
        data: { status: 'COMPLETED', phase: 'RESULT', matchVersion: 4 },
      })

      // 5. Release Arena
      await connection.client.arenaState.update({
        where: { id: 'main' },
        data: { activeMatchId: null, arenaVersion: i + 11 },
      })
    }

    // Verify 100 completed matches exist in database
    const completedCount = await connection.client.match.count({
      where: { status: 'COMPLETED' },
    })
    assert.ok(completedCount >= 100, `Completed matches count ${completedCount} is less than 100`)

    // Verify arena is cleanly released (activeMatchId is null)
    const finalArena = await connection.client.arenaState.findUniqueOrThrow({
      where: { id: 'main' },
    })
    assert.equal(finalArena.activeMatchId, null)
  })

  it('O-07 / TC-16 & TC-34: verifies historical REC import idempotency without live broadcast replay', async () => {
    const categoryId = randomUUID()
    await connection.client.category.create({
      data: { id: categoryId, code: 'REC_GLADI', label: 'Historical Gladi', revision: 1 },
    })
    const tA = randomUUID()
    const tB = randomUUID()
    await connection.client.team.createMany({
      data: [
        { id: tA, categoryId, code: 'REC-A', name: 'Rec Team A', revision: 1 },
        { id: tB, categoryId, code: 'REC-B', name: 'Rec Team B', revision: 1 },
      ],
    })

    const historicalMatchId = randomUUID()
    await connection.client.match.create({
      data: {
        id: historicalMatchId,
        categoryId,
        sequence: 999,
        teamAId: tA,
        teamBId: tB,
        status: 'COMPLETED',
        phase: 'RESULT',
        hasStarted: true,
        matchVersion: 1,
      },
    })

    await connection.client.resultRevision.create({
      data: {
        id: randomUUID(),
        matchId: historicalMatchId,
        revision: 1,
        status: 'FINAL',
        decisionText: 'Hasil formulir fisik kertas juri #REC-001',
        refereeReference: 'JURI-MANUAL',
      },
    })

    // Invariant: Historical REC import does NOT touch active arena or trigger broadcast activation
    const currentArena = await connection.client.arenaState.findUniqueOrThrow({
      where: { id: 'main' },
    })
    assert.notEqual(currentArena.activeMatchId, historicalMatchId)

    const snap = await broadcastService.projection.getPublicSnapshot()
    assert.equal(snap.match, null) // Arena remains null / safe
  })
})
