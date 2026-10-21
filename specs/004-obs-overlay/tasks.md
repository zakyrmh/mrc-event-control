# 004 — Tugas Overlay, Produksi, dan Gladi Akhir

## Tujuan, Cakupan, dan Dependensi

Daftar belum dikerjakan untuk OB-01–OB-07 [spec](spec.md). Istilah dan mode ada di [UI/UX](../../docs/02-engineering/UI_UX_GUIDELINES.md). Prasyarat O-01: 001 F-01–F-06/T-01/T-03, 003 E-08, dan 002 L-12. Impor T-02 dan verifikasi T-04 wajib pada O-08, bukan sebelum fondasi lifecycle/OBS. Rincian integrasi ada di [plan](plan.md).

## Urutan Implementasi

- [x] O-01 — Setelah prasyarat, buat public projection/snapshot dan pengujian penyaringan data. Selesai: empat kategori, hasil resmi/draft, match null dan no-private-fields terbukti via `public-projection.test.ts`.
- [x] O-02 — Setelah O-01, integrasikan Socket.IO client/server, outbox events, heartbeat committed revision independen, full snapshot reconnect dan BC resync saat outbox macet. Selesai: event duplicate/out-of-order/gap/runtime baru tidak memundurkan state TC-11/13 via `broadcast-realtime.test.ts`.
- [x] O-03 — Setelah O-02, renderer overlay semua mode/kategori dengan aset lokal dan timer interpolation terbatas. Selesai: nama panjang/transparansi/segmen/gol dan stale ≥3 detik diuji pada browser (`OverlayDisplay.tsx` & `OverlayDisplay.css`).
- [x] O-04 — Setelah O-03, preview dashboard, ack Browser Source terpisah, lastReceived/lastRendered revisions dan status CONNECTED vs SYNCHRONIZED/SYNCING/STALE serta mode Waiting darurat. Selesai: preview tidak mengklaim OBS sehat, timer tetap benar saat tayangan aman TC-27 (`OperatorDashboard.tsx`).
- [x] O-05 — Setelah O-04, static serving produksi, launcher/runtime/path data/log, readiness, shutdown, kartu rilis. Selesai: TC-20, API tidak fallback HTML; startup tanpa dev server/internet/paket unduhan (`production-serving.test.ts`, `start-production.mjs`).
- [ ] O-06 — Setelah O-05, uji OBS nyata, dua resolusi/zoom/keyboard, 100 latency sample, 20 reconnect, drift 10 menit. Selesai: TC-11/13/18/21/23/27 memiliki bukti dan target Q terukur.
- [ ] O-07 — Setelah O-06 dan prosedur backup 002, gladi offline 4 jam/100 match, restart/recovery/restore dan manual fallback bersama lima panitia. Selesai: TC-15/16/17/21/25/26 lulus atau gate ditahan dengan issue jelas.
- [ ] O-08 — Setelah O-07 serta 001 T-02/T-04, review semua R/Q/AC lintas modul, tutup keputusan yang memblokir dan isi runbook/PIC/kartu rilis. Selesai: versi rilis dibekukan, bukti disetujui koordinator/IT/OBS/juri, backup dan lembar manual siap.

## Gate dan Keputusan Terbuka

Tidak menandai produksi siap hanya karena overlay terlihat di Vite. [NEEDS CONFIRMATION] D-03/12/14/15 di [register](../../docs/01-product/RULEBOOK_NOTES.md); target yang tidak tercapai dilaporkan, bukan ditulis lulus. [Acceptance](../../docs/03-quality/ACCEPTANCE_CRITERIA.md) dan [test plan](../../docs/03-quality/TEST_PLAN.md) menentukan bukti setiap checkbox.

## Bukti Tambahan Wajib untuk Tugas di Atas

- [ ] Verifikasi OB-08 dan kontrak remediasi H-01/H-02/H-04/H-05/H-06/H-07/M-04/M-05; cek TC-28/30/31/32/33/34/36 pada scope modul, lalu integrasi lintas modul ketika dependensi nyata tersedia. Selesai hanya bila invariant sukses/gagal terbukti, bukan karena dokumen/tombol dibuat.
- [ ] Perbarui tipe/model/API/UI/runbook sesuai kontrak yang diimplementasikan dan catat hasil PASS/FAIL/BLOCKED/NOT RUN. Persetujuan D-11/D-14/15 yang belum tersedia dilaporkan tersendiri; tugas implementasi ini tetap belum dikerjakan.

Rujukan bukti dan status dokumentasi: [AUDIT_REMEDIATION](../../docs/03-quality/AUDIT_REMEDIATION.md). Checklist ini menambah kriteria pada urutan existing, tidak menciptakan dependensi siklik atau menjadikan impor sebagai prasyarat domain lifecycle.
