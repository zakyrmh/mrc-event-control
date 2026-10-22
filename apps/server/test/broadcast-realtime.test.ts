import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client'
import { BroadcastService } from '../src/broadcast-service.js'
import { DatabaseConnection } from '../src/database.js'
import { createMigratedDatabase } from './helpers/migrations.js'


describe('Real-Time Broadcast & Resync Socket (004 O-02 / OB-02 / OB-03 / BC-01 s/d BC-05)', () => {
  let connection: DatabaseConnection
  let broadcastService: BroadcastService
  let httpServer: ReturnType<typeof createServer>
  let serverPort: number

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-bcast-'))
    const databasePath = join(directory, 'broadcast.db')

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
      runtimeId: 'test-bcast-runtime',
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

  it('connects to /overlay namespace and immediately receives state.snapshot (BC-02)', async () => {
    const socket: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}/overlay`, {
      transports: ['websocket'],
    })

    const snapshotPromise = new Promise<any>((resolve) => {
      socket.on('state.snapshot', (data) => {
        resolve(data)
      })
    })

    const snapshot = await snapshotPromise
    assert.equal(snapshot.runtimeId, 'test-bcast-runtime')
    assert.equal(snapshot.mode, 'AUTO')
    assert.equal(snapshot.safeDisplay, false)

    socket.disconnect()
  })

  it('receives periodic connection.heartbeat with committed revision and storage health (BC-01)', async () => {
    const socket: ClientSocketType = ClientSocket(`http://127.0.0.1:${serverPort}/overlay`, {
      transports: ['websocket'],
    })

    const heartbeatPromise = new Promise<any>((resolve) => {
      socket.on('connection.heartbeat', (data) => {
        resolve(data)
      })
    })

    const hb = await heartbeatPromise
    assert.equal(hb.runtimeId, 'test-bcast-runtime')
    assert.equal(hb.storageHealth, 'HEALTHY')
    assert.ok(typeof hb.committedBroadcastRevision === 'number')

    socket.disconnect()
  })

  it('records OBS telemetry and distinguishes SYNCHRONIZED from STALE without dashboard preview pollution (BC-02 / BC-05)', async () => {
    // Awal: belum ada telemetry -> status UNKNOWN
    const initialStatus = broadcastService.getObsStatusSummary()
    assert.equal(initialStatus.syncStatus, 'UNKNOWN')
    assert.equal(initialStatus.obsConnected, false)

    // Kirim telemetri dari dashboard preview saja (clientRole = DASHBOARD_PREVIEW)
    broadcastService.recordTelemetry({
      clientInstanceId: 'preview-1',
      clientRole: 'DASHBOARD_PREVIEW',
      runtimeId: 'test-bcast-runtime',
      lastReceivedRevision: 1,
      lastRenderedRevision: 1,
    })

    // Invariant: telemetry preview TIDAK menyehatkan status OBS nyata!
    const afterPreviewStatus = broadcastService.getObsStatusSummary()
    assert.equal(afterPreviewStatus.syncStatus, 'UNKNOWN')
    assert.equal(afterPreviewStatus.obsConnected, false)

    // Sekarang kirim telemetri dari OBS Browser Source asli
    broadcastService.recordTelemetry({
      clientInstanceId: 'obs-browser-source-1',
      clientRole: 'OBS_BROWSER_SOURCE',
      runtimeId: 'test-bcast-runtime',
      lastReceivedRevision: 1,
      lastRenderedRevision: 1,
      renderLatencyMs: 16.5,
    })

    const afterObsStatus = broadcastService.getObsStatusSummary()
    assert.equal(afterObsStatus.obsConnected, true)
    assert.equal(afterObsStatus.syncStatus, 'SYNCHRONIZED')
    assert.equal(afterObsStatus.lastRenderedRevision, 1)

    // Bump server broadcast revision (misal terjadi gol di lapangan)
    broadcastService.projection.bumpBroadcastRevision()
    const updatedStatus = broadcastService.getObsStatusSummary()
    // Karena renderedRevision (1) < committedRevision (2) dan masih baru -> SYNCING
    assert.equal(updatedStatus.syncStatus, 'SYNCING')
  })
})
