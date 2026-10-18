# 003 — Spesifikasi Mesin Timer

## Tujuan, Cakupan, dan Status

Menghasilkan waktu yang dapat dikendalikan, ditelusuri, dan dipulihkan tanpa mengubah keputusan juri. Mencakup R-05/06/11/17 dan Q-05/07/09 pada [PRD](../../docs/01-product/PRD.md). Desain detail **[PROPOSED]**, belum ada implementasi. Timer pemanggilan/pemanasan/pertandingan/jeda berbeda tujuan, bukan satu durasi yang dipakai ulang tanpa label.

## Definisi dan User Stories

Sisa waktu adalah nilai otoritatif server. Monotonic clock mengukur selang dalam satu proses; UTC untuk audit dan petunjuk downtime. Operator ingin start/pause/resume/stop/reset dan koreksi sisa tanpa kehilangan sejarah. Super-admin ingin mengatur default per kategori/fase. Setelah restart, operator ingin memeriksa waktu bersama juri sebelum melanjutkan.

## Kebutuhan dan Aturan

- TE-01 (R-05/17): konfigurasi awal per tipe/kategori/tahap dengan sumber persetujuan; nilai null berarti belum disetujui dan tidak dapat dimulai. Instance menyalin default saat dibuat.
- TE-02 (R-05): start/pause/resume/stop/reset, delta tambah/kurang, dan set sisa absolut mengikuti [TIMER_SPEC](../../docs/02-engineering/TIMER_SPEC.md). Stop mempertahankan sisa; reset mengembalikan initialMs; add pada EXPIRED menjadi PAUSED.
- TE-03 (R-05/06): satu timer berjalan per match, tipe sesuai fase/attempt; 00:00 tidak mengubah fase/hasil. Segmen baru menggunakan instance baru, bukan menghapus waktu segmen lama.
- TE-04 (R-11/Q-05): setiap command persisten/audited, checkpoint target ≤1 detik dengan generation guard; restart RUNNING menjadi RECOVERY_REQUIRED, tidak auto-resume.
- TE-05 (R-11): rekonsiliasi memakai catatan juri; downtime wall clock hanya perkiraan. Reconcile lalu resume adalah tindakan terpisah.
- TE-06 (Q-07): dashboard/OBS memakai snapshot yang sama, boleh extrapolasi lokal terbatas; snapshot lama/runtime lama tidak menimpa state baru.
- TE-07 (R-15/Q-04/08): idempotency dan optimistic version menjaga adjust/reset/expiry tidak ganda; write gagal tidak menghasilkan respons sukses.

## Kasus Tepi dan Penerimaan

Durasi negatif/overflow/noninteger ditolak, subtract melewati nol tidak clamp diam-diam. Timer habis dekat adjust/pause diproses deterministik berdasarkan state/version terkini. Wall clock jump tidak mengubah selang aktif; sleep/resume yang meragukan memerlukan rekonsiliasi. Checkpoint lama tidak boleh menimpa reset baru. Putus browser tidak mereset server; listrik padam tidak dijanjikan tanpa kehilangan data.

Bukti: [AC-05/06/07/13/14/22–25/27](../../docs/03-quality/ACCEPTANCE_CRITERIA.md). Given timer RUNNING tersimpan, When proses restart, Then state recovery dan operator harus menetapkan sisa sebelum resume. Given default baru diubah, When instance lama dilihat, Then initial/sisanya tidak berubah diam-diam.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-01/02/10/11/14: durasi dan metode panggilan, izin, batas teknis/checkpoint. [Plan](plan.md), [tasks](tasks.md), [state machine](../../docs/02-engineering/STATE_MACHINE.md), [data](../../docs/02-engineering/DATA_MODEL.md), [register](../../docs/01-product/RULEBOOK_NOTES.md).

## Penajaman Kebutuhan Setelah Audit

**[PROPOSED] TE-08 (R-05/R-06/R-11/Q-08):** Engine tunduk pada matriks kombinasi dan activeMatchId; reset hanya waktu, restart attempt melalui lifecycle. Kompetisi start/resume memerlukan StartAuthorization; waktu mulai di server dicatat monotonic terpisah waktu input/render. E-06 mengimplementasikan ST dengan gate volatile saat DB tidak dapat ditulis, probe terukur dan rekonsiliasi tanpa restart; tidak auto-resume setelah sehat. E-07 memakai OP serta timer.sync freshness BC. Recovery timer dari backup RUNNING tidak menuntut proses lama dapat dijeda. E-08 membuktikan kontrak dengan fake lifecycle port dan SQLite nyata; integrasi lengkap berikutnya L-04, OBS nyata O-06.

Ketertelusuran: H-03/H-04/H-05/H-06/M-01/M-04/M-05/M-06 → AC-29/30/31/32/33/36/37, dengan subkasus sukses/gagal pada [acceptance](../../docs/03-quality/ACCEPTANCE_CRITERIA.md). Definisi normatif tetap di API SC/OP/AUTH/REC, STATE_MACHINE, TIMER_SPEC ST, ARCHITECTURE BC dan RUNBOOK RO; tidak membuat aturan kategori baru. [NEEDS CONFIRMATION] D-11/D-14/15 yang relevan tetap gate pemakaian resmi, bukan alasan menghapus hak operator atau menunda fondasi independen. [Status audit](../../docs/03-quality/AUDIT_REMEDIATION.md).
