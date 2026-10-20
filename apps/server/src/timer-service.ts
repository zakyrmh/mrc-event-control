import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import {
  type Clock,
  systemClock,
  TimerEngine,
  type TimerPort,
  type TimerSnapshot,
  type PrepareTimerOptions,
  type StartTimerOptions,
  type AdjustTimerOptions,
  type ResetTimerOptions,
  type ReconcileTimerOptions,
} from '@mrc-x/shared'

export interface TimerServiceOptions {
  client: PrismaClient
  runtimeId?: string
  clock?: Clock
}

/**
 * Server Timer Service and RealTimerPort implementation (003 E-04 s/d E-07).
 * Atomically manages TimerInstance persistence, monotonic engine runtime, and startup recovery.
 */
export class TimerService implements TimerPort {
  private readonly client: PrismaClient
  public readonly runtimeId: string
  private readonly clock: Clock
  private activeEngine: TimerEngine | null = null
  private storageHealth: 'HEALTHY' | 'DEGRADED' | 'RECOVERY_PENDING' = 'HEALTHY'

  constructor(options: TimerServiceOptions) {
    this.client = options.client
    this.runtimeId = options.runtimeId ?? randomUUID()
    this.clock = options.clock ?? systemClock
  }

  setStorageHealth(health: 'HEALTHY' | 'DEGRADED' | 'RECOVERY_PENDING'): void {
    this.storageHealth = health
    if (this.activeEngine) {
      this.activeEngine.setStorageHealth(health)
    }
  }

  getStorageHealth(): 'HEALTHY' | 'DEGRADED' | 'RECOVERY_PENDING' {
    return this.storageHealth
  }

