import type { TimerSnapshot, TimerState } from './timer-port.js'

export interface Clock {
  nowMonoMs(): number
  nowWallUtc(): string
}

export const systemClock: Clock = {
  nowMonoMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return Math.floor(performance.now())
    }
    if (typeof process !== 'undefined' && process.hrtime?.bigint) {
      return Number(process.hrtime.bigint() / 1_000_000n)
    }
    return Date.now()
  },
  nowWallUtc(): string {
    return new Date().toISOString()
  },
}

export class FakeClock implements Clock {
  private monoMs: number
  private wallUtc: string

  constructor(initialMonoMs = 100_000, initialWallUtc = '2026-10-21T10:00:00.000Z') {
    this.monoMs = initialMonoMs
    this.wallUtc = initialWallUtc
  }

  nowMonoMs(): number {
    return this.monoMs
  }

  nowWallUtc(): string {
    return this.wallUtc
  }

  advance(ms: number): void {
    this.monoMs += ms
    const nextDate = new Date(new Date(this.wallUtc).getTime() + ms)
    this.wallUtc = nextDate.toISOString()
  }

  setWallUtc(newWallUtc: string): void {
    this.wallUtc = newWallUtc
  }
}

export interface TimerEngineOptions {
  id: string
  matchId: string
  segmentAttemptId?: string | null
  phaseType: string
  initialMs: number
  clock?: Clock
  state?: TimerState
  remainingAtAnchorMs?: number
  anchorWallUtc?: string | null
  checkpointWallUtc?: string | null
  timerGeneration?: number
  checkpointSeq?: number
  storageHealth?: 'HEALTHY' | 'DEGRADED' | 'RECOVERY_PENDING'
  readinessToken?: string | null
}

/**
 * Pure Monotonic Timer Engine (E-01 / E-02 / TE-02 / TE-03).
 * Operates purely in integer milliseconds with zero external I/O.
 */
export class TimerEngine {
  private readonly id: string
  private readonly matchId: string
  private segmentAttemptId: string | null
  private readonly phaseType: string
  private readonly initialMs: number
  private readonly clock: Clock

  private state: TimerState
  private remainingAtAnchorMs: number
  private monoAnchorMs: number | null = null
  private anchorWallUtc: string | null = null
  private checkpointWallUtc: string | null = null
  private timerGeneration: number
  private checkpointSeq: number
  private storageHealth: 'HEALTHY' | 'DEGRADED' | 'RECOVERY_PENDING'
  private readinessToken: string | null = null

  constructor(options: TimerEngineOptions) {
    if (options.initialMs <= 0) {
      throw new Error('INITIAL_MS_MUST_BE_POSITIVE')
    }
    this.id = options.id
    this.matchId = options.matchId
    this.segmentAttemptId = options.segmentAttemptId ?? null
    this.phaseType = options.phaseType
    this.initialMs = options.initialMs
    this.clock = options.clock ?? systemClock

    this.state = options.state ?? 'IDLE'
    this.remainingAtAnchorMs = options.remainingAtAnchorMs ?? options.initialMs
    this.anchorWallUtc = options.anchorWallUtc ?? null
    this.checkpointWallUtc = options.checkpointWallUtc ?? null
    this.timerGeneration = options.timerGeneration ?? 1
    this.checkpointSeq = options.checkpointSeq ?? 1
    this.storageHealth = options.storageHealth ?? 'HEALTHY'
    this.readinessToken = options.readinessToken ?? null

    if (this.state === 'RUNNING') {
      this.monoAnchorMs = this.clock.nowMonoMs()
    }
  }

  getSnapshot(): TimerSnapshot {
    const currentRemaining = this.calculateRemainingMs()
    return {
      id: this.id,
      matchId: this.matchId,
      segmentAttemptId: this.segmentAttemptId,
      phaseType: this.phaseType,
      state: this.state,
      initialMs: this.initialMs,
      remainingMs: currentRemaining,
      elapsedMs: Math.max(0, this.initialMs - currentRemaining),
      anchorWallUtc: this.anchorWallUtc,
      checkpointWallUtc: this.checkpointWallUtc,
      timerGeneration: this.timerGeneration,
      checkpointSeq: this.checkpointSeq,
      storageHealth: this.storageHealth,
      readinessToken: this.readinessToken,
    }
  }

  calculateRemainingMs(): number {
    if (this.state !== 'RUNNING') {
      return this.remainingAtAnchorMs
    }
    if (this.monoAnchorMs === null) {
      return this.remainingAtAnchorMs
    }
    const elapsedMono = Math.max(0, this.clock.nowMonoMs() - this.monoAnchorMs)
    return Math.max(0, this.remainingAtAnchorMs - elapsedMono)
  }

  armReadinessToken(token: string): void {
    if (this.state === 'RECOVERY_REQUIRED') {
      throw new Error('TIMER_RECOVERY_REQUIRED')
    }
    this.readinessToken = token
  }

