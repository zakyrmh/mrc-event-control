import type { Server as HttpServer } from 'node:http'
import type { PrismaClient } from '@prisma/client'
import { Server, type Namespace, type Socket } from 'socket.io'
import type {
  BroadcastMode,
  ObsTelemetryInput,
  PublicBroadcastSnapshot,
} from '@mrc-x/shared'
import { ProjectionService } from './projection-service.js'
import type { TimerService } from './timer-service.js'

export interface BroadcastServiceOptions {
  client: PrismaClient
  timerService?: TimerService
  runtimeId?: string
  httpServer?: HttpServer
  allowedOrigins?: readonly string[]
}

export interface ObsStatusSummary {
  serverConnected: boolean
  obsConnected: boolean
  syncStatus: 'SYNCHRONIZED' | 'SYNCING' | 'STALE' | 'DISCONNECTED' | 'UNKNOWN'
  lastRenderedRevision: number
  committedRevision: number
  lastAckReceivedAt: string | null
  renderLatencyMs: number | null
}

export class BroadcastService {
  public readonly projection: ProjectionService
  public readonly runtimeId: string
  private readonly timerService?: TimerService
  private overlayNs?: Namespace
  private heartbeatInterval?: NodeJS.Timeout
  private latestObsTelemetry: (ObsTelemetryInput & { receivedAt: Date }) | null = null
  private latestPreviewTelemetry: (ObsTelemetryInput & { receivedAt: Date }) | null = null

  constructor(options: BroadcastServiceOptions) {
    this.runtimeId = options.runtimeId ?? 'runtime-default'
    this.timerService = options.timerService
    this.projection = new ProjectionService({
      client: options.client,
      timerService: options.timerService,
      runtimeId: this.runtimeId,
    })

    if (options.httpServer) {
      this.attachHttpServer(options.httpServer, options.allowedOrigins)
    }
  }

  attachHttpServer(httpServer: HttpServer, allowedOrigins?: readonly string[]): void {
    // Gunakan server yang ada atau buat instance socket.io
    const io = new Server(httpServer, {
      cors: {
        origin: allowedOrigins ? [...allowedOrigins] : '*',
        credentials: true,
      },
    })
    this.attachSocketServer(io)
  }

  attachSocketServer(io: Server): void {
    this.overlayNs = io.of('/overlay')

    this.overlayNs.on('connection', async (socket: Socket) => {
      const arenaId = (socket.handshake.query.arena as string) || undefined
      if (arenaId) {
        socket.join(`arena:${arenaId}`)
      }
      // Saat connect, kirim snapshot penuh terbaru (OB-03 / BC-02)
      const snapshot = await this.projection.getPublicSnapshot(arenaId)
      socket.emit('state.snapshot', snapshot)

      socket.on('overlay.rendered', (data: ObsTelemetryInput) => {
        this.recordTelemetry(data)
      })
    })

    this.startHeartbeat()
  }

  startHeartbeat(intervalMs: number = 1000): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }

    this.heartbeatInterval = setInterval(async () => {
      try {
        const serverNowUtc = new Date().toISOString()
        const committedBroadcastRevision = this.projection.getBroadcastRevision()

        this.overlayNs?.emit('connection.heartbeat', {
          runtimeId: this.runtimeId,
          serverNowUtc,
          committedBroadcastRevision,
          storageHealth: 'HEALTHY',
        })

        if (this.timerService) {
          try {
            const snap = await this.timerService.getSnapshot()
            if (snap.state === 'RUNNING') {
              this.broadcastTimerSync({
                timerId: snap.id,
                timerGeneration: snap.timerGeneration,
                syncSeq: snap.checkpointSeq,
                state: snap.state,
                remainingMs: snap.remainingMs,
                serverNowUtc,
              })
            }
          } catch {
            // no active running timer
          }
        }
      } catch {
        // Silently catch to avoid crashing server process
      }
    }, intervalMs)

    this.heartbeatInterval.unref()
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }
  }

  async broadcastUpdate(arenaId?: string): Promise<PublicBroadcastSnapshot> {
    this.projection.bumpBroadcastRevision()
    const snapshot = await this.projection.getPublicSnapshot(arenaId)
    this.overlayNs?.emit('match.updated', snapshot)
    return snapshot
  }

  broadcastTimerSync(payload: {
    timerId: string | null
    timerGeneration: number
    syncSeq: number
    state: string
    remainingMs: number
    serverNowUtc: string
  }): void {
    this.overlayNs?.emit('timer.sync', payload)
  }

  recordTelemetry(data: ObsTelemetryInput): void {
    const entry = { ...data, receivedAt: new Date() }
    if (data.clientRole === 'OBS_BROWSER_SOURCE') {
      this.latestObsTelemetry = entry
    } else {
      this.latestPreviewTelemetry = entry
    }
  }

  getPreviewTelemetry(): (ObsTelemetryInput & { receivedAt: Date }) | null {
    return this.latestPreviewTelemetry
  }

  getObsStatusSummary(): ObsStatusSummary {
    const now = Date.now()
    const committedRevision = this.projection.getBroadcastRevision()

    if (!this.latestObsTelemetry) {
      return {
        serverConnected: true,
        obsConnected: false,
        syncStatus: 'UNKNOWN',
        lastRenderedRevision: 0,
        committedRevision,
        lastAckReceivedAt: null,
        renderLatencyMs: null,
      }
    }

    const ageMs = now - this.latestObsTelemetry.receivedAt.getTime()
    const isObsAlive = ageMs < 5000 // Disconnect threshold 5 detik
    const renderedRev = this.latestObsTelemetry.lastRenderedRevision

    let syncStatus: ObsStatusSummary['syncStatus'] = 'SYNCHRONIZED'

    if (!isObsAlive) {
      syncStatus = 'DISCONNECTED'
    } else if (renderedRev < committedRevision) {
      // Jika tertinggal lebih dari 3 detik -> STALE, jika di bawah 3 detik -> SYNCING (BC-03)
      syncStatus = ageMs >= 3000 ? 'STALE' : 'SYNCING'
    }

    return {
      serverConnected: true,
      obsConnected: isObsAlive,
      syncStatus,
      lastRenderedRevision: renderedRev,
      committedRevision,
      lastAckReceivedAt: this.latestObsTelemetry.receivedAt.toISOString(),
      renderLatencyMs: this.latestObsTelemetry.renderLatencyMs ?? null,
    }
  }

  setBroadcastMode(mode: BroadcastMode): Promise<PublicBroadcastSnapshot> {
    this.projection.setBroadcastMode(mode)
    return this.broadcastUpdate()
  }
}
