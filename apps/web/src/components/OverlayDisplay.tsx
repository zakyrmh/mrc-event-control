import { useEffect, useRef, useState } from 'react'
import type { PublicBroadcastSnapshot } from '@mrc-x/shared'
import { io, type Socket } from 'socket.io-client'
import { formatTime } from '../constants/ui-labels'
import './OverlayDisplay.css'

export interface OverlayDisplayProps {
  clientRole?: 'OBS_BROWSER_SOURCE' | 'DASHBOARD_PREVIEW'
  serverUrl?: string
  initialSnapshot?: PublicBroadcastSnapshot | null
  arenaId?: string
  onTimerUpdate?: (remainingMs: number, timerState: string) => void
}

export function OverlayDisplay({
  clientRole = 'OBS_BROWSER_SOURCE',
  serverUrl,
  initialSnapshot = null,
  arenaId,
  onTimerUpdate,
}: OverlayDisplayProps) {
  const [snapshot, setSnapshot] = useState<PublicBroadcastSnapshot | null>(initialSnapshot)
  const [interpolatedMs, setInterpolatedMs] = useState<number>(0)
  const [isStale, setIsStale] = useState<boolean>(false)
  const [connectionState, setConnectionState] = useState<'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED')
  const [timerState, setTimerState] = useState<string>('IDLE')

  const onTimerUpdateRef = useRef(onTimerUpdate)
  useEffect(() => {
    onTimerUpdateRef.current = onTimerUpdate
  }, [onTimerUpdate])

  const lastHeartbeatTimeRef = useRef<number>(0)
  const timerAnchorWallRef = useRef<number>(0)
  const timerAnchorRemainingRef = useRef<number>(0)
  const timerStateRef = useRef<string>('IDLE')
  const clientInstanceIdRef = useRef<string>('')
  const socketRef = useRef<Socket | null>(null)

  const effectiveArena =
    arenaId ??
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('arena') ?? undefined
      : undefined)

  const syncTimerSnapshot = (remainingMs: number, state: string) => {
    timerAnchorWallRef.current = Date.now()
    timerAnchorRemainingRef.current = remainingMs
    timerStateRef.current = state
    setTimerState(state)
    setInterpolatedMs(remainingMs)
    onTimerUpdateRef.current?.(remainingMs, state)
  }

  // Socket connection to /overlay namespace
  useEffect(() => {
    if (!clientInstanceIdRef.current) {
      clientInstanceIdRef.current = `client-${clientRole}-${Math.random().toString(36).substring(2, 9)}`
    }
    lastHeartbeatTimeRef.current = Date.now()

    const origin = serverUrl ?? window.location.origin

    // Initial snapshot fetch via REST
    const queryStr = effectiveArena ? `?arena=${encodeURIComponent(effectiveArena)}` : ''
    fetch(`${origin}/api/v1/broadcast/main${queryStr}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PublicBroadcastSnapshot | null) => {
        if (data) {
          setSnapshot(data)
          if (data.match?.timer) {
            syncTimerSnapshot(data.match.timer.remainingMs, data.match.timer.state)
          }
        }
      })
      .catch(() => {})

    const socket = io(`${origin}/overlay`, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      query: effectiveArena ? { arena: effectiveArena } : undefined,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnectionState('CONNECTED')
    })

    socket.on('disconnect', () => {
      setConnectionState('DISCONNECTED')
      setIsStale(true)
    })

    socket.on('state.snapshot', (data: PublicBroadcastSnapshot) => {
      setSnapshot(data)
      lastHeartbeatTimeRef.current = Date.now()
      setIsStale(false)

      if (data.match?.timer) {
        syncTimerSnapshot(data.match.timer.remainingMs, data.match.timer.state)
      }

      // Kirim telemetri ACK (BC-02)
      socket.emit('overlay.rendered', {
        clientInstanceId: clientInstanceIdRef.current,
        clientRole,
        runtimeId: data.runtimeId,
        lastReceivedRevision: data.broadcastRevision,
        lastRenderedRevision: data.broadcastRevision,
        timerGeneration: data.match?.timer?.timerGeneration,
        syncSeq: data.match?.timer?.syncSeq,
        renderLatencyMs: 16.6,
      })
    })

    socket.on('match.updated', (data: PublicBroadcastSnapshot) => {
      setSnapshot(data)
      lastHeartbeatTimeRef.current = Date.now()
      setIsStale(false)

      if (data.match?.timer) {
        syncTimerSnapshot(data.match.timer.remainingMs, data.match.timer.state)
      }

      socket.emit('overlay.rendered', {
        clientInstanceId: clientInstanceIdRef.current,
        clientRole,
        runtimeId: data.runtimeId,
        lastReceivedRevision: data.broadcastRevision,
        lastRenderedRevision: data.broadcastRevision,
        timerGeneration: data.match?.timer?.timerGeneration,
        syncSeq: data.match?.timer?.syncSeq,
        renderLatencyMs: 16.6,
      })
    })

    socket.on('timer.sync', (sync: {
      timerId: string | null
      timerGeneration: number
      syncSeq: number
      state: string
      remainingMs: number
      serverNowUtc: string
    }) => {
      lastHeartbeatTimeRef.current = Date.now()
      setIsStale(false)
      syncTimerSnapshot(sync.remainingMs, sync.state)
    })

    socket.on('connection.heartbeat', (_hb) => {
      lastHeartbeatTimeRef.current = Date.now()
      setIsStale(false)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [serverUrl, clientRole, effectiveArena])

  // Timer interpolation & Stale detection loop (100ms)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      const elapsedSinceHeartbeat = now - lastHeartbeatTimeRef.current

      // Stale jika tidak ada heartbeat / sync >= 3000ms (BC-03)
      if (elapsedSinceHeartbeat >= 3000) {
        setIsStale(true)
      }

      if (timerStateRef.current === 'RUNNING') {
        const elapsedSinceAnchor = now - timerAnchorWallRef.current
        const remaining = Math.max(0, timerAnchorRemainingRef.current - elapsedSinceAnchor)
        setInterpolatedMs(remaining)
        onTimerUpdateRef.current?.(remaining, timerStateRef.current)
      } else {
        setInterpolatedMs(timerAnchorRemainingRef.current)
        onTimerUpdateRef.current?.(timerAnchorRemainingRef.current, timerStateRef.current)
      }
    }, 100)

    return () => clearInterval(interval)
  }, [])

  // If no snapshot yet or WAITING / EMERGENCY or match === null
  const currentMatch = snapshot?.match
  const isSafeDisplay =
    snapshot?.safeDisplay ||
    snapshot?.mode === 'WAITING' ||
    snapshot?.mode === 'EMERGENCY' ||
    !currentMatch

  return (
    <div className={`obs-overlay-viewport ${clientRole === 'DASHBOARD_PREVIEW' ? 'is-preview' : ''}`}>
      <div className="obs-score-card">
        {/* Top Header Bar */}
        <div className="obs-header-bar">
          <div className="obs-header-left">
            <span className="obs-brand">MRC X 2026</span>
            {currentMatch && (
              <>
                <span className="obs-category-badge">{currentMatch.category.label}</span>
                {currentMatch.stageLabel && (
                  <span className="obs-stage">{currentMatch.stageLabel}</span>
                )}
                {currentMatch.currentSegment && (
                  <span className="obs-segment">
                    {currentMatch.currentSegment.kind} #{currentMatch.currentSegment.ordinal}
                  </span>
                )}
              </>
            )}
          </div>

          <div className="obs-header-right">
            <span className="obs-mode-label">
              {currentMatch ? currentMatch.displayMode : 'STANDBY'}
            </span>
            <div
              className={`obs-sync-dot ${
                connectionState === 'DISCONNECTED' ? 'disconnected' : isStale ? 'stale' : 'healthy'
              }`}
              title={
                connectionState === 'DISCONNECTED'
                  ? 'Terputus dari server'
                  : isStale
                    ? 'Stale data (>=3 detik)'
                    : 'Tersinkronisasi'
              }
            />
          </div>
        </div>

        {/* Content Body */}
        {isSafeDisplay || !currentMatch ? (
          <div className="obs-safe-banner">
            <span className="obs-safe-title">
              {snapshot?.mode === 'EMERGENCY' ? 'TAYANGAN AMAN / DARURAT' : 'PERTANDINGAN MRC X 2026'}
            </span>
            <span className="obs-safe-subtitle">
              {snapshot?.mode === 'EMERGENCY'
                ? 'Sistem siaran dialihkan ke mode darurat. Pertandingan sedang ditinjau.'
                : 'Menunggu pertandingan selanjutnya dimulai di arena.'}
            </span>
          </div>
        ) : (
          <div className="obs-main-grid">
            {/* Team A */}
            <div className="obs-team team-a">
              <div className="obs-team-info">
                <span className="obs-team-name" title={currentMatch.teamA.name}>
                  {currentMatch.teamA.name}
                </span>
                {currentMatch.teamA.institution && (
                  <span className="obs-team-sub" title={currentMatch.teamA.institution}>
                    {currentMatch.teamA.institution}
                  </span>
                )}
              </div>
            </div>

            {/* Score & Timer Center Box */}
            <div className="obs-center-box">
              {currentMatch.scoreA !== null && currentMatch.scoreB !== null ? (
                <div className="obs-score-display">
                  <span>{currentMatch.scoreA}</span>
                  <span className="obs-score-divider">-</span>
                  <span>{currentMatch.scoreB}</span>
                </div>
              ) : currentMatch.isOfficialResult && currentMatch.officialWinnerSide ? (
                <div className="obs-score-display" style={{ fontSize: '20px', color: '#38bdf8' }}>
                  {currentMatch.officialWinnerSide === 'DRAW'
                    ? 'HASIL SERI'
                    : `PEMENANG: TIM ${currentMatch.officialWinnerSide}`}
                </div>
              ) : null}

              <div
                className={`obs-timer-display ${
                  timerState === 'PAUSED' ? 'paused' : isStale ? 'stale' : ''
                }`}
              >
                {formatTime(interpolatedMs)}
                {timerState === 'PAUSED' && ' (PAUSED)'}
              </div>
            </div>

            {/* Team B */}
            <div className="obs-team team-b">
              <div className="obs-team-info">
                <span className="obs-team-name" title={currentMatch.teamB.name}>
                  {currentMatch.teamB.name}
                </span>
                {currentMatch.teamB.institution && (
                  <span className="obs-team-sub" title={currentMatch.teamB.institution}>
                    {currentMatch.teamB.institution}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
