# 003 — Tugas Mesin Timer

## Tujuan, Cakupan, dan Dependensi

Semua tugas belum selesai. Cakupan TE-01–TE-07 [spec](spec.md); definisi clock/state ada di [TIMER_SPEC](../../docs/02-engineering/TIMER_SPEC.md). Prasyarat E-01: 001 F-01–F-06 dan 002 L-01–L-03, bukan seluruh lifecycle. Kerjakan sesuai [plan](plan.md).

## Urutan Implementasi

- [ ] E-01 — Sepakati kontrak port timer dengan lifecycle dan DTO tipe/state/unit. Selesai: tidak ada interpretasi berbeda atas stop/reset/set-sisa dan fase-start atomik; keputusan terbuka tercatat.
- [ ] E-02 — Setelah E-01, implementasikan pure engine dan injected monotonic/UTC clock. Selesai: unit seluruh command/state/expiry/negatif/overflow/wall jump membuktikan TE-02/03.
- [ ] E-03 — Setelah E-02, schema/migrasi TimerConfig/Instance beserta snapshot default. Selesai: nilai null tidak start, ganti default tidak mengubah instance; migrasi diuji pada salinan.
- [ ] E-04 — Setelah E-03 dan transaksi F-05, integrasikan command/audit/receipt/outbox serta guard versi. Selesai: retry adjust/reset, conflict dan atomic failure TC-05/06/22/24 lulus.
- [ ] E-05 — Setelah E-04, checkpoint generation/sequence dan expiry internal idempotent. Selesai: race pause/reset vs checkpoint tidak menimpa state baru, expiry tidak finalisasi; latency checkpoint diukur.
- [ ] E-06 — Setelah E-05, startup reconciliation, StorageHealth DEGRADED→RECOVERY_PENDING→HEALTHY, probe/generation gate dan penanganan sleep/continuity error; TC-33 termasuk storage pulih tanpa restart. Selesai: TC-14/23/25 relevan membuktikan recovery menunggu juri/operator, timer tidak auto-resume.
- [ ] E-07 — Setelah E-06, timer.sync/public projection, readinessToken untuk kompetisi, reset waktu vs restart attempt, kontrol waktu/recovery UI dan stale display mengikuti BC. Selesai: DTO/public fields aman, refresh tanpa reset, dua klien browser selaras TC-13/23/27; OBS nyata ditandai menunggu 004.
- [ ] E-08 — Setelah E-07, jalankan matriks TC-05/06/07/13/14/22–25/27 relevan; review TIMER_SPEC/API/README. Selesai: kontrak engine dan bukti integrasi tersedia untuk 002 L-04; keterbatasan performa/OBS nyata dilaporkan.

## Gate dan Keputusan Terbuka

[NEEDS CONFIRMATION] D-01/02/10/11/14 pada [register](../../docs/01-product/RULEBOOK_NOTES.md). Tidak menunggu durasi resmi untuk tes engine berbasis data simulasi, tetapi start resmi diblok sampai persetujuan konfigurasi. [Acceptance](../../docs/03-quality/ACCEPTANCE_CRITERIA.md) mengatur bukti selesai; checkbox tidak menggantikan hasil pengukuran.

## Bukti Tambahan Wajib untuk Tugas di Atas

- [ ] Verifikasi TE-08 dan kontrak remediasi H-03/H-04/H-05/H-06/M-01/M-04/M-05/M-06; cek TC-29/30/31/32/33/36/37 pada scope modul, lalu integrasi lintas modul ketika dependensi nyata tersedia. Selesai hanya bila invariant sukses/gagal terbukti, bukan karena dokumen/tombol dibuat.
- [ ] Perbarui tipe/model/API/UI/runbook sesuai kontrak yang diimplementasikan dan catat hasil PASS/FAIL/BLOCKED/NOT RUN. Persetujuan D-11/D-14/15 yang belum tersedia dilaporkan tersendiri; tugas implementasi ini tetap belum dikerjakan.

Rujukan bukti dan status dokumentasi: [AUDIT_REMEDIATION](../../docs/03-quality/AUDIT_REMEDIATION.md). Checklist ini menambah kriteria pada urutan existing, tidak menciptakan dependensi siklik atau menjadikan impor sebagai prasyarat domain lifecycle.
