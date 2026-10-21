import { useEffect, useState, useCallback } from 'react'
import { OverlayDisplay } from './OverlayDisplay'
import './OperatorDashboard.css'

interface Team {
  id: string
  code: string
  name: string
  institution?: string | null
}

interface SegmentAttempt {
  id: string
  kind: string
  ordinal: number
  attempt: number
  status: string
  durationMs?: number | null
}

interface MatchDetail {
  id: string
  matchVersion: number
  status: string
  phase: string | null
  hasStarted: boolean
  categoryId: string
  teamAId: string
  teamBId: string
  teamA: Team
  teamB: Team
  category: { id: string; code: string; label: string }
  segments: SegmentAttempt[]
  score: { goalsA: number; goalsB: number }
  goalIntents: Array<{ id: string; status: string }>
}

interface ArenaData {
  id: string
  activeMatchId: string | null
  arenaVersion: number
}

interface ScheduledMatch {
  id: string
  sequence: number
  matchVersion: number
  status: string
  teamA: Team
  teamB: Team
}

export function OperatorDashboard() {
  const [arena, setArena] = useState<ArenaData | null>(null)
  const [activeMatch, setActiveMatch] = useState<MatchDetail | null>(null)
  const [scheduledMatches, setScheduledMatches] = useState<ScheduledMatch[]>([])
  const [readinessToken, setReadinessToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // CSRF token cache
  const [csrfToken, setCsrfToken] = useState<string>('')

  // Broadcast & OBS Telemetry State (004 O-04 / BC-01 s/d BC-05)
  const [broadcastMode, setBroadcastMode] = useState<'AUTO' | 'WAITING' | 'EMERGENCY'>('AUTO')
  const [telemetry, setTelemetry] = useState<{
    serverConnected: boolean
    obsConnected: boolean
    syncStatus: 'SYNCHRONIZED' | 'SYNCING' | 'STALE' | 'DISCONNECTED' | 'UNKNOWN'
    lastRenderedRevision: number
    committedRevision: number
    lastAckReceivedAt: string | null
    renderLatencyMs: number | null
  }>({
    serverConnected: true,
    obsConnected: false,
    syncStatus: 'UNKNOWN',
    lastRenderedRevision: 0,
    committedRevision: 1,
    lastAckReceivedAt: null,
    renderLatencyMs: null,
  })

  // Poll Broadcast Telemetry every 1.5 seconds
  useEffect(() => {
    const fetchTelemetry = async () => {
      try {
        const res = await fetch('/api/v1/broadcast/telemetry')
        if (res.ok) {
          const data = await res.json()
          setTelemetry(data)
        }
      } catch {
        setTelemetry((prev) => ({ ...prev, serverConnected: false, syncStatus: 'DISCONNECTED' }))
      }
    }

    fetchTelemetry()
    const timer = setInterval(fetchTelemetry, 1500)
    return () => clearInterval(timer)
  }, [])

  const handleSetBroadcastMode = async (mode: 'AUTO' | 'WAITING' | 'EMERGENCY') => {
    try {
      const res = await fetch('/api/v1/broadcast/mode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) {
        throw new Error('Gagal mengganti mode siaran')
      }
      setBroadcastMode(mode)
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Gagal mengganti mode siaran')
    }
  }

  // Bootstrap CSRF token on mount
  useEffect(() => {
    fetch('/api/v1/auth/bootstrap')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.csrfToken) setCsrfToken(data.csrfToken)
      })
      .catch(() => {
        // offline / local mock
      })
  }, [])

  // Fetch Arena & Active Match
  const refreshArena = useCallback(async () => {
    setLoading(true)
    try {
      const arenaRes = await fetch('/api/v1/arenas/main')
      if (!arenaRes.ok) throw new Error('Gagal memuat status arena')
      const arenaJson = await arenaRes.json()
      setArena(arenaJson.arena)

      if (arenaJson.arena?.activeMatchId) {
        const matchRes = await fetch(`/api/v1/matches/${arenaJson.arena.activeMatchId}`)
        if (matchRes.ok) {
          const matchJson = await matchRes.json()
          setActiveMatch(matchJson)

          // Restore readiness token from localStorage if any (L-08 ledger recovery)
          const savedToken = localStorage.getItem(`mrc_readiness_${matchJson.id}`)
          if (savedToken) {
            setReadinessToken(savedToken)
          }
        }
      } else {
        setActiveMatch(null)
      }

      // Also fetch scheduled matches for selector
      const schedRes = await fetch('/api/v1/matches?status=SCHEDULED')
      if (schedRes.ok) {
        const schedJson = await schedRes.json()
        setScheduledMatches(schedJson)
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const arenaRes = await fetch('/api/v1/arenas/main')
        if (!arenaRes.ok) return
        const arenaJson = await arenaRes.json()
        if (ignore) return
        setArena(arenaJson.arena)

        if (arenaJson.arena?.activeMatchId) {
          const matchRes = await fetch(`/api/v1/matches/${arenaJson.arena.activeMatchId}`)
          if (matchRes.ok && !ignore) {
            const matchJson = await matchRes.json()
            setActiveMatch(matchJson)
            const savedToken = localStorage.getItem(`mrc_readiness_${matchJson.id}`)
            if (savedToken) setReadinessToken(savedToken)
          }
        }
        const schedRes = await fetch('/api/v1/matches?status=SCHEDULED')
        if (schedRes.ok && !ignore) {
          const schedJson = await schedRes.json()
          setScheduledMatches(schedJson)
        }
      } catch {
        // ignore
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [])

  const sendArenaCommand = async (action: string, payload: Record<string, unknown>) => {
    setErrorMessage(null)
    try {
      const res = await fetch('/api/v1/arenas/main/commands', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ action, ...payload }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error?.message ?? 'Perintah arena gagal')
      }
      await refreshArena()
      return data
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const sendMatchCommand = async (action: string, payload: Record<string, unknown>) => {
    if (!activeMatch) return
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/v1/matches/${activeMatch.id}/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          action,
          expectedMatchVersion: activeMatch.matchVersion,
          ...payload,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error?.message ?? 'Perintah match gagal')
      }
      await refreshArena()
      return data
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  // --- Handlers ---
  const handleSelectMatch = async (matchId: string, expectedMatchVersion: number) => {
    if (!arena) return
    await sendArenaCommand('match.select', {
      matchId,
      expectedArenaVersion: arena.arenaVersion,
      expectedMatchVersion,
    })
  }

  const handleArmStart = async () => {
    const res = await sendMatchCommand('match.arm-start', {})
    if (res?.readinessToken && activeMatch) {
      setReadinessToken(res.readinessToken)
      localStorage.setItem(`mrc_readiness_${activeMatch.id}`, res.readinessToken)
    }
  }

  const handleDisarmStart = async () => {
    if (!readinessToken || !activeMatch) return
    await sendMatchCommand('match.disarm-start', { readinessToken })
    setReadinessToken(null)
    localStorage.removeItem(`mrc_readiness_${activeMatch.id}`)
  }

  const handleExecuteStart = async () => {
    if (!activeMatch) return
    await sendMatchCommand('phase.advance', {
      targetPhase: 'COMPETITION',
      readinessToken,
    })
    setReadinessToken(null)
    localStorage.removeItem(`mrc_readiness_${activeMatch.id}`)
  }

  const activeGoalIntent = activeMatch?.goalIntents?.[0]

  return (
    <div className="operator-container">
      <header className="operator-header">
        <div>
          <h1>Dashboard Operator Pertandingan MRC X</h1>
          <p>Kontrol lokal arena, alur fase, aba-aba timer, dan pencatatan gol</p>
        </div>
        <div>
          <button className="btn btn-ghost" onClick={refreshArena} disabled={loading}>
            {loading ? 'Memuat...' : 'Segarkan'}
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button className="btn btn-outline" onClick={() => setErrorMessage(null)}>
            Tutup
          </button>
        </div>
      )}

      {!activeMatch ? (
        <div className="card empty-state">
          <h2>Tidak Ada Pertandingan Aktif di Arena</h2>
          <p>Pilih salah satu pertandingan terjadwal di bawah ini untuk memulai:</p>
          <div className="controls-row" style={{ justifyContent: 'center', marginTop: '1.5rem' }}>
            {scheduledMatches.map((m) => (
              <button
                key={m.id}
                className="btn btn-ghost"
                onClick={() => handleSelectMatch(m.id, m.matchVersion)}
              >
                Pilih Match #{m.sequence}: {m.teamA.name} vs {m.teamB.name}
              </button>
            ))}
          </div>
          {scheduledMatches.length === 0 && (
            <p style={{ marginTop: '1rem', color: 'var(--color-stone)' }}>
              Tidak ada pertandingan berstatus SCHEDULED.
            </p>
          )}
        </div>
      ) : (
        <div className="dashboard-grid">
          {/* Main Controls Panel */}
          <div>
            {/* Score & Match Status Board */}
            <div className="score-display">
              <div className="team-box team-a">
                <div className="team-name">{activeMatch.teamA.name}</div>
                <div className="team-score tabular-nums">{activeMatch.score.goalsA}</div>
                <span className="status-pill neutral">{activeMatch.teamA.code}</span>
              </div>
              <div className="vs-box">
                <span className="vs-text">VS</span>
                <span className="status-pill info">{activeMatch.phase ?? 'PRE_MATCH'}</span>
                <span className="status-pill success">{activeMatch.status}</span>
              </div>
              <div className="team-box team-b">
                <div className="team-name">{activeMatch.teamB.name}</div>
                <div className="team-score tabular-nums">{activeMatch.score.goalsB}</div>
                <span className="status-pill neutral">{activeMatch.teamB.code}</span>
              </div>
            </div>

            {/* Lifecycle & Timer Control Card */}
            <div className="card">
              <h2>
                <span>Kontrol Fase & Start Timer</span>
                {readinessToken && <span className="status-pill armed">ARMED / SIAP ABA-ABA</span>}
              </h2>

              {/* Pre-match progression */}
              {activeMatch.status === 'PREPARING' && (
                <div className="controls-row">
                  {activeMatch.phase === 'PRE_MATCH' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'CALLING' })}
                    >
                      Panggil Tim (CALLING)
                    </button>
                  )}
                  {activeMatch.phase === 'CALLING' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'VERIFICATION' })}
                    >
                      Verifikasi Robot (VERIFICATION)
                    </button>
                  )}
                  {activeMatch.phase === 'VERIFICATION' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'WARMUP' })}
                    >
                      Uji Lapangan (WARMUP)
                    </button>
                  )}
                  {activeMatch.phase === 'WARMUP' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'READY' })}
                    >
                      Siap Pertandingan (READY)
                    </button>
                  )}
                  {activeMatch.phase === 'READY' && activeMatch.segments.length === 0 && (
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        sendMatchCommand('segment.prepare', {
                          kind: 'ROUND',
                          ordinal: 1,
                          durationMs: 300_000,
                        })
                      }
                    >
                      Siapkan Babak 1 (segment.prepare)
                    </button>
                  )}
                </div>
              )}

              {/* Armed Start Execution (L-08 review/arm dan satu aksi start) */}
              {activeMatch.phase === 'READY' && activeMatch.segments.length > 0 && (
                <div className="controls-row">
                  {!readinessToken ? (
                    <button className="btn btn-primary" onClick={handleArmStart}>
                      Review & Arm Start (match.arm-start)
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-success" onClick={handleExecuteStart}>
                        Mulai Pertandingan Sekarang (START ABA-ABA)
                      </button>
                      <button className="btn btn-outline" onClick={handleDisarmStart}>
                        Batal Kesiapan (Disarm)
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* In-progress controls */}
              {activeMatch.status === 'IN_PROGRESS' && (
                <div className="controls-row">
                  <button
                    className="btn btn-warning"
                    onClick={() => sendMatchCommand('match.pause', {})}
                  >
                    Jeda (PAUSE)
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'INTERMISSION' })}
                  >
                    Istirahat (INTERMISSION)
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'RESULT' })}
                  >
                    Masuk Fase Keputusan (RESULT)
                  </button>
                </div>
              )}

              {/* Paused state */}
              {activeMatch.status === 'PAUSED' && (
                <div className="controls-row">
                  <button
                    className="btn btn-success"
                    onClick={() => sendMatchCommand('match.resume', {})}
                  >
                    Lanjutkan (RESUME)
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() =>
                      sendMatchCommand('match.postpone', {
                        reason: 'Penundaan atas persetujuan juri',
                        authorityReference: 'JURI-1',
                      })
                    }
                  >
                    Tunda Pertandingan (POSTPONE)
                  </button>
                </div>
              )}
            </div>

            {/* Goal Control Card (Soccer) */}
            <div className="card">
              <h2>
                <span>Pencatatan Gol (Soccer)</span>
                {activeGoalIntent ? (
                  <span className="status-pill success">INTENT READY: {activeGoalIntent.id.slice(0, 8)}</span>
                ) : (
                  <span className="status-pill warning">TIDAK ADA INTENT READY</span>
                )}
              </h2>

              <div className="controls-row">
                <button
                  className="btn btn-ghost"
                  disabled={!activeGoalIntent}
                  onClick={() =>
                    sendMatchCommand('goal.add', {
                      goalIntentId: activeGoalIntent?.id,
                      side: 'A',
                    })
                  }
                >
                  +1 Gol Tim A ({activeMatch.teamA.name})
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!activeGoalIntent}
                  onClick={() =>
                    sendMatchCommand('goal.add', {
                      goalIntentId: activeGoalIntent?.id,
                      side: 'B',
                    })
                  }
                >
                  +1 Gol Tim B ({activeMatch.teamB.name})
                </button>
                {!activeGoalIntent && (
                  <button
                    className="btn btn-outline"
                    onClick={() =>
                      sendMatchCommand('goal.prepare-next', {
                        previousGoalIntentId: 'last-consumed-id',
                      })
                    }
                  >
                    Siapkan Gol Berikutnya (goal.prepare-next)
                  </button>
                )}
              </div>
            </div>

            {/* Result & Finalize Card */}
            {(activeMatch.phase === 'RESULT' || activeMatch.status === 'COMPLETED') && (
              <div className="card">
                <h2>Keputusan & Hasil Resmi</h2>
                <div className="controls-row">
                  {activeMatch.status !== 'COMPLETED' && (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          sendMatchCommand('result.draft', {
                            decisionText: `Hasil: Tim A (${activeMatch.score.goalsA}) - Tim B (${activeMatch.score.goalsB})`,
                            finalGoalsA: activeMatch.score.goalsA,
                            finalGoalsB: activeMatch.score.goalsB,
                            refereeReference: 'WASIT-UTAMA',
                          })
                        }
                      >
                        Simpan Draf Hasil (result.draft)
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() =>
                          sendMatchCommand('result.finalize', {
                            draftRevisionId: 'rev-id',
                          })
                        }
                      >
                        Finalisasi Hasil Resmi (result.finalize)
                      </button>
                    </>
                  )}
                  {activeMatch.status === 'COMPLETED' && (
                    <span className="status-pill success">PERTANDINGAN TELAH RESMI COMPLETED</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar: Public Broadcast & Overlay Preview Widget (004 O-03 / O-04) */}
          <div>
            {/* OBS & Broadcast Status Card (BC-01 s/d BC-05) */}
            <div className="card">
              <h2>Status Siaran & OBS</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Server Realtime:</span>
                  <span className={`status-pill ${telemetry.serverConnected ? 'success' : 'danger'}`}>
                    {telemetry.serverConnected ? 'CONNECTED' : 'DISCONNECTED'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>OBS Browser Source:</span>
                  <span className={`status-pill ${telemetry.obsConnected ? 'success' : 'danger'}`}>
                    {telemetry.obsConnected ? 'CONNECTED' : 'DISCONNECTED'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Status Sinkronisasi:</span>
                  <span
                    className={`status-pill ${
                      telemetry.syncStatus === 'SYNCHRONIZED'
                        ? 'success'
                        : telemetry.syncStatus === 'SYNCING'
                          ? 'info'
                          : telemetry.syncStatus === 'STALE'
                            ? 'warning'
                            : 'neutral'
                    }`}
                  >
                    {telemetry.syncStatus}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Revisi Ter-render / Server:</span>
                  <span className="tabular-nums" style={{ fontWeight: 600 }}>
                    #{telemetry.lastRenderedRevision} / #{telemetry.committedRevision}
                  </span>
                </div>
                {telemetry.renderLatencyMs !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Latensi Render:</span>
                    <span className="tabular-nums">{telemetry.renderLatencyMs.toFixed(1)} ms</span>
                  </div>
                )}
              </div>

              {/* Broadcast Mode Control (OB-02 / TC-27) */}
              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-stone)' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Kendali Mode Tayangan
                </h3>
                {broadcastMode !== 'AUTO' && (
                  <div className="error-banner" style={{ marginBottom: '0.5rem', fontSize: '12px', padding: '6px 12px' }}>
                    Tayangan aman aktif ({broadcastMode}); timer pertandingan tetap berjalan.
                  </div>
                )}
                <div className="controls-row" style={{ gap: '0.5rem' }}>
                  <button
                    className={`btn ${broadcastMode === 'AUTO' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    onClick={() => handleSetBroadcastMode('AUTO')}
                  >
                    Auto
                  </button>
                  <button
                    className={`btn ${broadcastMode === 'WAITING' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    onClick={() => handleSetBroadcastMode('WAITING')}
                  >
                    Waiting
                  </button>
                  <button
                    className={`btn ${broadcastMode === 'EMERGENCY' ? 'btn-danger' : 'btn-ghost'}`}
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    onClick={() => handleSetBroadcastMode('EMERGENCY')}
                  >
                    Darurat
                  </button>
                </div>
              </div>
            </div>

            {/* Live Preview Card */}
            <div className="card">
              <h2>Preview Siaran Langsung (Overlay)</h2>
              <div style={{ background: '#02093a', borderRadius: '8px', padding: '12px', overflow: 'hidden' }}>
                <OverlayDisplay clientRole="DASHBOARD_PREVIEW" />
              </div>
            </div>

            {/* Frozen Identity Card */}
            <div className="card">
              <h2>Informasi Identitas Beku</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '14px' }}>
                <p><strong>Kategori:</strong> {activeMatch.category.label} ({activeMatch.category.code})</p>
                <p><strong>Tim A:</strong> {activeMatch.teamA.name} ({activeMatch.teamA.institution ?? '-'})</p>
                <p><strong>Tim B:</strong> {activeMatch.teamB.name} ({activeMatch.teamB.institution ?? '-'})</p>
                <p><strong>Arena:</strong> Arena Utama (Versi #{arena?.arenaVersion})</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
