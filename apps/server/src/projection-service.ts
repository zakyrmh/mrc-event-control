import type { PrismaClient } from '@prisma/client'
import type {
  BroadcastMode,
  PublicBroadcastSnapshot,
  PublicMatchProjection,
  PublicTimerProjection,
} from '@mrc-x/shared'
import type { TimerService } from './timer-service.js'

export interface ProjectionServiceOptions {
  client: PrismaClient
  timerService?: TimerService
  runtimeId?: string
}

export function formatDisplayMode(status: string, phase: string | null): string {
  if (status === 'PAUSED') {
    return 'Dijeda'
  }
  if (status === 'COMPLETED') {
    return 'Selesai'
  }
  if (status === 'POSTPONED') {
    return 'Ditunda'
  }

  switch (phase) {
    case 'PRE_MATCH':
      return 'Tunggu Tanding'
    case 'CALLING':
      return 'Pemanggilan Tim'
    case 'VERIFICATION':
      return 'Verifikasi Robot'
    case 'WARMUP':
      return 'Uji Lapangan'
    case 'READY':
      return 'Siap Pertandingan'
    case 'COMPETITION':
      return 'Pertandingan'
    case 'INTERMISSION':
      return 'Istirahat'
    case 'RESULT':
      return 'Menunggu Keputusan'
    default:
      return 'Tunggu Tanding'
  }
}

export class ProjectionService {
  private readonly client: PrismaClient
  private readonly timerService?: TimerService
  public readonly runtimeId: string
  private broadcastMode: BroadcastMode = 'AUTO'
  private broadcastRevision: number = 1

  constructor(options: ProjectionServiceOptions) {
    this.client = options.client
    this.timerService = options.timerService
    this.runtimeId = options.runtimeId ?? 'runtime-default'
  }

  setBroadcastMode(mode: BroadcastMode): void {
    this.broadcastMode = mode
    this.bumpBroadcastRevision()
  }

  getBroadcastMode(): BroadcastMode {
    return this.broadcastMode
  }

  getBroadcastRevision(): number {
    return this.broadcastRevision
  }

  bumpBroadcastRevision(): number {
    this.broadcastRevision += 1
    return this.broadcastRevision
  }

