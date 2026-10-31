import type { MatchPhase, MatchStatus, UserRole } from './enums.js'

export interface TransitionContext {
  role: UserRole
  hasStarted: boolean
  currentSegmentStatus?: 'PREPARED' | 'ACTIVE' | 'ENDED' | 'REPLACED' | null
  timerRunning?: boolean
  participantsReady?: boolean
  authorityReference?: string | null
  reason?: string | null
}

export type TransitionCommand =
  | { type: 'select' }
  | { type: 'release' }
  | { type: 'cancel' }
  | { type: 'postpone' }
  | { type: 'select-resume' }
  | { type: 'phase.advance'; targetPhase: MatchPhase }
  | { type: 'phase.override'; targetPhase: MatchPhase; reason: string; authorityReference: string }
  | { type: 'segment.prepare' }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'finalize' }
  | { type: 'reopen'; reason: string; authorityReference: string }
  | { type: 'refinalize'; reason: string; authorityReference: string }
  | { type: 'cancel-correction' }
  | { type: 'rematch' }

export interface TransitionResult {
  allowed: boolean
  targetStatus?: MatchStatus
  targetPhase?: MatchPhase
  errorCode?: string
  message?: string
}

/**
 * Pure transition guard for Match status and phase changes (ML-02, ML-03).
 * Evaluates business invariants without external dependencies.
 */
