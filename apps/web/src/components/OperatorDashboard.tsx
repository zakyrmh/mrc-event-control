import { useEffect, useState, useCallback } from 'react'
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
          <button className="btn btn-secondary" onClick={refreshArena} disabled={loading}>
            {loading ? 'Memuat...' : 'Segarkan'}
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button className="btn btn-secondary" onClick={() => setErrorMessage(null)}>
            Tutup
          </button>
        </div>
      )}

      {!activeMatch ? (
        <div className="card empty-state">
          <h2>Tidak Ada Pertandingan Aktif di Arena</h2>
          <p>Pilih salah satu pertandingan terjadwal di bawah ini untuk memulai:</p>
          <div className="controls-row" style={{ justifyContent: 'center', marginTop: '1rem' }}>
            {scheduledMatches.map((m) => (
              <button
                key={m.id}
                className="btn btn-primary"
                onClick={() => handleSelectMatch(m.id, m.matchVersion)}
              >
                Pilih Match #{m.sequence}: {m.teamA.name} vs {m.teamB.name}
              </button>
            ))}
          </div>
          {scheduledMatches.length === 0 && <p>Tidak ada pertandingan berstatus SCHEDULED.</p>}
        </div>
      ) : (
        <div className="dashboard-grid">
          {/* Main Controls Panel */}
          <div>
            {/* Score & Match Status Board */}
            <div className="score-display">
              <div className="team-box">
                <div className="team-name">{activeMatch.teamA.name}</div>
                <div className="team-score">{activeMatch.score.goalsA}</div>
                <span className="badge badge-info">{activeMatch.teamA.code}</span>
              </div>
              <div className="vs-box">
                <div>VS</div>
                <div style={{ marginTop: '0.5rem' }}>
                  <span className="badge badge-success">{activeMatch.phase ?? 'PRE_MATCH'}</span>
                </div>
                <div style={{ marginTop: '0.25rem' }}>
                  <span className="badge badge-info">{activeMatch.status}</span>
                </div>
              </div>
              <div className="team-box">
                <div className="team-name">{activeMatch.teamB.name}</div>
                <div className="team-score">{activeMatch.score.goalsB}</div>
                <span className="badge badge-info">{activeMatch.teamB.code}</span>
              </div>
            </div>

            {/* Lifecycle & Timer Control Card */}
            <div className="card">
              <h2>
                <span>Kontrol Fase & Start Timer</span>
                {readinessToken && <span className="badge badge-armed">ARMED / SIAP ABA-ABA</span>}
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
                    <button className="btn btn-warning" onClick={handleArmStart}>
                      Review & Arm Start (match.arm-start)
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-success" onClick={handleExecuteStart}>
                        Mulai Pertandingan Sekarang (START ABA-ABA)
                      </button>
                      <button className="btn btn-danger" onClick={handleDisarmStart}>
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
                    className="btn btn-dark"
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
                  <span className="badge badge-success">INTENT READY: {activeGoalIntent.id.slice(0, 8)}</span>
                ) : (
                  <span className="badge badge-warning">TIDAK ADA INTENT READY</span>
                )}
              </h2>

              <div className="controls-row">
                <button
                  className="btn btn-primary"
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
                  className="btn btn-primary"
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
                    className="btn btn-secondary"
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
                        className="btn btn-secondary"
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
                        className="btn btn-success"
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
                    <span className="badge badge-success">PERTANDINGAN TELAH RESMI COMPLETED</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Sidebar: Public Contract Preview Widget */}
          <div>
            <div className="card">
              <h2>Preview Kontrak Siaran (Overlay)</h2>
              <div className="overlay-preview">
                <div className="overlay-banner">
                  <span>{activeMatch.category.label}</span>
                  <span>{activeMatch.phase ?? 'PRE_MATCH'}</span>
                </div>
                <div className="overlay-score-bar">
                  <span>{activeMatch.teamA.code}</span>
                  <span style={{ color: '#38bdf8' }}>
                    {activeMatch.score.goalsA} - {activeMatch.score.goalsB}
                  </span>
                  <span>{activeMatch.teamB.code}</span>
                </div>
                <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                  Status: {activeMatch.status} | Versi: {activeMatch.matchVersion}
                </div>
              </div>
            </div>

            <div className="card">
              <h2>Informasi Identitas Beku</h2>
              <p><strong>Kategori:</strong> {activeMatch.category.label} ({activeMatch.category.code})</p>
              <p><strong>Tim A:</strong> {activeMatch.teamA.name} ({activeMatch.teamA.institution ?? '-'})</p>
              <p><strong>Tim B:</strong> {activeMatch.teamB.name} ({activeMatch.teamB.institution ?? '-'})</p>
              <p><strong>Arena:</strong> Arena Utama (Versi #{arena?.arenaVersion})</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
