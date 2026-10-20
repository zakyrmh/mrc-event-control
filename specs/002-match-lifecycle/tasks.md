# 002 — Tugas Lifecycle, Hasil, dan Operasi Data

## Tujuan, Cakupan, dan Dependensi

Semua checkbox belum selesai. Cakupan ML-01–ML-08 [spec](spec.md). Istilah mengikuti [CONTEXT](../../CONTEXT.md). Urutan [plan](plan.md) membagi domain awal dan integrasi setelah engine timer tersedia.

## Domain Awal — Sebelum 003

- [x] L-01 — Setelah 001 F-01–F-06 dan T-01/T-03, tambah migrasi match/arena/peserta/segmen beserta snapshot identitas. Selesai: constraint, satu match aktif (`ArenaState`), peserta unik per sisi (`MatchParticipant`), segmen unik per ordinal/attempt (`SegmentAttempt`), dan revisi hasil unik (`ResultRevision`) diuji pada SQLite (`apps/server/test/match-lifecycle-foundation.test.ts`). Bukti: [L01_L03_MATCH_LIFECYCLE_FOUNDATION_VALIDATION.md](../../docs/03-quality/L01_L03_MATCH_LIFECYCLE_FOUNDATION_VALIDATION.md).
- [x] L-02 — Setelah L-01, implementasikan pure transition/role/override guards. Selesai: semua edge normal dan contoh larangan TC-03/04/12 dibuktikan (`packages/shared/test/lifecycle-fsm.test.ts`); keputusan D yang memblokir tidak ditebak. Bukti: [L01_L03_MATCH_LIFECYCLE_FOUNDATION_VALIDATION.md](../../docs/03-quality/L01_L03_MATCH_LIFECYCLE_FOUNDATION_VALIDATION.md).
- [x] L-03 — Setelah L-02, definisikan port timer atomik, segmen/attempt dan snapshot recovery bersama 003. Selesai: tipe/semantik antarmuka `TimerPort` disepakati dan `FakeTimerPort` deterministik digunakan untuk tes guard (`packages/shared/src/timer-port.ts`); mesin timer belum dinyatakan tersedia. Bukti: [L01_L03_MATCH_LIFECYCLE_FOUNDATION_VALIDATION.md](../../docs/03-quality/L01_L03_MATCH_LIFECYCLE_FOUNDATION_VALIDATION.md).

## Integrasi — Setelah 003 E-08

- [x] L-04 — Setelah L-03 dan 003 E-08, implementasikan pilih pertama/select-resume/release/advance/pause/postpone dengan engine timer, matriks state gabungan dan versi arena+match; first attempt PREPARED→ACTIVE atomik. Selesai: TC-02/03/12, snapshot tim beku atomik, persist-before-broadcast dan atomic rollback lulus (`apps/server/test/match-lifecycle-integration.test.ts`). Bukti: [L04_MATCH_INTEGRATION_VALIDATION.md](../../docs/03-quality/L04_MATCH_INTEGRATION_VALIDATION.md).
- [x] L-05 — Setelah L-04, override/ulang segmen berizin beserta impact review dan audit. Selesai: ML-03/04 dan TC-04/07 sukses/penolakan lulus (`apps/server/test/match-lifecycle-integration.test.ts`). Bukti: [L05_L07_LIFECYCLE_GOAL_RESULT_VALIDATION.md](../../docs/03-quality/L05_L07_LIFECYCLE_GOAL_RESULT_VALIDATION.md).
- [x] L-06 — Setelah L-05, GoalIntent sekali pakai/rearm eksplisit, event gol Soccer/goal.reassign atomik dan UI sisi tetap; TC-28/32/37 termasuk respons 0 ms. Selesai: TC-08/22, gol negatif/duplikat/attempt terganti ditangani benar (`apps/server/test/match-lifecycle-integration.test.ts`). Bukti: [L05_L07_LIFECYCLE_GOAL_RESULT_VALIDATION.md](../../docs/03-quality/L05_L07_LIFECYCLE_GOAL_RESULT_VALIDATION.md).
- [x] L-07 — Setelah L-06, draft/final/reopen/refinalize/cancel-correction. Selesai: TC-09/10/19, hasil resmi lama terlindungi dan timer aktif menghalangi finalisasi (`apps/server/test/match-lifecycle-integration.test.ts`). Bukti: [L05_L07_LIFECYCLE_GOAL_RESULT_VALIDATION.md](../../docs/03-quality/L05_L07_LIFECYCLE_GOAL_RESULT_VALIDATION.md).
- [ ] L-08 — Setelah L-07, dashboard operator, review/arm sebelum aba-aba dan satu aksi start, ledger pulih sesudah refresh, empty/loading/error/recovery dan preview kontrak publik (belum bukti OBS). Selesai: perjalanan normal/khusus dapat diuji tanpa navigasi berlebih.
- [ ] L-09 — Setelah L-07, backup konsisten + manifest/checksum dan restore-check pada salinan. Selesai: sumber DB+WAL benar, backup rusak ditolak, salinan bisa dipulihkan TC-16.
- [ ] L-10 — Setelah L-09 dan dukungan restart 003, buat prosedur/launcher restore maintenance berdasarkan penulis berhenti, backup durable RUNNING→recovery, serta impor historis REC atomik dengan recordId/occurredAt/recordedAt/refereeReference. Target RO-01–04 diukur; persetujuan M-04 tetap terbuka. Selesai: TC-16/17/25, runtime/sesi lama tidak replay setelah restore, DB saat ini diarsip.
- [ ] L-11 — Setelah L-08/L-10, integrasi dua tab/failure injection dan UAT awal. Selesai: TC-02–04/07–10/12/16–19/21/22/24 relevan lulus, kekurangan OBS nyata ditandai menunggu 004.
- [ ] L-12 — Setelah L-11, review ketertelusuran ML dan dokumentasi/API/runbook. Selesai: kontrak sesuai implementasi, bukti tersimpan dan 004 mendapat snapshot committed yang stabil.

## Gate dan Keputusan Terbuka

Finalisasi tidak dianggap selesai bila audit, duplicate protection atau restore belum terbukti. [NEEDS CONFIRMATION] D-03–D-12/15 pada [register](../../docs/01-product/RULEBOOK_NOTES.md); minta keputusan cabang terkait sambil melanjutkan fondasi independen. [Test plan](../../docs/03-quality/TEST_PLAN.md) dan [acceptance](../../docs/03-quality/ACCEPTANCE_CRITERIA.md) menjadi kriteria selesai.

## Bukti Tambahan Wajib untuk Tugas di Atas

- [ ] Verifikasi ML-09 dan kontrak remediasi H-01/H-02/H-03/H-05/H-07/M-01/M-02/M-04/M-05/M-06; cek TC-28/29/30/32/34/35/36/37 pada scope modul, lalu integrasi lintas modul ketika dependensi nyata tersedia. Selesai hanya bila invariant sukses/gagal terbukti, bukan karena dokumen/tombol dibuat.
- [ ] Perbarui tipe/model/API/UI/runbook sesuai kontrak yang diimplementasikan dan catat hasil PASS/FAIL/BLOCKED/NOT RUN. Persetujuan D-11/D-14/15 yang belum tersedia dilaporkan tersendiri; tugas implementasi ini tetap belum dikerjakan.

Rujukan bukti dan status dokumentasi: [AUDIT_REMEDIATION](../../docs/03-quality/AUDIT_REMEDIATION.md). Checklist ini menambah kriteria pada urutan existing, tidak menciptakan dependensi siklik atau menjadikan impor sebagai prasyarat domain lifecycle.
