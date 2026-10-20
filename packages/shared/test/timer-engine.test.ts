import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FakeClock, TimerEngine } from '../src/browser.js'

describe('Pure Monotonic Timer Engine (E-01 / E-02 / TE-02 / TE-03)', () => {
  it('initializes cleanly in IDLE with initialMs and calculates remaining', () => {
    const clock = new FakeClock()
    const engine = new TimerEngine({
      id: 'timer-1',
      matchId: 'match-1',
      phaseType: 'WARMUP',
      initialMs: 60_000,
      clock,
    })

    const snap = engine.getSnapshot()
    assert.equal(snap.state, 'IDLE')
    assert.equal(snap.remainingMs, 60_000)
    assert.equal(snap.elapsedMs, 0)
    assert.equal(snap.storageHealth, 'HEALTHY')
  })

  it('runs countdown using monotonic clock, immune to wall clock jumps', () => {
    const clock = new FakeClock(100_000, '2026-10-21T10:00:00.000Z')
    const engine = new TimerEngine({
      id: 'timer-1',
      matchId: 'match-1',
      phaseType: 'WARMUP',
      initialMs: 60_000,
      clock,
    })

    engine.start()
    assert.equal(engine.getSnapshot().state, 'RUNNING')

    // Advance monotonic clock by 15 seconds
    clock.advance(15_000)
    assert.equal(engine.calculateRemainingMs(), 45_000)

    // JUMP wall clock by 2 hours into the future (e.g. NTP sync)
    clock.setWallUtc('2026-10-21T12:00:00.000Z')
    // Remaining MUST still be 45_000 because monotonic did not change!
    assert.equal(engine.calculateRemainingMs(), 45_000)

    // Advance monotonic by 5 seconds
    clock.advance(5_000)
    assert.equal(engine.calculateRemainingMs(), 40_000)

    // Pause
    const paused = engine.pause()
    assert.equal(paused.state, 'PAUSED')
    assert.equal(paused.remainingMs, 40_000)
    assert.equal(paused.elapsedMs, 20_000)
  })

  it('enforces readinessToken for COMPETITION start and invalidates it once started', () => {
    const clock = new FakeClock()
    const engine = new TimerEngine({
      id: 'timer-1',
      matchId: 'match-1',
      phaseType: 'COMPETITION',
      initialMs: 180_000,
      clock,
    })

    // Starting without token must fail
    assert.throws(() => engine.start(), /INVALID_READINESS_TOKEN/)

    // Arm token
    engine.armReadinessToken('token-abc-123')
    assert.equal(engine.getSnapshot().readinessToken, 'token-abc-123')

    // Start with wrong token fails
    assert.throws(() => engine.start('wrong-token'), /INVALID_READINESS_TOKEN/)

    // Start with correct token succeeds
    const running = engine.start('token-abc-123')
    assert.equal(running.state, 'RUNNING')
    // Token is now consumed
    assert.equal(running.readinessToken, null)
  })

  it('expires cleanly at 0 remaining and clamps elapsed', () => {
    const clock = new FakeClock()
    const engine = new TimerEngine({
      id: 'timer-1',
      matchId: 'match-1',
      phaseType: 'WARMUP',
      initialMs: 10_000,
      clock,
    })

    engine.start()
    clock.advance(15_000) // Overshoot by 5s

    assert.equal(engine.calculateRemainingMs(), 0)
    const snap = engine.checkpoint()
    assert.equal(snap.state, 'EXPIRED')
    assert.equal(snap.remainingMs, 0)
    assert.equal(snap.elapsedMs, 10_000)
  })

  it('handles adjust (add/subtract) with boundary checks', () => {
    const clock = new FakeClock()
    const engine = new TimerEngine({
      id: 'timer-1',
      matchId: 'match-1',
      phaseType: 'WARMUP',
      initialMs: 60_000,
      clock,
    })

    // Subtract 20s
    const adj1 = engine.adjust(-20_000)
    assert.equal(adj1.remainingMs, 40_000)

    // Subtracting more than remaining must throw
    assert.throws(() => engine.adjust(-50_000), /NEGATIVE_REMAINING_FORBIDDEN/)

    // Add 30s
    const adj2 = engine.adjust(30_000)
    assert.equal(adj2.remainingMs, 70_000)
  })

  it('handles recovery required and reconciliation by referee', () => {
    const clock = new FakeClock()
    const engine = new TimerEngine({
      id: 'timer-1',
      matchId: 'match-1',
      phaseType: 'COMPETITION',
      initialMs: 180_000,
      clock,
    })

    engine.armReadinessToken('token-1')
    engine.start('token-1')
    clock.advance(30_000)

    // Unexpected power cut / storage crash simulation
    const recovered = engine.markRecoveryRequired()
    assert.equal(recovered.state, 'RECOVERY_REQUIRED')
    assert.equal(recovered.remainingMs, 150_000)
    assert.equal(recovered.timerGeneration, 2)

    // Cannot start while in recovery required
    assert.throws(() => engine.start(), /TIMER_RECOVERY_REQUIRED/)

    // Referee reconciles to 140s remaining
    const reconciled = engine.reconcile(140_000)
    assert.equal(reconciled.state, 'PAUSED')
    assert.equal(reconciled.remainingMs, 140_000)

    // Resume requires new readiness token for competition
    engine.armReadinessToken('token-2')
    const resumed = engine.start('token-2')
    assert.equal(resumed.state, 'RUNNING')
    assert.equal(resumed.remainingMs, 140_000)
  })
})
