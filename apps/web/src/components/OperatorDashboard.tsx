import { useEffect, useState, useCallback, useMemo } from 'react'
import { OverlayDisplay } from './OverlayDisplay'
import { PhaseStepper } from './PhaseStepper'
import { ConfirmModal } from './ConfirmModal'
import { TournamentBracket, type BracketMatch } from './TournamentBracket'
import { formatPhase, formatStatus, formatTime } from '../constants/ui-labels'
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

interface ResultRevision {
  id: string
  revision: number
  status: string
  winnerTeamId: string | null
  pointsA: number | null
  pointsB: number | null
  decisionText: string | null
  refereeReference: string | null
}

interface ResultFormProps {
  teamA: Team
  teamB: Team
  draft: ResultRevision | null
  onSubmit: (payload: {
    winnerTeamId: string | null
    pointsA: number | null
    pointsB: number | null
    decisionText: string | null
    refereeReference: string | null
  }) => Promise<unknown>
}

// Owns the input state so it can be seeded straight from the stored draft on mount.
function ResultForm({ teamA, teamB, draft, onSubmit }: ResultFormProps) {
  const [winner, setWinner] = useState<'' | 'A' | 'B' | 'DRAW'>(
    !draft ? '' : draft.winnerTeamId === teamA.id ? 'A' : draft.winnerTeamId === teamB.id ? 'B' : 'DRAW',
  )
  const [pointsA, setPointsA] = useState(draft?.pointsA == null ? '' : String(draft.pointsA))
  const [pointsB, setPointsB] = useState(draft?.pointsB == null ? '' : String(draft.pointsB))
  const [decisionText, setDecisionText] = useState(draft?.decisionText ?? '')
  const [refereeReference, setRefereeReference] = useState(draft?.refereeReference ?? '')
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const a = pointsA === '' ? null : Number(pointsA)
    const b = pointsB === '' ? null : Number(pointsB)
    if ((a !== null && !Number.isFinite(a)) || (b !== null && !Number.isFinite(b))) {
      setLocalError('Poin harus berupa angka.')
      return
    }
    setLocalError(null)
    await onSubmit({
      winnerTeamId: winner === 'A' ? teamA.id : winner === 'B' ? teamB.id : null,
      pointsA: a,
      pointsB: b,
      decisionText: decisionText || null,
      refereeReference: refereeReference || null,
    })
  }

  return (
    <form className="result-form" onSubmit={submit}>
      <label>
        Pemenang
        <select value={winner} onChange={(e) => setWinner(e.target.value as '' | 'A' | 'B' | 'DRAW')}>
          <option value="">— pilih pemenang —</option>
          <option value="A">{teamA.name}</option>
          <option value="B">{teamB.name}</option>
          <option value="DRAW">Seri</option>
        </select>
      </label>
      <label>
        Poin {teamA.code}
        <input type="number" min={0} value={pointsA} onChange={(e) => setPointsA(e.target.value)} placeholder="0" />
      </label>
      <label>
        Poin {teamB.code}
        <input type="number" min={0} value={pointsB} onChange={(e) => setPointsB(e.target.value)} placeholder="0" />
      </label>
      <label>
        Catatan keputusan
        <input
          type="text"
          value={decisionText}
          onChange={(e) => setDecisionText(e.target.value)}
          placeholder="mis. Tim A menang waktu tercepat"
        />
      </label>
      <label>
        Referensi juri
        <input
          type="text"
          value={refereeReference}
          onChange={(e) => setRefereeReference(e.target.value)}
          placeholder="mis. JURI-LF-1"
        />
      </label>
      {localError && <p className="result-note">{localError}</p>}
      <button type="submit" className="btn btn-ghost">
        {draft ? 'Perbarui Draf Hasil' : 'Simpan Draf Hasil'}
      </button>
    </form>
  )
}

interface MatchDetail {
  id: string
  sequence?: number
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
  results: ResultRevision[]
  score: { goalsA: number; goalsB: number }
  goalIntents: Array<{ id: string; status: string }>
}

interface ArenaData {
  id: string
  activeMatchId: string | null
  arenaVersion: number
}

interface CategoryOption {
  id: string
  code: string
  label: string
}

interface ScheduledMatch {
  id: string
  sequence: number
  matchVersion: number
  status: string
  stage?: string
  stageLabel?: string | null
  bracketSlot?: string | null
  categoryId?: string
  category?: { id: string; code: string; label: string }
  group?: { id: string; name: string } | null
  teamA: Team
  teamB: Team
  results?: Array<{
    revision: number
    status: string
    decisionText: string | null
    winnerTeamId: string | null
    finalGoalsA: number | null
    finalGoalsB: number | null
    pointsA: number | null
    pointsB: number | null
    refereeReference: string | null
  }>
}

const ARENAS = [
  { id: 'arena-1', label: 'Meja 1 (Arena 1)' },
  { id: 'arena-2', label: 'Meja 2 (Arena 2)' },
]

