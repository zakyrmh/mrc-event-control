# 001 — Tugas Implementasi Tim dan Fondasi

## Tujuan, Cakupan, dan Cara Membaca

Daftar pekerjaan **belum dikerjakan**, bukan laporan implementasi. Cakupan TM-01–TM-06 pada [spec](spec.md); definisi dan urutan global ada di [plan](plan.md). Kerjakan dependensi dahulu; checkbox hanya dicentang setelah bukti selesai, bukan setelah membuat file.

## Fondasi Bersama

- [x] F-01 — Asesmen runtime/lockfile/izin native/versi TS dan aktifkan strict melalui perubahan terpisah. Selesai: kompatibilitas Node/OS diuji, risiko versi dicatat, lint/typecheck relevan lulus, runner unit minimum tersedia sebelum validasi F-02–F-05. Bukti Linux dan batas portabilitas dicatat di [validasi runtime F-01](../../docs/03-quality/F01_RUNTIME_VALIDATION.md); review independen SENTINEL lulus 18 Oktober 2026.
- [ ] F-02 — Setelah F-01, buat paket `packages/shared` dan DTO/error/enum awal Zod. Selesai: ekspor/batas browser-server dan validasi input diuji.
- [ ] F-03 — Setelah F-02, bangun Fastify bootstrap, health/readiness/error envelope dan script dev/build/start yang nyata. Selesai: server uji berjalan dan kegagalan startup jelas; bukan launcher hari-H final.
- [ ] F-04 — Setelah F-03, buat schema/migrasi SQLite awal dan lifecycle koneksi DB. Selesai: fresh DB/salinan diuji, FK/durability ditinjau, backup salinan tersedia sebelum migrasi nyata.
- [ ] F-05 — Setelah F-04, implementasikan transaksi audit/receipt/outbox/revision guard, OperationLedger reservation/terminal/tombstone dan cancel-or-observe OP. Selesai: rollback, key reuse, retry setelah commit, dan konflik paralel dibuktikan TC-19/22/24 fondasi.
- [ ] F-06 — Setelah F-05, buat bootstrap admin, anonymous CSRF bootstrap→login rotation, matriks AUTH tanpa mengurangi hak operator, pencabutan socket saat logout/disable/expiry, fixture serta perluasan harness integrasi/E2E pada runner yang disiapkan F-01. Selesai: TC-18 sukses/penolakan lulus, tidak ada password umum, script tes terdokumentasi.

## Data Peserta dan Jadwal

- [ ] T-01 — Setelah F-06, CRUD/arsip kategori/grup/tim dan formulir admin. Selesai: TM-01/06, kode unik, category mismatch dan arsip diuji.
- [ ] T-02 — Setelah T-01 dan keputusan format D-15, implementasikan preview/commit impor. Selesai: TM-02, all-or-nothing dan stale preview diuji; jika D-15 terbuka tandai pekerjaan terkait BLOCKED.
- [ ] T-03 — Setelah T-01, jadwal manual dengan guard Tim A/B/kategori/grup. Selesai: TM-03, jadwal invalid ditolak dan audit terlihat; tidak menghitung kelolosan.
- [ ] T-04 — Setelah T-02/T-03, jalankan TC-01/02 bagian data/18/19/22 dan uji UI empty/loading/errors. Selesai: seluruh TM terbukti dan script aktual/README diperbarui.

## Gate dan Keputusan Terbuka

Serahkan ke 002 hanya setelah F-01–F-06 dan T-01/T-03 tersedia; impor T-02 tetap wajib sebelum rilis operasional R-01, bukan penghalang seluruh kerja domain independen. [NEEDS CONFIRMATION] D-04/08/15 di [register](../../docs/01-product/RULEBOOK_NOTES.md). Panduan tes: [TEST_PLAN](../../docs/03-quality/TEST_PLAN.md). Semua perubahan ini dilakukan pada tugas implementasi berikutnya; dokumentasi sekarang tidak mengeksekusinya.

## Bukti Tambahan Wajib untuk Tugas di Atas

- [ ] Verifikasi TM-07 dan kontrak remediasi H-05/M-02/M-03/M-06/L-01; cek TC-32/35/37 pada scope modul, lalu integrasi lintas modul ketika dependensi nyata tersedia. Selesai hanya bila invariant sukses/gagal terbukti, bukan karena dokumen/tombol dibuat.
- [ ] Perbarui tipe/model/API/UI/runbook sesuai kontrak yang diimplementasikan dan catat hasil PASS/FAIL/BLOCKED/NOT RUN. Persetujuan D-11/D-14/15 yang belum tersedia dilaporkan tersendiri; tugas implementasi ini tetap belum dikerjakan.

Rujukan bukti dan status dokumentasi: [AUDIT_REMEDIATION](../../docs/03-quality/AUDIT_REMEDIATION.md). Checklist ini menambah kriteria pada urutan existing, tidak menciptakan dependensi siklik atau menjadikan impor sebagai prasyarat domain lifecycle.
