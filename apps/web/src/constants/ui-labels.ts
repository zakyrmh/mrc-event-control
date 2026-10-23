// Sentralisasi label bahasa Indonesia untuk UI Operator MRC X 2026
// Mencegah kebocoran istilah teknis dan enum internal ke operator di arena.

export const PHASE_LABELS: Record<string, string> = {
  PRE_MATCH: 'Pra-Pertandingan',
  CALLING: 'Pemanggilan Tim',
  VERIFICATION: 'Verifikasi Robot',
  WARMUP: 'Uji Lapangan',
  READY: 'Siap Bertanding',
  COMPETITION: 'Pertandingan Berlangsung',
  INTERMISSION: 'Istirahat Antar-Ronde',
  RESULT: 'Keputusan & Rekap Skor',
  FINISHED: 'Selesai',
}

export const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: 'Terjadwal',
  PREPARING: 'Tahap Persiapan',
  IN_PROGRESS: 'Sedang Bertanding',
  PAUSED: 'Pertandingan Dijeda',
  COMPLETED: 'Selesai',
  POSTPONED: 'Ditunda',
  CANCELLED: 'Dibatalkan',
}

export const BROADCAST_MODE_LABELS: Record<string, string> = {
  AUTO: 'Otomatis',
  WAITING: 'Menunggu',
  EMERGENCY: 'Darurat',
}

export const SYNC_STATUS_LABELS: Record<string, string> = {
  SYNCHRONIZED: 'Tersinkronisasi',
  SYNCING: 'Sedang Sinkronisasi',
  STALE: 'Koneksi Lambat (Stale)',
  DISCONNECTED: 'Terputus',
  UNKNOWN: 'Memeriksa...',
}

export function formatPhase(phase: string | null | undefined): string {
  if (!phase) return 'Pra-Pertandingan'
  return PHASE_LABELS[phase] ?? phase
}

export function formatStatus(status: string | null | undefined): string {
  if (!status) return 'Terjadwal'
  return STATUS_LABELS[status] ?? status
}

export function formatTime(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}