export function OperatorDashboard() {
  const [selectedArena, setSelectedArena] = useState<string>(() => {
    return localStorage.getItem('mrc_operator_arena') || 'arena-1'
  })
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    return localStorage.getItem('mrc_operator_category') || 'all'
  })
  const [operatorViewMode, setOperatorViewMode] = useState<'schedule' | 'bracket'>('schedule')
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [completedMatches, setCompletedMatches] = useState<ScheduledMatch[]>([])
  const [selectedGroup, setSelectedGroup] = useState<string>('all')
  const [arena, setArena] = useState<ArenaData | null>(null)
  const [activeMatch, setActiveMatch] = useState<MatchDetail | null>(null)
  const [scheduledMatches, setScheduledMatches] = useState<ScheduledMatch[]>([])
  const [readinessToken, setReadinessToken] = useState<string | null>(null)
  const [warmupDurationSeconds, setWarmupDurationSeconds] = useState<number>(60)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Result form state lives in ResultForm so it can seed from the stored draft on mount.
  // CSRF token cache
  const [csrfToken, setCsrfToken] = useState<string>('')

  // Live Timer from Overlay websocket/interpolator
  const [matchTimerMs, setMatchTimerMs] = useState<number>(0)
  const [, setMatchTimerState] = useState<string>('IDLE')

  // Confirm Modal state for risky actions
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    variant?: 'danger' | 'warning' | 'primary'
    requireReason?: boolean
    reasonLabel?: string
    reasonPlaceholder?: string
    onConfirm: (reason?: string) => void
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  })

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

  // Filter jadwal per arena berdasarkan grup (Soccer & Sumo terbagi 2 arena)
  const isMatchInArena = useCallback(
    (m: ScheduledMatch, arenaId: string) => {
      const catCode = (m.category?.code ?? '').toLowerCase()
      // Line follower dan kategori tanpa grup tidak dipartisi grup
      if (!catCode.includes('soccer') && !catCode.includes('sumo')) {
        return true
      }
      const grp = (m.group?.name ?? '').trim()
      // Ambil huruf penanda grup (misal: "Group A" -> "A", "Grup B" -> "B")
      const clean = grp.replace(/^(GROUP|GRUP)\s*/i, '').trim().toUpperCase()
      const matchLetter = clean.charAt(0) || 'A'

      if (catCode.includes('soccer')) {
        // Soccer 11 grup (A-K): Arena 1 = A..F, Arena 2 = G..K
        const isArena1 = matchLetter <= 'F'
        return arenaId === 'arena-1' ? isArena1 : !isArena1
      }
      if (catCode.includes('sumo')) {
        // Sumo 10 grup (A-J): Arena 1 = A..E, Arena 2 = F..J
        const isArena1 = matchLetter <= 'E'
        return arenaId === 'arena-1' ? isArena1 : !isArena1
      }
      return true
    },
    [],
  )

  const [showAllGroups, setShowAllGroups] = useState<boolean>(false)

  const arenaScheduledMatches = useMemo(() => {
    if (showAllGroups) return scheduledMatches
    return scheduledMatches.filter((m) => isMatchInArena(m, selectedArena))
  }, [scheduledMatches, selectedArena, showAllGroups, isMatchInArena])

  const operatorBracketMatches = useMemo((): BracketMatch[] => {
    return scheduledMatches
      .filter((m) => {
        if (selectedCategory !== 'all' && m.categoryId && m.categoryId !== selectedCategory) {
          return false
        }
        return Boolean(m.bracketSlot || (m.stage && m.stage !== 'GROUP'))
      })
      .map((m) => {
        const finalRes = m.results?.find((r) => r.status === 'FINAL')
        return {
          id: m.id,
          slotId: m.bracketSlot || '',
          label: m.stageLabel || `Match #${m.sequence}`,
          sequence: m.sequence,
          matchVersion: m.matchVersion,
          status: m.status as any,
          teamA: m.teamA
            ? {
                id: m.teamA.id,
                name: m.teamA.name,
                code: m.teamA.code,
                score: finalRes?.pointsA ?? finalRes?.finalGoalsA ?? null,
                isWinner: finalRes?.winnerTeamId === m.teamA.id,
              }
            : null,
          teamB: m.teamB
            ? {
                id: m.teamB.id,
                name: m.teamB.name,
                code: m.teamB.code,
                score: finalRes?.pointsB ?? finalRes?.finalGoalsB ?? null,
                isWinner: finalRes?.winnerTeamId === m.teamB.id,
              }
            : null,
        }
      })
  }, [scheduledMatches, selectedCategory])

  // Group filter & standings calculation for completed matches
  const availableGroups = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of [...completedMatches, ...scheduledMatches]) {
      if (m.group?.id && m.group?.name) {
        map.set(m.group.id, m.group.name)
      }
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [completedMatches, scheduledMatches])

  const filteredCompletedMatches = useMemo(() => {
    if (selectedGroup === 'all') return completedMatches
    return completedMatches.filter((m) => m.group?.id === selectedGroup)
  }, [completedMatches, selectedGroup])

  const groupStandings = useMemo(() => {
    if (selectedGroup === 'all') return []
    const groupMatches = completedMatches.filter((m) => m.group?.id === selectedGroup)
    if (groupMatches.length === 0) return []

    const statsMap = new Map<
      string,
      {
        id: string
        name: string
        code: string
        played: number
        won: number
        lost: number
        drawn: number
        totalPoints: number
      }
    >()

    const initTeam = (t: Team) => {
      if (!statsMap.has(t.id)) {
        statsMap.set(t.id, {
          id: t.id,
          name: t.name,
          code: t.code,
          played: 0,
          won: 0,
          lost: 0,
          drawn: 0,
          totalPoints: 0,
        })
      }
    }

    for (const m of groupMatches) {
      initTeam(m.teamA)
      initTeam(m.teamB)
      const stA = statsMap.get(m.teamA.id)!
      const stB = statsMap.get(m.teamB.id)!

      const res = m.results?.find((r) => r.status === 'FINAL') ?? m.results?.[0]
      if (res) {
        stA.played += 1
        stB.played += 1
        if (typeof res.pointsA === 'number') stA.totalPoints += res.pointsA
        if (typeof res.pointsB === 'number') stB.totalPoints += res.pointsB

        if (res.winnerTeamId === m.teamA.id) {
          stA.won += 1
          stB.lost += 1
        } else if (res.winnerTeamId === m.teamB.id) {
          stB.won += 1
          stA.lost += 1
        } else if (typeof res.pointsA === 'number' && res.pointsA === res.pointsB) {
          stA.drawn += 1
          stB.drawn += 1
        }
      }
    }

    return Array.from(statsMap.values()).sort(
      (a, b) => b.totalPoints - a.totalPoints || b.won - a.won,
    )
  }, [completedMatches, selectedGroup])

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

  // Fetch Arena & Active Match
  const refreshArena = useCallback(async (targetArena?: string, targetCat?: string) => {
    const arenaId = targetArena ?? selectedArena
    const categoryId = targetCat ?? selectedCategory
    setLoading(true)
    try {
      const arenaRes = await fetch(`/api/v1/arenas/${arenaId}`)
      if (arenaRes.status === 401) {
        throw new Error('Sesi belum aktif. Silakan login sebagai Super-Admin atau Operator di tab Manajemen Tim & Jadwal.')
      }
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

      // Fetch categories
      try {
        const catRes = await fetch('/api/v1/categories')
        if (catRes.ok) {
          const cats = await catRes.json()
          setCategories(cats)
        }
      } catch {
        // ignore
      }

      // Also fetch scheduled matches for selector
      const catQuery = categoryId !== 'all' ? `&categoryId=${encodeURIComponent(categoryId)}` : ''
      const schedRes = await fetch(`/api/v1/matches?status=SCHEDULED${catQuery}`)
      if (schedRes.ok) {
        const schedJson = await schedRes.json()
        setScheduledMatches(schedJson)
      }

      // Fetch completed matches for history panel
      const compRes = await fetch(`/api/v1/matches?status=COMPLETED${catQuery}`)
      if (compRes.ok) {
        const compJson = await compRes.json()
        setCompletedMatches(compJson)
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [selectedArena, selectedCategory])

  // Bootstrap auth on mount: check existing session first, do NOT call bootstrap if logged in
  // because /api/v1/auth/bootstrap resets cookie to an anonymous guest.
  useEffect(() => {
    let ignore = false
    async function initAuth() {
      try {
        const meRes = await fetch('/api/v1/auth/me')
        if (meRes.ok) {
          const meData = await meRes.json()
          if (!ignore && meData?.csrfToken) setCsrfToken(meData.csrfToken)
          if (!ignore) await refreshArena()
          return
        }
      } catch {
        // offline / local mock
      }
      try {
        const bRes = await fetch('/api/v1/auth/bootstrap')
        if (bRes.ok) {
          const bData = await bRes.json()
          if (!ignore && bData?.csrfToken) setCsrfToken(bData.csrfToken)
          if (!ignore) await refreshArena()
        }
      } catch {
        // offline / local mock
      }
    }
    void initAuth()
    return () => {
      ignore = true
    }
  }, [refreshArena])

  const sendArenaCommand = async (action: string, payload: Record<string, unknown>) => {
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/v1/arenas/${selectedArena}/commands`, {
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

  const categoryCode = (activeMatch?.category?.code ?? '').toLowerCase()
  const isSoccer = categoryCode.includes('soccer')
  const isSumo = categoryCode.includes('sumo')
  const isLineFollower = categoryCode.includes('lf') || categoryCode.includes('line')

  // Rulebook: Sumo 2 min/ronde, Soccer 3 min/babak, LF 2 min/start.
  const segmentDurationMs =
    activeMatch?.category.code === 'soccer' ? 180_000 : 120_000

  const draft = activeMatch?.results?.find((r) => r.status === 'DRAFT') ?? null
  const finalResult = [...(activeMatch?.results ?? [])]
    .reverse()
    .find((r) => r.status === 'FINAL')

  // Handlers dengan modal pengaman aksi berisiko
  const handleBackToSchedule = () => {
    if (!activeMatch) return
    if (activeMatch.status === 'PREPARING') {
      setConfirmModal({
        isOpen: true,
        title: 'Batal Pilih Pertandingan?',
        message: 'Pertandingan belum dimulai. Membatalkan pilihan akan mengembalikan pertandingan ke antrean jadwal dan mengosongkan meja arena.',
        confirmText: 'Ya, Lepas Match & Kembali',
        cancelText: 'Tetap di Sini',
        variant: 'warning',
        requireReason: false,
        onConfirm: async () => {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
          if (arena) {
            await sendArenaCommand('match.release', {
              expectedArenaVersion: arena.arenaVersion,
              expectedMatchVersion: activeMatch.matchVersion,
              reason: 'Operator membatalkan pilihan match',
            })
            setActiveMatch(null)
          }
        },
      })
    } else {
      setConfirmModal({
        isOpen: true,
        title: 'Tunda Pertandingan & Kembali ke Jadwal?',
        message: 'Pertandingan sedang berlangsung atau dijeda. Untuk kembali ke jadwal, pertandingan harus ditunda (POSTPONE) agar status dan waktu tersimpan.',
        confirmText: 'Tunda & Kembali',
        cancelText: 'Batal',
        variant: 'danger',
        requireReason: true,
        reasonLabel: 'Alasan Penundaan (wajib):',
        reasonPlaceholder: 'Contoh: Salah pilih jadwal, masalah robot, dll.',
        onConfirm: async (reason) => {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
          await sendMatchCommand('match.postpone', {
            reason: reason || 'Penundaan atas persetujuan operator/juri',
            authorityReference: 'OPERATOR-MEJA',
          })
          setActiveMatch(null)
        },
      })
    }
  }

  const handleAdvanceToResult = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Masuk Fase Keputusan?',
      message: 'Akhiri ronde dan lanjut ke pencatatan keputusan? Tindakan ini sulit dibatalkan.',
      confirmText: 'Ya, Masuk Keputusan',
      cancelText: 'Kembali',
      variant: 'warning',
      requireReason: false,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        await sendMatchCommand('phase.advance', { targetPhase: 'RESULT' })
      },
    })
  }

  const handlePostponeMatch = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Tunda Pertandingan (Postpone)?',
      message: 'Pertandingan akan dihentikan sementara dan status sisa waktu pertandingan akan disimpan.',
      confirmText: 'Tunda Pertandingan',
      cancelText: 'Batal',
      variant: 'danger',
      requireReason: true,
      reasonLabel: 'Alasan Penundaan (wajib):',
      reasonPlaceholder: 'Contoh: Kendala teknis lapangan, salah pilih jadwal, dll.',
      onConfirm: async (reason) => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        await sendMatchCommand('match.postpone', {
          reason: reason || 'Penundaan atas persetujuan juri',
          authorityReference: 'OPERATOR-MEJA',
        })
        setActiveMatch(null)
      },
    })
  }

  const handleEmergencyBroadcast = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Aktifkan Mode Tayangan Darurat?',
      message: 'Layar OBS siaran akan beralih ke tampilan darurat panitia. Timer pertandingan di arena akan tetap berjalan.',
      confirmText: 'Aktifkan Darurat',
      cancelText: 'Batal',
      variant: 'danger',
      requireReason: false,
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        await handleSetBroadcastMode('EMERGENCY')
      },
    })
  }

  const handleFinalize = async () => {
    if (!draft) return
    await sendMatchCommand('result.finalize', { draftRevisionId: draft.id })
  }

  return (
    <div className="operator-container">
      <header className="operator-header">
        <div>
          <h1>Dashboard Operator Pertandingan MRC X</h1>
          <p>Kontrol lokal arena, alur fase, aba-aba timer, dan pencatatan gol</p>
        </div>
        <div className="operator-selectors">
          <div className="selector-group">
            <label htmlFor="arena-select">Meja/Arena:</label>
            <select
              id="arena-select"
              value={selectedArena}
              onChange={(e) => {
                const val = e.target.value
                setSelectedArena(val)
                localStorage.setItem('mrc_operator_arena', val)
                void refreshArena(val, selectedCategory)
              }}
            >
              {ARENAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="selector-group">
            <label htmlFor="category-select">Kategori:</label>
            <select
              id="category-select"
              value={selectedCategory}
              onChange={(e) => {
                const val = e.target.value
                setSelectedCategory(val)
                localStorage.setItem('mrc_operator_category', val)
                void refreshArena(selectedArena, val)
              }}
            >
              <option value="all">Semua Kategori</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-ghost" onClick={() => refreshArena()} disabled={loading}>
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
        <div>
          {/* Tab Selector: Jadwal Antrean vs Bagan Bracket */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem' }}>
            <button
              type="button"
              className={`btn ${operatorViewMode === 'schedule' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600 }}
              onClick={() => setOperatorViewMode('schedule')}
            >
              📋 Daftar Antrean Jadwal
            </button>
            <button
              type="button"
              className={`btn ${operatorViewMode === 'bracket' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600 }}
              onClick={() => setOperatorViewMode('bracket')}
            >
              🏆 Bagan Sistem Gugur (Bracket)
            </button>
          </div>

          {operatorViewMode === 'bracket' ? (
            <TournamentBracket
              categoryCode={
                categories.find((c) => c.id === selectedCategory)?.code ||
                (selectedCategory !== 'all' ? selectedCategory : 'soccer')
              }
              categoryLabel={
                categories.find((c) => c.id === selectedCategory)?.label ||
                'Robot Soccer'
              }
              matches={operatorBracketMatches}
              onSelectMatch={handleSelectMatch}
            />
          ) : (
            <div className="card">
              <h2>
                <span>Status Meja: Siap Digunakan</span>
                <span className="status-pill info">
                  {ARENAS.find((a) => a.id === selectedArena)?.label ?? selectedArena}
                </span>
              </h2>

          {arenaScheduledMatches.length > 0 && (
            <div
              style={{
                backgroundColor: 'var(--color-primary-tint)',
                border: '1px solid var(--color-primary)',
                borderRadius: '8px',
                padding: '16px 20px',
                marginBottom: '1.5rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--color-primary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Pertandingan Berikutnya di Meja Ini
                </span>
                <div style={{ fontSize: '18px', fontWeight: 700, marginTop: '2px' }}>
                  Match #{arenaScheduledMatches[0].sequence}: {arenaScheduledMatches[0].teamA.name} vs{' '}
                  {arenaScheduledMatches[0].teamB.name}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--color-graphite)', marginTop: '4px' }}>
                  {arenaScheduledMatches[0].category?.label}{' '}
                  {arenaScheduledMatches[0].group ? `• Grup ${arenaScheduledMatches[0].group.name}` : ''}
                </div>
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '8px 20px', fontSize: '14px', fontWeight: 600 }}
                onClick={() =>
                  handleSelectMatch(arenaScheduledMatches[0].id, arenaScheduledMatches[0].matchVersion)
                }
              >
                Mulai Match #{arenaScheduledMatches[0].sequence} &rarr;
              </button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem', marginBottom: '0.5rem' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>
              Jadwal Pertandingan ({arenaScheduledMatches.length})
            </h3>
            <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--color-stone)' }}>
              <input
                type="checkbox"
                checked={showAllGroups}
                onChange={(e) => setShowAllGroups(e.target.checked)}
              />
              Tampilkan semua grup (gabungan meja 1 & 2)
            </label>
          </div>
          {arenaScheduledMatches.length === 0 ? (
            <p style={{ color: 'var(--color-stone)', fontSize: '14px', marginBottom: '1.5rem' }}>
              Tidak ada pertandingan dengan status SCHEDULED untuk filter meja/kategori ini.
            </p>
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
              <table className="match-table">
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>Seq</th>
                    <th>Kategori / Grup</th>
                    <th>Tim A</th>
                    <th style={{ textAlign: 'center', width: '40px' }}>VS</th>
                    <th>Tim B</th>
                    <th style={{ width: '120px', textAlign: 'center' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {arenaScheduledMatches.map((m) => (
                    <tr key={m.id}>
                      <td className="tabular-nums" style={{ fontWeight: 600 }}>#{m.sequence}</td>
                      <td>
                        {m.category?.label ?? '-'}
                        {m.group ? ` (Grup ${m.group.name})` : ''}
                      </td>
                      <td style={{ fontWeight: 600 }}>{m.teamA.name}</td>
                      <td style={{ textAlign: 'center', color: 'var(--color-stone)' }}>vs</td>
                      <td style={{ fontWeight: 600 }}>{m.teamB.name}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={() => handleSelectMatch(m.id, m.matchVersion)}
                        >
                          Pilih Match
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  ) : (
        <div className="dashboard-grid">
          {/* Main Controls Panel */}
          <div>
            {/* Header navigasi: Batal pilih / Kembali ke jadwal */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
                background: '#ffffff',
                padding: '10px 16px',
                borderRadius: '8px',
                border: '1px solid var(--color-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#0f172a',
                    padding: '6px 12px',
                  }}
                  onClick={handleBackToSchedule}
                >
                  &larr; Batal Pilih / Kembali ke Jadwal
                </button>
                <span style={{ fontSize: '12px', color: 'var(--color-stone)' }}>
                  {activeMatch.status === 'PREPARING'
                    ? '(Pertandingan belum dimulai — aman dilepas)'
                    : '(Pertandingan aktif — akan ditunda / postpone)'}
                </span>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-graphite)' }}>
                Match #{activeMatch.sequence} &bull; {activeMatch.category.label}
              </div>
            </div>

            {/* Score & Match Status Board */}
            <div className="score-display">
              <div className="team-box team-a">
                <div className="team-name">{activeMatch.teamA.name}</div>
                <div className="team-score tabular-nums">{activeMatch.score.goalsA}</div>
                <span className="status-pill neutral">{activeMatch.teamA.code}</span>
              </div>
              <div className="vs-box">
                {isSumo && (
                  <span className="round-badge">
                    Ronde {activeMatch.segments.length > 0 ? activeMatch.segments.length : 1} / 3
                  </span>
                )}
                {isSoccer && (
                  <span className="round-badge">
                    Babak {activeMatch.segments.length > 0 ? activeMatch.segments.length : 1} / 2
                  </span>
                )}
                <div className="big-timer-container">
                  <div
                    className={`big-timer-digits tabular-nums ${
                      activeMatch.status === 'PAUSED' ? 'timer-paused' : ''
                    }`}
                  >
                    {formatTime(matchTimerMs)}
                  </div>
                  {activeMatch.status === 'PAUSED' && (
                    <span className="status-pill warning" style={{ marginTop: '4px', fontWeight: 700, fontSize: '11px' }}>
                      DIJEDA
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <span className="status-pill info" title={activeMatch.phase ?? 'PRE_MATCH'}>
                    {formatPhase(activeMatch.phase)}
                  </span>
                  <span className="status-pill success" title={activeMatch.status}>
                    {formatStatus(activeMatch.status)}
                  </span>
                </div>
              </div>
              <div className="team-box team-b">
                <div className="team-name">{activeMatch.teamB.name}</div>
                <div className="team-score tabular-nums">{activeMatch.score.goalsB}</div>
                <span className="status-pill neutral">{activeMatch.teamB.code}</span>
              </div>
            </div>

            {/* Horizontal Phase Stepper */}
            <PhaseStepper currentPhase={activeMatch.phase} currentStatus={activeMatch.status} />

            {/* Lifecycle & Timer Control Card */}
            <div className="card">
              <h2>
                <span>Kontrol Fase & Start Timer</span>
                {readinessToken && <span className="status-pill armed">SIAP MULAI (ARMED)</span>}
              </h2>

              {/* Pre-match progression */}
              {activeMatch.status === 'PREPARING' && (
                <div className="controls-row">
                  {activeMatch.phase === 'PRE_MATCH' && (
                    <button
                      className="btn btn-primary"
                      title="CALLING"
                      onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'CALLING' })}
                    >
                      Panggil Tim
                    </button>
                  )}
                  {activeMatch.phase === 'CALLING' && (
                    <button
                      className="btn btn-primary"
                      title="VERIFICATION"
                      onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'VERIFICATION' })}
                    >
                      Verifikasi Robot
                    </button>
                  )}
                  {activeMatch.phase === 'VERIFICATION' && (
                    <button
                      className="btn btn-primary"
                      title="WARMUP"
                      onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'WARMUP' })}
                    >
                      Uji Lapangan
                    </button>
                  )}
                  {activeMatch.phase === 'WARMUP' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', marginTop: '0.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          Timer Uji Lapangan:
                          <input
                            type="number"
                            min={10}
                            max={600}
                            step={10}
                            value={warmupDurationSeconds}
                            onChange={(e) => setWarmupDurationSeconds(Math.max(10, Number(e.target.value) || 60))}
                            style={{
                              width: '75px',
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-border)',
                              fontFamily: 'inherit',
                              fontSize: '13px',
                            }}
                          />
                          detik ({Math.floor(warmupDurationSeconds / 60)}m {warmupDurationSeconds % 60}s)
                        </label>
                      </div>
                      <div className="controls-row">
                        <button
                          className="btn btn-primary"
                          onClick={() => sendMatchCommand('warmup.start', { durationMs: warmupDurationSeconds * 1000 })}
                        >
                          Mulai Timer Uji Lapangan
                        </button>
                        <button
                          className="btn btn-warning"
                          onClick={() => sendMatchCommand('warmup.pause', {})}
                        >
                          Jeda Timer
                        </button>
                        <button
                          className="btn btn-success"
                          title="READY"
                          onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'READY' })}
                        >
                          Selesai & Lanjut Siap Pertandingan &rarr;
                        </button>
                      </div>
                    </div>
                  )}
                  {activeMatch.phase === 'READY' && activeMatch.segments.length === 0 && (
                    <button
                      className="btn btn-primary"
                      title="segment.prepare"
                      onClick={() =>
                        sendMatchCommand('segment.prepare', {
                          kind: 'ROUND',
                          ordinal: 1,
                          durationMs: segmentDurationMs,
                        })
                      }
                    >
                      Siapkan Ronde 1
                    </button>
                  )}
                </div>
              )}

              {/* Next ronde (Sumo up to 3, Soccer 2) */}
              {(activeMatch.phase === 'READY' || activeMatch.phase === 'INTERMISSION') &&
                activeMatch.segments.length > 0 &&
                !activeMatch.segments.some((s) => s.status === 'PREPARED') && (
                  <div className="controls-row">
                    <button
                      className="btn btn-primary"
                      title="segment.prepare"
                      onClick={() =>
                        sendMatchCommand('segment.prepare', {
                          kind: 'ROUND',
                          ordinal: activeMatch.segments.length + 1,
                          durationMs: segmentDurationMs,
                        })
                      }
                    >
                      Siapkan Ronde {activeMatch.segments.length + 1}
                    </button>
                  </div>
                )}

              {/* Armed Start Execution */}
              {activeMatch.phase === 'READY' && activeMatch.segments.length > 0 && (
                <div className="controls-row" style={{ alignItems: 'center' }}>
                  {!readinessToken ? (
                    <button
                      className="btn btn-primary"
                      title="match.arm-start"
                      style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 600 }}
                      onClick={handleArmStart}
                    >
                      Siap Mulai (Aktifkan Pengaman)
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-success"
                        title="START ABA-ABA"
                        style={{ padding: '12px 24px', fontSize: '15px', fontWeight: 700 }}
                        onClick={handleExecuteStart}
                      >
                        Mulai Pertandingan Sekarang
                      </button>
                      <button
                        className="btn btn-outline"
                        title="match.disarm-start"
                        style={{ marginLeft: '16px', padding: '10px 16px', fontSize: '13px' }}
                        onClick={handleDisarmStart}
                      >
                        Batal Kesiapan
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* In-progress controls: Jeda dominant, Result separated by >= 16px */}
              {activeMatch.status === 'IN_PROGRESS' && (
                <div className="controls-row" style={{ alignItems: 'center' }}>
                  <button
                    className="btn btn-warning"
                    title="match.pause"
                    style={{ padding: '12px 24px', fontSize: '15px', fontWeight: 700, minWidth: '130px' }}
                    onClick={() => sendMatchCommand('match.pause', {})}
                  >
                    ⏸ Jeda
                  </button>
                  <button
                    className="btn btn-ghost"
                    title="INTERMISSION"
                    onClick={() => sendMatchCommand('phase.advance', { targetPhase: 'INTERMISSION' })}
                  >
                    Istirahat Antar-Ronde
                  </button>
                  <button
                    className="btn btn-outline"
                    title="RESULT"
                    style={{ marginLeft: '16px', borderColor: '#cbd5e1' }}
                    onClick={handleAdvanceToResult}
                  >
                    Masuk Fase Keputusan
                  </button>
                </div>
              )}

              {/* Paused state */}
              {activeMatch.status === 'PAUSED' && (
                <div className="controls-row">
                  <button
                    className="btn btn-success"
                    title="match.resume"
                    style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 600 }}
                    onClick={() => sendMatchCommand('match.resume', {})}
                  >
                    ▶ Lanjutkan Pertandingan
                  </button>
                  <button
                    className="btn btn-danger"
                    title="match.postpone"
                    style={{ marginLeft: '16px' }}
                    onClick={handlePostponeMatch}
                  >
                    Tunda Pertandingan
                  </button>
                </div>
              )}
            </div>

            {/* Goal Control Card (Soccer) or Category Scoring Guidance */}
            {isSoccer ? (
              <div className="card">
                <h2>
                  <span>Pencatatan Gol (Soccer)</span>
                  {activeGoalIntent ? (
                    <span className="status-pill success">Siap Mencatat Gol</span>
                  ) : activeMatch.status === 'IN_PROGRESS' ? (
                    <span className="status-pill info">Gol tercatat &mdash; klik 'Siapkan Gol Berikutnya'</span>
                  ) : (
                    <span className="status-pill warning">Belum bisa mencatat gol (mulai pertandingan dulu)</span>
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
                      title="goal.prepare-next"
                      onClick={() =>
                        sendMatchCommand('goal.prepare-next', {
                          previousGoalIntentId: 'last-consumed-id',
                        })
                      }
                    >
                      Siapkan Gol Berikutnya
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="card">
                <h2>
                  <span>
                    {isLineFollower
                      ? 'Pencatatan Poin & Waktu (Line Follower)'
                      : isSumo
                        ? 'Pencatatan Ronde & Keputusan (Sumo)'
                        : `Aturan Penilaian (${activeMatch.category.label})`}
                  </span>
                </h2>
                <div style={{ fontSize: '14px', color: 'var(--color-stone)', lineHeight: 1.6 }}>
                  {isLineFollower ? (
                    <p style={{ margin: 0 }}>
                      Sesuai aturan lomba Line Follower, perolehan poin lintasan (checkpoint) dan waktu tempuh peserta dimasukkan pada tahap <strong>Keputusan & Rekap Skor</strong> setelah robot menyelesaikan lintasan atau waktu habis.
                    </p>
                  ) : isSumo ? (
                    <p style={{ margin: 0 }}>
                      Sesuai aturan lomba Robot Sumo, pertandingan berlangsung dalam sistem ronde (maksimal 3 ronde). Pemenang setiap ronde dan keputusan akhir dicatat pada tahap <strong>Keputusan & Rekap Skor</strong>.
                    </p>
                  ) : (
                    <p style={{ margin: 0 }}>
                      Hasil dan poin penilaian pertandingan dicatat pada tahap <strong>Keputusan & Rekap Skor</strong> oleh operator berdasarkan keputusan juri.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Result & Finalize Card */}
            {(activeMatch.phase === 'RESULT' || activeMatch.status === 'COMPLETED') && (
              <div className="card">
                <h2>
                  <span>Keputusan & Hasil Resmi</span>
                  {draft && <span className="status-pill warning">DRAF REV {draft.revision}</span>}
                  {finalResult && <span className="status-pill success">FINAL REV {finalResult.revision}</span>}
                </h2>

                {activeMatch.status !== 'COMPLETED' && (
                  <ResultForm
                    key={draft?.id ?? 'new'}
                    teamA={activeMatch.teamA}
                    teamB={activeMatch.teamB}
                    draft={draft}
                    onSubmit={(payload) => sendMatchCommand('result.draft', payload)}
                  />
                )}

                <div className="controls-row">
                  {activeMatch.status !== 'COMPLETED' && (
                    <button className="btn btn-primary" onClick={handleFinalize} disabled={!draft}>
                      Finalisasi Hasil Resmi
                    </button>
                  )}
                  {activeMatch.status === 'COMPLETED' && (
                    <>
                      <span className="status-pill success">PERTANDINGAN TELAH RESMI COMPLETED</span>
                      <button
                        className="btn btn-primary"
                        onClick={() => {
                          setActiveMatch(null)
                          void refreshArena()
                        }}
                      >
                        Muat Pertandingan Berikutnya &rarr;
                      </button>
                    </>
                  )}
                </div>

                {draft && (
                  <p className="result-note">
                    Draf: pemenang{' '}
                    {draft.winnerTeamId === activeMatch.teamAId
                      ? activeMatch.teamA.name
                      : draft.winnerTeamId === activeMatch.teamBId
                        ? activeMatch.teamB.name
                        : 'seri'}
                    , poin {draft.pointsA ?? '-'} : {draft.pointsB ?? '-'}
                    {draft.refereeReference ? `, juri ${draft.refereeReference}` : ''}. Tekan
                    Finalisasi untuk mengunci hasil.
                  </p>
                )}
                {!draft && activeMatch.status !== 'COMPLETED' && (
                  <p className="result-note">Belum ada draf. Simpan draf dulu sebelum finalisasi.</p>
                )}
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
                    Tayangan aman aktif ({broadcastMode === 'EMERGENCY' ? 'Darurat' : 'Menunggu'}); timer pertandingan tetap berjalan.
                  </div>
                )}
                <div className="controls-row" style={{ gap: '0.5rem' }}>
                  <button
                    className={`btn ${broadcastMode === 'AUTO' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    onClick={() => handleSetBroadcastMode('AUTO')}
                  >
                    Otomatis
                  </button>
                  <button
                    className={`btn ${broadcastMode === 'WAITING' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    onClick={() => handleSetBroadcastMode('WAITING')}
                  >
                    Menunggu
                  </button>
                  <button
                    className={`btn ${broadcastMode === 'EMERGENCY' ? 'btn-danger' : 'btn-ghost'}`}
                    style={{ fontSize: '12px', padding: '6px 10px' }}
                    onClick={handleEmergencyBroadcast}
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
                <OverlayDisplay
                  clientRole="DASHBOARD_PREVIEW"
                  arenaId={selectedArena}
                  onTimerUpdate={(ms, state) => {
                    setMatchTimerMs(ms)
                    setMatchTimerState(state)
                  }}
                />
              </div>
            </div>

            {/* Detail Pertandingan */}
            <div className="card">
              <h2>Detail Pertandingan</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '14px' }}>
                <p><strong>Kategori:</strong> {activeMatch.category.label} ({activeMatch.category.code})</p>
                <p><strong>Tim A:</strong> {activeMatch.teamA.name} ({activeMatch.teamA.institution ?? '-'})</p>
                <p><strong>Tim B:</strong> {activeMatch.teamB.name} ({activeMatch.teamB.institution ?? '-'})</p>
                <p><strong>Arena:</strong> {ARENAS.find((a) => a.id === selectedArena)?.label ?? selectedArena} (Versi #{arena?.arenaVersion})</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rekap Hasil & Poin Pertandingan Selesai */}
      {completedMatches.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem', width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>📋 Hasil & Poin Pertandingan Selesai</span>
                <span className="status-pill success">{filteredCompletedMatches.length} Selesai</span>
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-stone)' }}>
                Rekap skor resmi yang telah difinalisasi oleh juri dan operator
              </p>
            </div>
            {availableGroups.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '13px' }}>
                <label htmlFor="group-filter" style={{ fontWeight: 600 }}>
                  Filter Grup:
                </label>
                <select
                  id="group-filter"
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-ink)',
                    fontSize: '13px',
                    fontWeight: 500,
                  }}
                >
                  <option value="all">Semua Grup ({completedMatches.length})</option>
                  {availableGroups.map((g) => {
                    const count = completedMatches.filter((m) => m.group?.id === g.id).length
                    return (
                      <option key={g.id} value={g.id}>
                        {g.name} ({count} selesai)
                      </option>
                    )
                  })}
                </select>
              </div>
            )}
          </div>

          {/* Klasemen Poin Grup (Jika Grup Tertentu Dipilih) */}
          {selectedGroup !== 'all' && groupStandings.length > 0 && (
            <div
              style={{
                marginBottom: '1.25rem',
                background: '#f8fafc',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              <h3
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: '#0f172a',
                  margin: '0 0 8px 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>🏆 Klasemen Sementara {availableGroups.find((g) => g.id === selectedGroup)?.name ?? 'Grup'}</span>
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="match-table" style={{ fontSize: '13px', background: '#fff' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '45px' }}>Rank</th>
                      <th>Tim</th>
                      <th style={{ width: '60px', textAlign: 'center' }}>Main</th>
                      <th style={{ width: '60px', textAlign: 'center' }}>Menang</th>
                      <th style={{ width: '60px', textAlign: 'center' }}>Kalah</th>
                      <th style={{ width: '60px', textAlign: 'center' }}>Seri</th>
                      <th style={{ width: '90px', textAlign: 'center', background: '#e0f2fe', color: '#0369a1' }}>Total Poin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupStandings.map((st, idx) => (
                      <tr key={st.id}>
                        <td className="tabular-nums" style={{ fontWeight: 700 }}>#{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>
                          {st.name} <span style={{ fontSize: '11px', color: 'var(--color-stone)' }}>({st.code})</span>
                        </td>
                        <td style={{ textAlign: 'center' }} className="tabular-nums">{st.played}</td>
                        <td style={{ textAlign: 'center', color: '#16a34a', fontWeight: 600 }} className="tabular-nums">{st.won}</td>
                        <td style={{ textAlign: 'center', color: '#dc2626' }} className="tabular-nums">{st.lost}</td>
                        <td style={{ textAlign: 'center', color: '#d97706' }} className="tabular-nums">{st.drawn}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700, fontSize: '14px', background: '#f0f9ff', color: '#0284c7' }} className="tabular-nums">
                          {st.totalPoints}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tabel Detail Pertandingan & Poin Akhir */}
          <div style={{ overflowX: 'auto' }}>
            <table className="match-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>Seq</th>
                  <th style={{ width: '120px' }}>Grup / Kategori</th>
                  <th style={{ textAlign: 'right', minWidth: '130px' }}>Tim A</th>
                  <th style={{ textAlign: 'center', width: '120px' }}>Skor / Poin</th>
                  <th style={{ textAlign: 'left', minWidth: '130px' }}>Tim B</th>
                  <th style={{ width: '220px' }}>Hasil & Keputusan</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompletedMatches.map((m) => {
                  const res = m.results?.find((r) => r.status === 'FINAL') ?? m.results?.[0]
                  const isSoccer = m.category?.code?.toLowerCase().includes('soccer')

                  let scoreText = '-'
                  if (res) {
                    if (typeof res.pointsA === 'number' && typeof res.pointsB === 'number') {
                      scoreText = `${res.pointsA} - ${res.pointsB}`
                    } else if (isSoccer && typeof res.finalGoalsA === 'number' && typeof res.finalGoalsB === 'number') {
                      scoreText = `${res.finalGoalsA} - ${res.finalGoalsB}`
                    }
                  }

                  const isWinnerA = res?.winnerTeamId === m.teamA.id
                  const isWinnerB = res?.winnerTeamId === m.teamB.id
                  const isDraw =
                    res &&
                    !res.winnerTeamId &&
                    typeof res.pointsA === 'number' &&
                    res.pointsA === res.pointsB

                  return (
                    <tr key={m.id}>
                      <td className="tabular-nums" style={{ fontWeight: 600 }}>
                        #{m.sequence}
                      </td>
                      <td>
                        <span className="status-pill neutral" style={{ fontSize: '11px', padding: '2px 6px' }}>
                          {m.group?.name ? m.group.name : m.category?.label ?? '-'}
                        </span>
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontWeight: isWinnerA ? 700 : 500,
                          color: isWinnerA ? '#16a34a' : 'inherit',
                        }}
                      >
                        {m.teamA.name}{' '}
                        <span style={{ fontSize: '11px', color: 'var(--color-stone)' }}>
                          ({m.teamA.code})
                        </span>
                        {isWinnerA && ' 🏆'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 12px',
                            borderRadius: '12px',
                            background: '#f1f5f9',
                            color: '#0f172a',
                            fontWeight: 700,
                            fontSize: '13px',
                            fontFamily: 'monospace',
                            letterSpacing: '0.5px',
                            border: '1px solid #cbd5e1',
                          }}
                        >
                          {scoreText}
                        </span>
                      </td>
                      <td
                        style={{
                          textAlign: 'left',
                          fontWeight: isWinnerB ? 700 : 500,
                          color: isWinnerB ? '#16a34a' : 'inherit',
                        }}
                      >
                        {isWinnerB && '🏆 '}
                        {m.teamB.name}{' '}
                        <span style={{ fontSize: '11px', color: 'var(--color-stone)' }}>
                          ({m.teamB.code})
                        </span>
                      </td>
                      <td>
                        {isWinnerA ? (
                          <span className="status-pill success" style={{ fontSize: '11px' }}>
                            Menang: {m.teamA.name}
                          </span>
                        ) : isWinnerB ? (
                          <span className="status-pill success" style={{ fontSize: '11px' }}>
                            Menang: {m.teamB.name}
                          </span>
                        ) : isDraw ? (
                          <span className="status-pill warning" style={{ fontSize: '11px' }}>
                            Seri (Draw)
                          </span>
                        ) : (
                          <span className="status-pill neutral" style={{ fontSize: '11px' }}>
                            COMPLETED
                          </span>
                        )}
                        {res?.decisionText && (
                          <div style={{ fontSize: '11px', color: 'var(--color-stone)', marginTop: '2px' }}>
                            {res.decisionText}
                          </div>
                        )}
                        {res?.refereeReference && (
                          <div style={{ fontSize: '10px', color: 'var(--color-stone)' }}>
                            Juri: {res.refereeReference}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Aksi Berisiko */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
        variant={confirmModal.variant}
        requireReason={confirmModal.requireReason}
        reasonLabel={confirmModal.reasonLabel}
        reasonPlaceholder={confirmModal.reasonPlaceholder}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}