  /**
   * E-06: Startup reconciliation.
   * If any timer was RUNNING during a previous ungraceful shutdown/restart,
   * it must transition to RECOVERY_REQUIRED. It must never auto-resume.
   */
  async startupReconcile(): Promise<{ recoveredCount: number }> {
    const runningTimers = await this.client.timerInstance.findMany({
      where: { state: 'RUNNING' },
    })

    if (runningTimers.length === 0) {
      return { recoveredCount: 0 }
    }

    await this.client.$transaction(async (tx) => {
      for (const t of runningTimers) {
        await tx.timerInstance.update({
          where: { id: t.id },
          data: {
            state: 'RECOVERY_REQUIRED',
            timerGeneration: t.timerGeneration + 1,
            runtimeId: this.runtimeId,
            checkpointWallUtc: new Date(this.clock.nowWallUtc()),
          },
        })

        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'timer.recovery_required',
            resourceType: 'TimerInstance',
            resourceId: t.id,
            actorId: null,
            beforeJson: JSON.stringify({ state: t.state, generation: t.timerGeneration }),
            afterJson: JSON.stringify({ state: 'RECOVERY_REQUIRED', generation: t.timerGeneration + 1 }),
          },
        })

        // Also ensure match is paused if started
        const match = await tx.match.findUnique({ where: { id: t.matchId } })
        if (match && match.hasStarted && match.status === 'IN_PROGRESS') {
          await tx.match.update({
            where: { id: match.id },
            data: { status: 'PAUSED' },
          })
        }
      }
    })

    return { recoveredCount: runningTimers.length }
  }

  async prepare(options: PrepareTimerOptions): Promise<TimerSnapshot> {
    if (this.storageHealth === 'DEGRADED') {
      throw new Error('STORAGE_DEGRADED')
    }

    const timerId = randomUUID()
    const engine = new TimerEngine({
      id: timerId,
      matchId: options.matchId,
      segmentAttemptId: options.segmentAttemptId ?? null,
      phaseType: options.phaseType,
      initialMs: options.initialMs,
      clock: this.clock,
      state: 'IDLE',
      storageHealth: this.storageHealth,
    })

    const snapshot = engine.getSnapshot()

    await this.client.$transaction(async (tx) => {
      await tx.timerInstance.create({
        data: {
          id: timerId,
          matchId: options.matchId,
          segmentAttemptId: options.segmentAttemptId ?? null,
          type: options.phaseType,
          state: snapshot.state,
          initialMs: snapshot.initialMs,
          remainingAtAnchorMs: snapshot.remainingMs,
          runtimeId: this.runtimeId,
          checkpointSeq: snapshot.checkpointSeq,
          timerGeneration: snapshot.timerGeneration,
          storageHealth: this.storageHealth,
          checkpointWallUtc: new Date(this.clock.nowWallUtc()),
        },
      })

      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          action: 'timer.prepare',
          resourceType: 'TimerInstance',
          resourceId: timerId,
          actorId: options.actorId ?? null,
          afterJson: JSON.stringify(snapshot),
        },
      })
    })

    this.activeEngine = engine
    return snapshot
  }

  async start(options?: StartTimerOptions): Promise<TimerSnapshot> {
    if (this.storageHealth === 'DEGRADED') {
      throw new Error('STORAGE_DEGRADED')
    }
    if (!this.activeEngine) {
      throw new Error('NO_ACTIVE_TIMER_ENGINE')
    }

    const snapshot = this.activeEngine.start(options?.readinessToken)

    await this.client.$transaction(async (tx) => {
      await tx.timerInstance.update({
        where: { id: snapshot.id },
        data: {
          state: snapshot.state,
          remainingAtAnchorMs: snapshot.remainingMs,
          anchorWallUtc: snapshot.anchorWallUtc ? new Date(snapshot.anchorWallUtc) : null,
          checkpointWallUtc: snapshot.checkpointWallUtc ? new Date(snapshot.checkpointWallUtc) : null,
          checkpointSeq: snapshot.checkpointSeq,
          runtimeId: this.runtimeId,
        },
      })

      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          action: 'timer.start',
          resourceType: 'TimerInstance',
          resourceId: snapshot.id,
          actorId: options?.actorId ?? null,
          afterJson: JSON.stringify(snapshot),
        },
      })
    })

    return snapshot
  }

  async pause(): Promise<TimerSnapshot> {
    if (this.storageHealth === 'DEGRADED') {
      throw new Error('STORAGE_DEGRADED')
    }
    if (!this.activeEngine) {
      throw new Error('NO_ACTIVE_TIMER_ENGINE')
    }

    const snapshot = this.activeEngine.pause()

    await this.client.$transaction(async (tx) => {
      await tx.timerInstance.update({
        where: { id: snapshot.id },
        data: {
          state: snapshot.state,
          remainingAtAnchorMs: snapshot.remainingMs,
          checkpointWallUtc: snapshot.checkpointWallUtc ? new Date(snapshot.checkpointWallUtc) : null,
          checkpointSeq: snapshot.checkpointSeq,
        },
      })

      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          action: 'timer.pause',
          resourceType: 'TimerInstance',
          resourceId: snapshot.id,
          actorId: null,
          afterJson: JSON.stringify(snapshot),
        },
      })
    })

    return snapshot
  }

  async freeze(): Promise<TimerSnapshot> {
    return this.pause()
  }

  async adjust(options: AdjustTimerOptions): Promise<TimerSnapshot> {
    if (this.storageHealth === 'DEGRADED') {
      throw new Error('STORAGE_DEGRADED')
    }
    if (!this.activeEngine) {
      throw new Error('NO_ACTIVE_TIMER_ENGINE')
    }

    const snapshot = this.activeEngine.adjust(options.deltaMs)

    await this.client.$transaction(async (tx) => {
      await tx.timerInstance.update({
        where: { id: snapshot.id },
        data: {
          state: snapshot.state,
          remainingAtAnchorMs: snapshot.remainingMs,
          checkpointWallUtc: snapshot.checkpointWallUtc ? new Date(snapshot.checkpointWallUtc) : null,
          checkpointSeq: snapshot.checkpointSeq,
        },
      })

      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          action: 'timer.adjust',
          resourceType: 'TimerInstance',
          resourceId: snapshot.id,
          actorId: options.actorId ?? null,
          afterJson: JSON.stringify({ deltaMs: options.deltaMs, reason: options.reason, snapshot }),
        },
      })
    })

    return snapshot
  }

  async reset(options: ResetTimerOptions): Promise<TimerSnapshot> {
    if (this.storageHealth === 'DEGRADED') {
      throw new Error('STORAGE_DEGRADED')
    }
    if (!this.activeEngine) {
      throw new Error('NO_ACTIVE_TIMER_ENGINE')
    }

    const snapshot = this.activeEngine.reset()

    await this.client.$transaction(async (tx) => {
      await tx.timerInstance.update({
        where: { id: snapshot.id },
        data: {
          state: snapshot.state,
          remainingAtAnchorMs: snapshot.remainingMs,
          checkpointWallUtc: snapshot.checkpointWallUtc ? new Date(snapshot.checkpointWallUtc) : null,
          checkpointSeq: snapshot.checkpointSeq,
        },
      })

      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          action: 'timer.reset',
          resourceType: 'TimerInstance',
          resourceId: snapshot.id,
          actorId: options.actorId ?? null,
          afterJson: JSON.stringify({ reason: options.reason, snapshot }),
        },
      })
    })

    return snapshot
  }

  async checkpoint(): Promise<TimerSnapshot> {
    if (!this.activeEngine) {
      throw new Error('NO_ACTIVE_TIMER_ENGINE')
    }
    const snapshot = this.activeEngine.checkpoint()
    if (snapshot.state === 'RUNNING' || snapshot.state === 'EXPIRED') {
      await this.client.timerInstance.update({
        where: { id: snapshot.id },
        data: {
          state: snapshot.state,
          remainingAtAnchorMs: snapshot.remainingMs,
          checkpointWallUtc: snapshot.checkpointWallUtc ? new Date(snapshot.checkpointWallUtc) : null,
          checkpointSeq: snapshot.checkpointSeq,
        },
      })
    }
    return snapshot
  }

  async reconcile(options: ReconcileTimerOptions): Promise<TimerSnapshot> {
    if (!this.activeEngine) {
      throw new Error('NO_ACTIVE_TIMER_ENGINE')
    }

    const currentRemaining = this.activeEngine.getSnapshot().remainingMs
    let targetRemaining = currentRemaining
    if (options.resolution === 'custom_offset' && typeof options.offsetMs === 'number') {
      targetRemaining = Math.max(0, currentRemaining + options.offsetMs)
    }

    const snapshot = this.activeEngine.reconcile(targetRemaining)

    await this.client.$transaction(async (tx) => {
      await tx.timerInstance.update({
        where: { id: snapshot.id },
        data: {
          state: snapshot.state,
          remainingAtAnchorMs: snapshot.remainingMs,
          storageHealth: 'HEALTHY',
          checkpointWallUtc: snapshot.checkpointWallUtc ? new Date(snapshot.checkpointWallUtc) : null,
          checkpointSeq: snapshot.checkpointSeq,
        },
      })

      await tx.auditEntry.create({
        data: {
          id: randomUUID(),
          action: 'timer.reconcile',
          resourceType: 'TimerInstance',
          resourceId: snapshot.id,
          actorId: options.actorId ?? null,
          beforeJson: JSON.stringify({ state: 'RECOVERY_REQUIRED' }),
          afterJson: JSON.stringify({
            resolution: options.resolution,
            offsetMs: options.offsetMs,
            reason: options.reason,
            authorityReference: options.authorityReference,
            snapshot,
          }),
        },
      })
    })

    this.storageHealth = 'HEALTHY'
    return snapshot
  }

  async getSnapshot(): Promise<TimerSnapshot> {
    if (this.activeEngine) {
      return this.activeEngine.getSnapshot()
    }
    throw new Error('NO_ACTIVE_TIMER_ENGINE')
  }

  armReadinessToken(token: string): void {
    if (!this.activeEngine) {
      throw new Error('NO_ACTIVE_TIMER_ENGINE')
    }
    this.activeEngine.armReadinessToken(token)
  }
}
