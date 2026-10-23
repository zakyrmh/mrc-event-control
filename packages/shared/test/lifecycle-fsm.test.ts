import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateMatchTransition,
  FakeTimerPort,
  type TransitionContext,
} from '../src/browser.js'

describe('Match Lifecycle FSM & Guards (L-02 / TC-03 / TC-04 / TC-12)', () => {
  const operatorContext: TransitionContext = {
    role: 'OPERATOR',
    hasStarted: false,
    currentSegmentStatus: null,
    timerRunning: false,
    participantsReady: true,
  }

  const adminContext: TransitionContext = {
    role: 'SUPER_ADMIN',
    hasStarted: false,
    currentSegmentStatus: null,
    timerRunning: false,
    participantsReady: true,
  }

  describe('Normal Lifecycle Progression', () => {
    it('progresses from SCHEDULED to PREPARING on select', () => {
      const res = evaluateMatchTransition('SCHEDULED', 'PRE_MATCH', { type: 'select' }, operatorContext)
      assert.equal(res.allowed, true)
      assert.equal(res.targetStatus, 'PREPARING')
      assert.equal(res.targetPhase, 'PRE_MATCH')
    })

    it('advances through normal pre-match phases: CALLING -> VERIFICATION -> WARMUP -> READY', () => {
      const r1 = evaluateMatchTransition('PREPARING', 'PRE_MATCH', { type: 'phase.advance', targetPhase: 'CALLING' }, operatorContext)
      assert.equal(r1.allowed, true)
      assert.equal(r1.targetPhase, 'CALLING')

      const r2 = evaluateMatchTransition('PREPARING', 'CALLING', { type: 'phase.advance', targetPhase: 'VERIFICATION' }, operatorContext)
      assert.equal(r2.allowed, true)
      assert.equal(r2.targetPhase, 'VERIFICATION')

      const r3 = evaluateMatchTransition('PREPARING', 'VERIFICATION', { type: 'phase.advance', targetPhase: 'WARMUP' }, operatorContext)
      assert.equal(r3.allowed, true)
      assert.equal(r3.targetPhase, 'WARMUP')

      const r4 = evaluateMatchTransition('PREPARING', 'WARMUP', { type: 'phase.advance', targetPhase: 'READY' }, operatorContext)
      assert.equal(r4.allowed, true)
      assert.equal(r4.targetPhase, 'READY')
    })

    it('prepares first segment and starts competition: READY -> COMPETITION', () => {
      const prepRes = evaluateMatchTransition('PREPARING', 'READY', { type: 'segment.prepare' }, operatorContext)
      assert.equal(prepRes.allowed, true)

      const startRes = evaluateMatchTransition(
        'PREPARING',
        'READY',
        { type: 'start' },
        { ...operatorContext, currentSegmentStatus: 'PREPARED' },
      )
      assert.equal(startRes.allowed, true)
      assert.equal(startRes.targetStatus, 'IN_PROGRESS')
      assert.equal(startRes.targetPhase, 'COMPETITION')
    })

    it('pauses, resumes, enters intermission, and finalizes at result', () => {
      // Pause
      const pauseRes = evaluateMatchTransition('IN_PROGRESS', 'COMPETITION', { type: 'pause' }, operatorContext)
      assert.equal(pauseRes.allowed, true)
      assert.equal(pauseRes.targetStatus, 'PAUSED')

      // Resume start from paused
      const resumeRes = evaluateMatchTransition('PAUSED', 'COMPETITION', { type: 'start' }, { ...operatorContext, hasStarted: true })
      assert.equal(resumeRes.allowed, true)
      assert.equal(resumeRes.targetStatus, 'IN_PROGRESS')

      // Intermission
      const interRes = evaluateMatchTransition('IN_PROGRESS', 'COMPETITION', { type: 'phase.advance', targetPhase: 'INTERMISSION' }, operatorContext)
      assert.equal(interRes.allowed, true)
      assert.equal(interRes.targetPhase, 'INTERMISSION')

      // Result
      const resultRes = evaluateMatchTransition('IN_PROGRESS', 'COMPETITION', { type: 'phase.advance', targetPhase: 'RESULT' }, operatorContext)
      assert.equal(resultRes.allowed, true)
      assert.equal(resultRes.targetPhase, 'RESULT')

      // Finalize
      const finRes = evaluateMatchTransition('IN_PROGRESS', 'RESULT', { type: 'finalize' }, operatorContext)
      assert.equal(finRes.allowed, true)
      assert.equal(finRes.targetStatus, 'COMPLETED')
      assert.equal(finRes.targetPhase, 'FINISHED')

      // Finalize directly from COMPETITION when timer is not running
      const compFinRes = evaluateMatchTransition('IN_PROGRESS', 'COMPETITION', { type: 'finalize' }, operatorContext)
      assert.equal(compFinRes.allowed, true)
      assert.equal(compFinRes.targetStatus, 'COMPLETED')
      assert.equal(compFinRes.targetPhase, 'FINISHED')

      // Reject finalize if timer is running
      const blockedRes = evaluateMatchTransition('IN_PROGRESS', 'COMPETITION', { type: 'finalize' }, { ...operatorContext, timerRunning: true })
      assert.equal(blockedRes.allowed, false)
      assert.equal(blockedRes.errorCode, 'INVALID_TRANSITION')
    })
  })

  describe('TC-03: Prohibited Starts & Phase Jumps', () => {
    it('rejects jump directly from PRE_MATCH or WARMUP to COMPETITION without READY', () => {
      const jump1 = evaluateMatchTransition('PREPARING', 'PRE_MATCH', { type: 'phase.advance', targetPhase: 'COMPETITION' }, operatorContext)
      assert.equal(jump1.allowed, false)
      assert.equal(jump1.errorCode, 'INVALID_TRANSITION')

      const jump2 = evaluateMatchTransition('PREPARING', 'WARMUP', { type: 'phase.advance', targetPhase: 'COMPETITION' }, operatorContext)
      assert.equal(jump2.allowed, false)
      assert.equal(jump2.errorCode, 'INVALID_TRANSITION')
    })

    it('rejects start if segment status is not PREPARED', () => {
      const res = evaluateMatchTransition(
        'PREPARING',
        'READY',
        { type: 'start' },
        { ...operatorContext, currentSegmentStatus: null },
      )
      assert.equal(res.allowed, false)
      assert.equal(res.errorCode, 'INVALID_TRANSITION')
    })

    it('rejects start if participants are not ready', () => {
      const res = evaluateMatchTransition(
        'PREPARING',
        'READY',
        { type: 'start' },
        { ...operatorContext, currentSegmentStatus: 'PREPARED', participantsReady: false },
      )
      assert.equal(res.allowed, false)
      assert.equal(res.errorCode, 'INVALID_TRANSITION')
    })
  })

  describe('TC-04: Role, Reopen, and Override Boundaries', () => {
    it('allows phase override only with reason and authorityReference', () => {
      const invalid = evaluateMatchTransition(
        'PAUSED',
        'COMPETITION',
        { type: 'phase.override', targetPhase: 'WARMUP', reason: '', authorityReference: '' },
        operatorContext,
      )
      assert.equal(invalid.allowed, false)
      assert.equal(invalid.errorCode, 'INVALID_INPUT')

      const valid = evaluateMatchTransition(
        'PAUSED',
        'COMPETITION',
        { type: 'phase.override', targetPhase: 'WARMUP', reason: 'Juri minta pemanasan ulang', authorityReference: 'JURI-UTAMA-1' },
        operatorContext,
      )
      assert.equal(valid.allowed, true)
      assert.equal(valid.targetPhase, 'WARMUP')
    })

    it('rejects phase override while competition timer is still running', () => {
      const res = evaluateMatchTransition(
        'IN_PROGRESS',
        'COMPETITION',
        { type: 'phase.override', targetPhase: 'WARMUP', reason: 'Juri minta ulang', authorityReference: 'JURI-1' },
        { ...operatorContext, timerRunning: true },
      )
      assert.equal(res.allowed, false)
      assert.equal(res.errorCode, 'INVALID_TRANSITION')
    })

    it('forbids operator from reopening completed match, allows super-admin', () => {
      const opRes = evaluateMatchTransition(
        'COMPLETED',
        'FINISHED',
        { type: 'reopen', reason: 'Koreksi skor', authorityReference: 'JURI-1' },
        operatorContext,
      )
      assert.equal(opRes.allowed, false)
      assert.equal(opRes.errorCode, 'FORBIDDEN')

      const adminRes = evaluateMatchTransition(
        'COMPLETED',
        'FINISHED',
        { type: 'reopen', reason: 'Koreksi skor', authorityReference: 'JURI-1' },
        adminContext,
      )
      assert.equal(adminRes.allowed, true)
      assert.equal(adminRes.targetStatus, 'CORRECTION_PENDING')
    })
  })

  describe('TC-12: Arena Postpone, Release, & Invariants', () => {
    it('rejects release on in-progress match (must postpone)', () => {
      const res = evaluateMatchTransition('IN_PROGRESS', 'COMPETITION', { type: 'release' }, { ...operatorContext, hasStarted: true })
      assert.equal(res.allowed, false)
      assert.equal(res.errorCode, 'INVALID_TRANSITION')
    })

    it('resumes postponed match to PREPARING if not started, or PAUSED if started', () => {
      const notStarted = evaluateMatchTransition('POSTPONED', 'WARMUP', { type: 'select-resume' }, { ...operatorContext, hasStarted: false })
      assert.equal(notStarted.allowed, true)
      assert.equal(notStarted.targetStatus, 'PREPARING')

      const started = evaluateMatchTransition('POSTPONED', 'COMPETITION', { type: 'select-resume' }, { ...operatorContext, hasStarted: true })
      assert.equal(started.allowed, true)
      assert.equal(started.targetStatus, 'PAUSED')
    })
  })
})

describe('Timer Port Contract & Fake Port (L-03)', () => {
  it('prepares and starts timer, transitions state cleanly', async () => {
    const timer = new FakeTimerPort()
    const prep = await timer.prepare({ matchId: 'm-01', initialMs: 180_000, phaseType: 'COMPETITION' })
    assert.equal(prep.state, 'IDLE')
    assert.equal(prep.remainingMs, 180_000)
    assert.equal(prep.readinessToken, 'valid-readiness-token')

    const start = await timer.start({ readinessToken: prep.readinessToken })
    assert.equal(start.state, 'RUNNING')
    assert.ok(start.anchorWallUtc)

    const pause = await timer.pause()
    assert.equal(pause.state, 'PAUSED')

    const adjust = await timer.adjust({ deltaMs: -30_000, reason: 'Penalti waktu' })
    assert.equal(adjust.remainingMs, 150_000)
    assert.equal(adjust.elapsedMs, 30_000)

    const reset = await timer.reset({ reason: 'Juri minta ulang' })
    assert.equal(reset.state, 'IDLE')
    assert.equal(reset.remainingMs, 180_000)
  })
})