  start(providedToken?: string | null): TimerSnapshot {
    if (this.storageHealth === 'DEGRADED') {
      throw new Error('STORAGE_DEGRADED')
    }
    if (this.state === 'RECOVERY_REQUIRED') {
      throw new Error('TIMER_RECOVERY_REQUIRED')
    }
    if (this.state === 'RUNNING') {
      return this.getSnapshot()
    }
    if (this.state === 'PAUSED' && !providedToken) {
      return this.resume()
    }
    if (this.state !== 'IDLE' && this.state !== 'STOPPED' && this.state !== 'PAUSED') {
      throw new Error(`CANNOT_START_FROM_${this.state}`)
    }
    if (this.remainingAtAnchorMs <= 0) {
      throw new Error('CANNOT_START_WITH_ZERO_REMAINING')
    }

    // In competition, check readiness token
    if (this.phaseType === 'COMPETITION') {
      if (!this.readinessToken || this.readinessToken !== providedToken) {
        throw new Error('INVALID_READINESS_TOKEN')
      }
    }

    this.monoAnchorMs = this.clock.nowMonoMs()
    this.anchorWallUtc = this.clock.nowWallUtc()
    this.checkpointWallUtc = this.anchorWallUtc
    this.state = 'RUNNING'
    this.readinessToken = null // Consumed on start
    return this.getSnapshot()
  }

  resume(): TimerSnapshot {
    if (this.storageHealth === 'DEGRADED') {
      throw new Error('STORAGE_DEGRADED')
    }
    if (this.state === 'RECOVERY_REQUIRED') {
      throw new Error('TIMER_RECOVERY_REQUIRED')
    }
    if (this.state === 'RUNNING') {
      return this.getSnapshot()
    }
    if (this.state !== 'PAUSED' && this.state !== 'STOPPED') {
      throw new Error(`CANNOT_RESUME_FROM_${this.state}`)
    }
    if (this.remainingAtAnchorMs <= 0) {
      throw new Error('CANNOT_START_WITH_ZERO_REMAINING')
    }
    this.monoAnchorMs = this.clock.nowMonoMs()
    this.anchorWallUtc = this.clock.nowWallUtc()
    this.checkpointWallUtc = this.anchorWallUtc
    this.state = 'RUNNING'
    return this.getSnapshot()
  }

  pause(): TimerSnapshot {
    if (this.state !== 'RUNNING') {
      return this.getSnapshot()
    }
    const currentRemaining = this.calculateRemainingMs()
    this.remainingAtAnchorMs = currentRemaining
    this.monoAnchorMs = null
    this.state = currentRemaining === 0 ? 'EXPIRED' : 'PAUSED'
    this.checkpointWallUtc = this.clock.nowWallUtc()
    return this.getSnapshot()
  }

  freeze(): TimerSnapshot {
    return this.pause()
  }

  stop(): TimerSnapshot {
    if (this.state === 'RUNNING') {
      this.pause()
    }
    if (this.state === 'EXPIRED') {
      return this.getSnapshot()
    }
    this.state = this.remainingAtAnchorMs === 0 ? 'EXPIRED' : 'STOPPED'
    this.checkpointWallUtc = this.clock.nowWallUtc()
    return this.getSnapshot()
  }

  reset(): TimerSnapshot {
    if (this.state === 'RECOVERY_REQUIRED') {
      throw new Error('TIMER_RECOVERY_REQUIRED')
    }
    this.remainingAtAnchorMs = this.initialMs
    this.monoAnchorMs = null
    this.state = 'IDLE'
    this.readinessToken = null
    this.checkpointWallUtc = this.clock.nowWallUtc()
    return this.getSnapshot()
  }

  adjust(deltaMs: number): TimerSnapshot {
    if (this.state === 'RECOVERY_REQUIRED') {
      throw new Error('TIMER_RECOVERY_REQUIRED')
    }
    const current = this.calculateRemainingMs()
    const next = current + deltaMs
    if (next < 0) {
      throw new Error('NEGATIVE_REMAINING_FORBIDDEN')
    }

    this.remainingAtAnchorMs = next
    this.checkpointWallUtc = this.clock.nowWallUtc()

    if (this.state === 'RUNNING') {
      this.monoAnchorMs = this.clock.nowMonoMs()
      if (next === 0) {
        this.state = 'EXPIRED'
        this.monoAnchorMs = null
      }
    } else if (this.state === 'EXPIRED' && next > 0) {
      this.state = 'PAUSED'
    }

    return this.getSnapshot()
  }

  setDuration(durationMs: number): TimerSnapshot {
    if (durationMs < 0) {
      throw new Error('NEGATIVE_REMAINING_FORBIDDEN')
    }
    return this.adjust(durationMs - this.calculateRemainingMs())
  }

  checkpoint(): TimerSnapshot {
    if (this.state === 'RUNNING') {
      const remaining = this.calculateRemainingMs()
      this.checkpointSeq += 1
      this.checkpointWallUtc = this.clock.nowWallUtc()
      if (remaining === 0) {
        this.remainingAtAnchorMs = 0
        this.monoAnchorMs = null
        this.state = 'EXPIRED'
      }
    }
    return this.getSnapshot()
  }

  markRecoveryRequired(): TimerSnapshot {
    const current = this.calculateRemainingMs()
    this.remainingAtAnchorMs = current
    this.monoAnchorMs = null
    this.state = 'RECOVERY_REQUIRED'
    this.timerGeneration += 1
    this.checkpointWallUtc = this.clock.nowWallUtc()
    return this.getSnapshot()
  }

  reconcile(remainingMs: number): TimerSnapshot {
    if (remainingMs < 0) {
      throw new Error('NEGATIVE_REMAINING_FORBIDDEN')
    }
    this.remainingAtAnchorMs = remainingMs
    this.monoAnchorMs = null
    this.state = remainingMs === 0 ? 'EXPIRED' : 'PAUSED'
    this.storageHealth = 'HEALTHY'
    this.checkpointWallUtc = this.clock.nowWallUtc()
    return this.getSnapshot()
  }

  setStorageHealth(health: 'HEALTHY' | 'DEGRADED' | 'RECOVERY_PENDING'): void {
    this.storageHealth = health
  }
}
