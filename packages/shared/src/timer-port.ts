export type TimerState =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'EXPIRED'
  | 'RECOVERY_REQUIRED'

export interface TimerSnapshot {
  id: string
  matchId: string
  segmentAttemptId: string | null
  phaseType: string
  state: TimerState
  initialMs: number
  remainingMs: number
  elapsedMs: number
  anchorWallUtc: string | null
  checkpointWallUtc: string | null
  timerGeneration: number
  checkpointSeq: number
  storageHealth: 'HEALTHY' | 'DEGRADED' | 'RECOVERY_PENDING'
  readinessToken?: string | null
}

export interface PrepareTimerOptions {
  matchId: string
  segmentAttemptId?: string | null
  phaseType: string
  initialMs: number
  actorId?: string | null
}

export interface StartTimerOptions {
  readinessToken?: string | null
  actorId?: string | null
}

export interface AdjustTimerOptions {
  deltaMs: number
  reason: string
  actorId?: string | null
}

export interface ResetTimerOptions {
  reason: string
  actorId?: string | null
}

export interface ReconcileTimerOptions {
  resolution: 'accept_elapsed' | 'restore_anchor' | 'custom_offset'
  offsetMs?: number
  reason: string
  authorityReference?: string
  actorId?: string | null
}

/**
 * Port interface for communication between Match Lifecycle and Timer Engine.
 * Defined in 002 (L-03) and implemented in 003 (TE-01/TE-02).
 */
export interface TimerPort {
  prepare(options: PrepareTimerOptions): Promise<TimerSnapshot>
  start(options?: StartTimerOptions): Promise<TimerSnapshot>
  pause(): Promise<TimerSnapshot>
  freeze(): Promise<TimerSnapshot>
  adjust(options: AdjustTimerOptions): Promise<TimerSnapshot>
  reset(options: ResetTimerOptions): Promise<TimerSnapshot>
  getSnapshot(): Promise<TimerSnapshot>
  reconcile(options: ReconcileTimerOptions): Promise<TimerSnapshot>
}

/**
 * Deterministic fake timer port for testing Match Lifecycle state transitions
 * and guards in isolation before the real timer engine (003) is integrated.
 */
export class FakeTimerPort implements TimerPort {
  private snapshot: TimerSnapshot

  constructor(initial?: Partial<TimerSnapshot>) {
    this.snapshot = {
      id: initial?.id ?? 'fake-timer-1',
      matchId: initial?.matchId ?? 'fake-match-1',
      segmentAttemptId: initial?.segmentAttemptId ?? null,
      phaseType: initial?.phaseType ?? 'COMPETITION',
      state: initial?.state ?? 'IDLE',
      initialMs: initial?.initialMs ?? 300_000,
      remainingMs: initial?.remainingMs ?? 300_000,
      elapsedMs: initial?.elapsedMs ?? 0,
      anchorWallUtc: initial?.anchorWallUtc ?? null,
      checkpointWallUtc: initial?.checkpointWallUtc ?? null,
      timerGeneration: initial?.timerGeneration ?? 1,
      checkpointSeq: initial?.checkpointSeq ?? 1,
      storageHealth: initial?.storageHealth ?? 'HEALTHY',
      readinessToken: initial?.readinessToken ?? 'valid-readiness-token',
    }
  }

  async prepare(options: PrepareTimerOptions): Promise<TimerSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      matchId: options.matchId,
      segmentAttemptId: options.segmentAttemptId ?? null,
      phaseType: options.phaseType,
      initialMs: options.initialMs,
      remainingMs: options.initialMs,
      elapsedMs: 0,
      state: 'IDLE',
      readinessToken: 'valid-readiness-token',
      timerGeneration: this.snapshot.timerGeneration + 1,
    }
    return this.snapshot
  }

  async start(_options?: StartTimerOptions): Promise<TimerSnapshot> {
    if (this.snapshot.state === 'RECOVERY_REQUIRED') {
      throw new Error('TIMER_RECOVERY_REQUIRED')
    }
    this.snapshot = {
      ...this.snapshot,
      state: 'RUNNING',
      anchorWallUtc: new Date().toISOString(),
      readinessToken: null,
    }
    return this.snapshot
  }

  async pause(): Promise<TimerSnapshot> {
    if (this.snapshot.state === 'RUNNING') {
      this.snapshot = {
        ...this.snapshot,
        state: 'PAUSED',
      }
    }
    return this.snapshot
  }

  async freeze(): Promise<TimerSnapshot> {
    if (this.snapshot.state === 'RUNNING') {
      this.snapshot = {
        ...this.snapshot,
        state: this.snapshot.remainingMs === 0 ? 'EXPIRED' : 'PAUSED',
      }
    }
    return this.snapshot
  }

  async adjust(options: AdjustTimerOptions): Promise<TimerSnapshot> {
    const nextRemaining = Math.max(0, this.snapshot.remainingMs + options.deltaMs)
    this.snapshot = {
      ...this.snapshot,
      remainingMs: nextRemaining,
      elapsedMs: Math.max(0, this.snapshot.initialMs - nextRemaining),
      state: nextRemaining === 0 ? 'EXPIRED' : this.snapshot.state,
    }
    return this.snapshot
  }

  async reset(_options: ResetTimerOptions): Promise<TimerSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      remainingMs: this.snapshot.initialMs,
      elapsedMs: 0,
      state: 'IDLE',
    }
    return this.snapshot
  }

  async getSnapshot(): Promise<TimerSnapshot> {
    return this.snapshot
  }

  async reconcile(_options: ReconcileTimerOptions): Promise<TimerSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      state: 'PAUSED',
      storageHealth: 'HEALTHY',
    }
    return this.snapshot
  }
}