export function evaluateMatchTransition(
  currentStatus: MatchStatus,
  currentPhase: MatchPhase | null,
  command: TransitionCommand,
  context: TransitionContext,
): TransitionResult {
  const currentP = currentPhase ?? 'PRE_MATCH'

  switch (command.type) {
    case 'select': {
      if (currentStatus !== 'SCHEDULED') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Hanya match berstatus SCHEDULED yang dapat dipilih ke arena.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'PREPARING',
        targetPhase: 'PRE_MATCH',
      }
    }

    case 'release': {
      if (currentStatus === 'PREPARING') {
        if (context.hasStarted) {
          return {
            allowed: false,
            errorCode: 'INVALID_TRANSITION',
            message: 'Match yang telah dimulai tidak boleh dilepas dengan release; gunakan postpone.',
          }
        }
        return {
          allowed: true,
          targetStatus: 'SCHEDULED',
          targetPhase: 'PRE_MATCH',
        }
      }
      if (currentStatus === 'COMPLETED') {
        return {
          allowed: true,
          targetStatus: 'COMPLETED',
          targetPhase: currentP,
        }
      }
      return {
        allowed: false,
        errorCode: 'INVALID_TRANSITION',
        message: 'Match yang sedang aktif atau ditunda tidak dapat dilepas langsung.',
      }
    }

    case 'cancel': {
      if (context.role !== 'SUPER_ADMIN') {
        return {
          allowed: false,
          errorCode: 'FORBIDDEN',
          message: 'Hanya super-admin yang dapat membatalkan pertandingan.',
        }
      }
      if (currentStatus !== 'SCHEDULED') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Hanya match SCHEDULED yang dapat dibatalkan.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'CANCELLED',
        targetPhase: currentP,
      }
    }

    case 'postpone': {
      if (currentStatus !== 'PREPARING' && currentStatus !== 'IN_PROGRESS' && currentStatus !== 'PAUSED') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Match dalam status saat ini tidak dapat ditunda (postpone).',
        }
      }
      return {
        allowed: true,
        targetStatus: 'POSTPONED',
        targetPhase: currentP,
      }
    }

    case 'select-resume': {
      if (currentStatus !== 'POSTPONED') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Hanya match POSTPONED yang dapat di-resume kembali ke arena.',
        }
      }
      return {
        allowed: true,
        targetStatus: context.hasStarted ? 'PAUSED' : 'PREPARING',
        targetPhase: currentP,
      }
    }

    case 'segment.prepare': {
      if (currentStatus !== 'PREPARING' && currentStatus !== 'PAUSED' && currentStatus !== 'IN_PROGRESS') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Persiapan segmen tidak diizinkan pada status match saat ini.',
        }
      }
      if (currentP !== 'READY' && currentP !== 'INTERMISSION') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Persiapan segmen hanya diizinkan pada fase READY atau INTERMISSION.',
        }
      }
      return {
        allowed: true,
        targetStatus: currentStatus,
        targetPhase: 'READY',
      }
    }

    case 'start': {
      if (currentP !== 'READY' && currentP !== 'COMPETITION') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Start kompetisi hanya dapat dilakukan dari fase READY atau COMPETITION yang di-pause.',
        }
      }
      if (currentP === 'READY' && context.currentSegmentStatus !== 'PREPARED') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Tidak dapat memulai kompetisi tanpa persiapan segmen (PREPARED).',
        }
      }
      if (context.participantsReady === false) {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Peserta belum siap atau verifikasi belum selesai.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'IN_PROGRESS',
        targetPhase: 'COMPETITION',
      }
    }

    case 'pause': {
      if (currentStatus !== 'IN_PROGRESS') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Hanya match yang sedang berjalan (IN_PROGRESS) yang dapat di-pause.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'PAUSED',
        targetPhase: currentP,
      }
    }

    case 'phase.advance': {
      const target = command.targetPhase
      if (currentStatus !== 'PREPARING' && currentStatus !== 'IN_PROGRESS' && currentStatus !== 'PAUSED') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Kemajuan fase tidak diizinkan pada status match saat ini.',
        }
      }

      // Valid normal sequence
      const legalSequence: Record<MatchPhase, MatchPhase[]> = {
        PRE_MATCH: ['CALLING', 'RESULT'],
        CALLING: ['VERIFICATION', 'RESULT'],
        VERIFICATION: ['WARMUP', 'RESULT'],
        WARMUP: ['READY', 'RESULT'],
        READY: ['COMPETITION', 'RESULT'],
        COMPETITION: ['INTERMISSION', 'RESULT'],
        INTERMISSION: ['READY', 'RESULT'],
        RESULT: ['FINISHED'],
        FINISHED: [],
      }

      const allowedNext = legalSequence[currentP] ?? []
      if (!allowedNext.includes(target)) {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: `Transisi fase tidak sah dari ${currentP} ke ${target}.`,
        }
      }

      // Special guards
      if (target === 'COMPETITION') {
        if (context.currentSegmentStatus !== 'PREPARED') {
          return {
            allowed: false,
            errorCode: 'INVALID_TRANSITION',
            message: 'Masuk ke COMPETITION memerlukan segmen berstatus PREPARED.',
          }
        }
      }

      if (target === 'RESULT' && currentP !== 'COMPETITION' && currentP !== 'INTERMISSION') {
        if (!context.authorityReference || !context.reason) {
          return {
            allowed: false,
            errorCode: 'AUTHORITY_UNCONFIRMED',
            message: 'Hasil khusus sebelum bermain memerlukan alasan dan referensi juri.',
          }
        }
      }

      let nextStatus: MatchStatus = currentStatus
      if (target === 'FINISHED') {
        nextStatus = 'COMPLETED'
      } else if (target === 'COMPETITION') {
        nextStatus = 'IN_PROGRESS'
      }

      return {
        allowed: true,
        targetStatus: nextStatus,
        targetPhase: target,
      }
    }

    case 'phase.override': {
      if (!command.reason || !command.authorityReference) {
        return {
          allowed: false,
          errorCode: 'INVALID_INPUT',
          message: 'Override fase wajib menyertakan alasan dan referensi otoritas/juri.',
        }
      }
      if (currentStatus === 'IN_PROGRESS' && context.timerRunning) {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Tidak boleh melakukan override fase saat timer kompetisi masih berjalan. Hentikan/pause dahulu.',
        }
      }
      return {
        allowed: true,
        targetStatus: context.hasStarted ? 'PAUSED' : currentStatus,
        targetPhase: command.targetPhase,
      }
    }

    case 'finalize': {
      if (context.timerRunning) {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Pertandingan tidak dapat difinalisasi saat timer masih berjalan.',
        }
      }
      if (currentP !== 'RESULT' && currentP !== 'FINISHED' && currentP !== 'COMPETITION') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Finalisasi hanya dapat dilakukan pada fase RESULT, FINISHED, atau setelah ronde COMPETITION selesai.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'COMPLETED',
        targetPhase: 'FINISHED',
      }
    }

    case 'reopen': {
      if (context.role !== 'SUPER_ADMIN') {
        return {
          allowed: false,
          errorCode: 'FORBIDDEN',
          message: 'Hanya super-admin yang dapat membuka kembali (reopen) hasil resmi.',
        }
      }
      if (currentStatus !== 'COMPLETED') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Hanya match berstatus COMPLETED yang dapat dibuka revisi hasilnya.',
        }
      }
      if (!command.reason || !command.authorityReference) {
        return {
          allowed: false,
          errorCode: 'INVALID_INPUT',
          message: 'Reopen hasil wajib menyertakan alasan dan dasar keputusan juri.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'CORRECTION_PENDING',
        targetPhase: currentP,
      }
    }

    case 'refinalize': {
      if (context.role !== 'SUPER_ADMIN') {
        return {
          allowed: false,
          errorCode: 'FORBIDDEN',
          message: 'Hanya super-admin yang dapat memfinalisasi revisi hasil.',
        }
      }
      if (currentStatus !== 'CORRECTION_PENDING') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Hanya match berstatus CORRECTION_PENDING yang dapat di-refinalize.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'COMPLETED',
        targetPhase: 'FINISHED',
      }
    }

    case 'cancel-correction': {
      if (context.role !== 'SUPER_ADMIN') {
        return {
          allowed: false,
          errorCode: 'FORBIDDEN',
          message: 'Hanya super-admin yang dapat membatalkan koreksi hasil.',
        }
      }
      if (currentStatus !== 'CORRECTION_PENDING') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Hanya match CORRECTION_PENDING yang dapat dibatalkan draf koreksinya.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'COMPLETED',
        targetPhase: 'FINISHED',
      }
    }

    case 'rematch': {
      if (currentStatus !== 'PAUSED' && currentStatus !== 'COMPLETED' && currentStatus !== 'IN_PROGRESS' && currentStatus !== 'PREPARING' && currentP !== 'RESULT') {
        return {
          allowed: false,
          errorCode: 'INVALID_TRANSITION',
          message: 'Tanding ulang tidak dapat dilakukan pada status pertandingan saat ini.',
        }
      }
      return {
        allowed: true,
        targetStatus: 'SCHEDULED',
        targetPhase: 'PRE_MATCH',
      }
    }

    default:
      return {
        allowed: false,
        errorCode: 'INVALID_INPUT',
        message: 'Perintah transisi tidak dikenal.',
      }
  }
}
