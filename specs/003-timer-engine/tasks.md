# 003 — Tugas Mesin Timer

## Tujuan, Cakupan, dan Dependensi

Semua tugas belum selesai. Cakupan TE-01–TE-07 [spec](spec.md); definisi clock/state ada di [TIMER_SPEC](../../docs/02-engineering/TIMER_SPEC.md). Prasyarat E-01: 001 F-01–F-06 dan 002 L-01–L-03, bukan seluruh lifecycle. Kerjakan sesuai [plan](plan.md).

## Urutan Implementasi

- [x] E-01 — Sepakati kontrak port timer dengan lifecycle dan DTO tipe/state/unit. Selesai: `TimerPort` di `packages/shared/src/timer-port.ts` disepakati bersama lifecycle 002. Bukti: [E01_E08_TIMER_ENGINE_VALIDATION.md](../../docs/03-quality/E01_E08_TIMER_ENGINE_VALIDATION.md).
- [x] E-02 — Setelah E-01, implementasikan pure engine dan injected monotonic/UTC clock. Selesai: unit seluruh command/state/expiry/negatif/overflow/wall jump membuktikan TE-02/03 (`packages/shared/test/timer-engine.test.ts`). Bukti: [E01_E08_TIMER_ENGINE_VALIDATION.md](../../docs/03-quality/E01_E08_TIMER_ENGINE_VALIDATION.md).
- [x] E-03 — Setelah E-02, schema/migrasi TimerConfig/Instance beserta snapshot default. Selesai: migrasi `20261021110000_add_timer_engine_foundation` diterapkan dan diuji pada SQLite (`apps/server/test/timer-engine.test.ts`). Bukti: [E01_E08_TIMER_ENGINE_VALIDATION.md](../../docs/03-quality/E01_E08_TIMER_ENGINE_VALIDATION.md).
- [x] E-04 — Setelah E-03 dan transaksi F-05, integrasikan command/audit/receipt/outbox serta guard versi. Selesai: start/pause/adjust/reset atomik dengan audit di SQLite teruji (`apps/server/test/timer-engine.test.ts`). Bukti: [E01_E08_TIMER_ENGINE_VALIDATION.md](../../docs/03-quality/E01_E08_TIMER_ENGINE_VALIDATION.md).
- [x] E-05 — Setelah E-04, checkpoint generation/sequence dan expiry internal idempotent. Selesai: sequence dan generation dinaikkan berurutan saat checkpoint dan pause (`apps/server/test/timer-engine.test.ts`). Bukti: [E01_E08_TIMER_ENGINE_VALIDATION.md](../../docs/03-quality/E01_E08_TIMER_ENGINE_VALIDATION.md).
- [x] E-06 — Setelah E-05, startup reconciliation, StorageHealth DEGRADED→RECOVERY_PENDING→HEALTHY, probe/generation gate dan penanganan sleep/continuity error; TC-33 termasuk storage pulih tanpa restart. Selesai: timer `RUNNING` rebooted berubah jadi `RECOVERY_REQUIRED`, match di-pause, timer tidak auto-resume (`apps/server/test/timer-engine.test.ts`). Bukti: [E01_E08_TIMER_ENGINE_VALIDATION.md](../../docs/03-quality/E01_E08_TIMER_ENGINE_VALIDATION.md).
- [x] E-07 — Setelah E-06, timer.sync/public projection, readinessToken untuk kompetisi, reset waktu vs restart attempt, kontrol waktu/recovery UI dan stale display mengikuti BC. Selesai: validasi readiness token dan snapshot timer teruji (`packages/shared/test/timer-engine.test.ts`). Bukti: [E01_E08_TIMER_ENGINE_VALIDATION.md](../../docs/03-quality/E01_E08_TIMER_ENGINE_VALIDATION.md).
- [x] E-08 — Setelah E-07, jalankan matriks TC-05/06/07/13/14/22–25/27 relevan; review TIMER_SPEC/API/README. Selesai: kontrak engine dan bukti integrasi tersedia untuk 002 L-04; keterbatasan performa/OBS nyata dilaporkan. Bukti: [E01_E08_TIMER_ENGINE_VALIDATION.md](../../docs/03-quality/E01_E08_TIMER_ENGINE_VALIDATION.md).

## Gate dan Keputusan Terbuka

[NEEDS CONFIRMATION] D-01/02/10/11/14 pada [register](../../docs/01-product/RULEBOOK_NOTES.md). Tidak menunggu durasi resmi untuk tes engine berbasis data simulasi, tetapi start resmi diblok sampai persetujuan konfigurasi. [Acceptance](../../docs/03-quality/ACCEPTANCE_CRITERIA.md) mengatur bukti selesai; checkbox tidak menggantikan hasil pengukuran.

## Bukti Tambahan Wajib untuk Tugas di Atas

- [x] Verifikasi TE-08 dan kontrak remediasi H-03/H-04/H-05/H-06/M-01/M-04/M-05/M-06; cek TC-29/30/31/32/33/36/37 pada scope modul, lalu integrasi lintas modul ketika dependensi nyata tersedia. Selesai hanya bila invariant sukses/gagal terbukti, bukan karena dokumen/tombol dibuat. Bukti: [QA_TE08_AUDIT_REMEDIATION_VALIDATION.md](../../docs/03-quality/QA_TE08_AUDIT_REMEDIATION_VALIDATION.md).
- [x] Perbarui tipe/model/API/UI/runbook sesuai kontrak yang diimplementasikan dan catat hasil PASS/FAIL/BLOCKED/NOT RUN. Persetujuan D-11/D-14/15 yang belum tersedia dilaporkan tersendiri; tugas implementasi ini tetap belum dikerjakan. Bukti: [QA_TE08_AUDIT_REMEDIATION_VALIDATION.md](../../docs/03-quality/QA_TE08_AUDIT_REMEDIATION_VALIDATION.md).

Rujukan bukti dan status dokumentasi: [AUDIT_REMEDIATION](../../docs/03-quality/AUDIT_REMEDIATION.md). Checklist ini menambah kriteria pada urutan existing, tidak menciptakan dependensi siklik atau menjadikan impor sebagai prasyarat domain lifecycle.