  async getPublicSnapshot(arenaId?: string): Promise<PublicBroadcastSnapshot> {
    const serverNowUtc = new Date().toISOString()
    let arena = null
    if (arenaId) {
      arena = await this.client.arenaState.findUnique({ where: { id: arenaId } })
    } else {
      // Fallback global jika klien tidak menyertakan parameter arena
      arena = (await this.client.arenaState.findFirst({ where: { activeMatchId: { not: null } } })) ??
        (await this.client.arenaState.findUnique({ where: { id: 'main' } }))
    }

    const arenaVersion = arena?.arenaVersion ?? 1
    const activeMatchId = arena?.activeMatchId

    // Jika mode WAITING atau EMERGENCY, tayangan netral
    if (this.broadcastMode === 'WAITING' || this.broadcastMode === 'EMERGENCY' || !activeMatchId) {
      return {
        runtimeId: this.runtimeId,
        broadcastRevision: this.broadcastRevision,
        arenaVersion,
        mode: this.broadcastMode,
        safeDisplay: this.broadcastMode === 'EMERGENCY',
        match: null,
        serverNowUtc,
      }
    }

    const match = await this.client.match.findUnique({
      where: { id: activeMatchId },
      include: {
        category: true,
        teamA: true,
        teamB: true,
        participants: {
          include: { team: true },
        },
        segments: {
          orderBy: [{ ordinal: 'desc' }, { attempt: 'desc' }],
          take: 1,
        },
        goals: true,
        results: {
          where: { status: 'FINAL' },
          orderBy: { revision: 'desc' },
          take: 1,
        },
        timerInstances: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    if (!match) {
      return {
        runtimeId: this.runtimeId,
        broadcastRevision: this.broadcastRevision,
        arenaVersion,
        mode: this.broadcastMode,
        safeDisplay: false,
        match: null,
        serverNowUtc,
      }
    }

    const teamAParticipant = match.participants.find((p) => p.side === 'A')
    const teamBParticipant = match.participants.find((p) => p.side === 'B')

    const teamA = teamAParticipant
      ? {
          id: teamAParticipant.teamId,
          code: teamAParticipant.team.code,
          name: teamAParticipant.team.name,
          institution: teamAParticipant.team.institution,
        }
      : {
          id: match.teamA.id,
          code: match.teamA.code,
          name: match.teamA.name,
          institution: match.teamA.institution,
        }

    const teamB = teamBParticipant
      ? {
          id: teamBParticipant.teamId,
          code: teamBParticipant.team.code,
          name: teamBParticipant.team.name,
          institution: teamBParticipant.team.institution,
        }
      : {
          id: match.teamB.id,
          code: match.teamB.code,
          name: match.teamB.name,
          institution: match.teamB.institution,
        }

    // Timer projection (dari TimerService aktif jika ada, atau TimerInstance di DB)
    let timerProj: PublicTimerProjection
    if (this.timerService) {
      try {
        const snap = await this.timerService.getSnapshot(match.id)
        timerProj = {
          timerId: snap.id,
          state: snap.state,
          initialMs: snap.initialMs,
          remainingMs: snap.remainingMs,
          serverNowUtc,
          anchorWallUtc: snap.anchorWallUtc,
          timerGeneration: snap.timerGeneration,
          syncSeq: snap.checkpointSeq,
        }
      } catch {
        timerProj = this.fallbackTimerProjection(match.timerInstances[0], serverNowUtc)
      }
    } else {
      timerProj = this.fallbackTimerProjection(match.timerInstances[0], serverNowUtc)
    }

    const latestSegment = match.segments[0]
    const currentSegment = latestSegment
      ? {
          kind: latestSegment.kind,
          ordinal: latestSegment.ordinal,
          attempt: latestSegment.attempt,
        }
      : null

    // Hitung gol dari GoalEvent
    const computedGoalsA = match.goals
      .filter((g) => g.side === 'A')
      .reduce((sum, g) => sum + g.delta, 0)
    const computedGoalsB = match.goals
      .filter((g) => g.side === 'B')
      .reduce((sum, g) => sum + g.delta, 0)

    // Skor publik: hanya tampil angka jika SOCCER atau jika sudah ada gol
    const isSoccer = match.category.code.toUpperCase().includes('SOCCER')
    const scoreA = isSoccer || computedGoalsA > 0 ? computedGoalsA : null
    const scoreB = isSoccer || computedGoalsB > 0 ? computedGoalsB : null

    // Hasil resmi: hanya jika COMPLETED dan ada finalized revision
    const finalizedRev = match.results[0]
    const isOfficialResult = match.status === 'COMPLETED' && Boolean(finalizedRev)
    let officialWinnerSide: 'A' | 'B' | 'DRAW' | null = null

    if (isOfficialResult && finalizedRev) {
      const gA = finalizedRev.finalGoalsA ?? 0
      const gB = finalizedRev.finalGoalsB ?? 0
      if (gA > gB) {
        officialWinnerSide = 'A'
      } else if (gB > gA) {
        officialWinnerSide = 'B'
      } else {
        officialWinnerSide = 'DRAW'
      }
    }

    const matchProj: PublicMatchProjection = {
      matchId: match.id,
      sequence: match.sequence,
      stageLabel: match.stageLabel,
      category: {
        code: match.category.code,
        label: match.category.label,
      },
      displayMode: formatDisplayMode(match.status, match.phase),
      phase: match.phase as any,
      status: match.status as any,
      teamA,
      teamB,
      scoreA,
      scoreB,
      currentSegment,
      timer: timerProj,
      officialWinnerSide,
      isOfficialResult,
    }

    return {
      runtimeId: this.runtimeId,
      broadcastRevision: this.broadcastRevision,
      arenaVersion,
      mode: this.broadcastMode,
      safeDisplay: false,
      match: matchProj,
      serverNowUtc,
    }
  }

  private fallbackTimerProjection(
    timerInstance: any | undefined,
    serverNowUtc: string,
  ): PublicTimerProjection {
    if (!timerInstance) {
      return {
        timerId: null,
        state: 'IDLE',
        initialMs: 0,
        remainingMs: 0,
        serverNowUtc,
        anchorWallUtc: null,
        timerGeneration: 0,
        syncSeq: 0,
      }
    }

    return {
      timerId: timerInstance.id,
      state: timerInstance.state,
      initialMs: timerInstance.initialMs,
      remainingMs: timerInstance.remainingAtAnchorMs,
      serverNowUtc,
      anchorWallUtc: timerInstance.anchorWallUtc
        ? timerInstance.anchorWallUtc.toISOString()
        : null,
      timerGeneration: timerInstance.timerGeneration ?? 1,
      syncSeq: timerInstance.checkpointSeq ?? 0,
    }
  }
}
