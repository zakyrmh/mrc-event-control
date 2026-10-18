# 001 — Rencana Teknis Tim dan Fondasi

## Tujuan, Cakupan, dan Status

**[PROPOSED]** Rencana TM-01–TM-06 pada [spec](spec.md), termasuk fondasi yang belum ada. Tidak menjalankan instalasi atau migrasi dalam pekerjaan dokumentasi. Definisi domain mengikuti [CONTEXT](../../CONTEXT.md).

## Dependensi dan Urutan Global

Urutan implementasi yang direncanakan:

```text
001 F-01..F-06 → T-01 → T-03 → 002 L-01..L-03 → 003 E-01..E-08
                                               → 002 L-04..L-12 → 004 O-01..O-07
001 T-01 → T-02 (impor, menunggu D-15) + T-03 → T-04 ───────────→ 004 O-08 gate rilis
```

002 L-01 memerlukan tepat F-01–F-06, T-01 dan T-03; T-02/T-04 bukan dependensi domain lifecycle. T-02 dan T-04 tetap wajib sebelum O-08/rilis acara. Timer tidak menunggu seluruh 002 selesai; hanya domain/kontrak segmen awal. Lifecycle akhir menunggu engine timer. Ini memutus dependensi siklik tanpa stub yang dianggap sudah berfungsi.

## Desain dan Data

F-01 meninjau runtime Node, versi TypeScript lintas paket, lockfile, izin native build dan target strict, serta menyediakan runner unit minimum untuk validasi tahap fondasi. F-02 menyiapkan package shared dan DTO Zod; F-03 bootstrap Fastify dan error envelope; F-04 SQLite/Prisma dengan migrasi awal yang ditinjau. F-05 membangun unit-of-work state/audit/receipt/outbox dan compare-and-swap; F-06 sesi/RBAC/CSRF serta perluasan fixture/harness integrasi dan E2E. Perintah dev/build/test backend baru didokumentasikan setelah script benar-benar tersedia.

Entitas awal: EventConfig, Category, Group, Team, GroupMembership, User, Session, AuditEntry, CommandReceipt, OutboxEvent; Match jadwal memakai subset model yang diekspansi 002. Gunakan schema yang versioned, constraint unik/FK, dan transaksi. Jangan membuat record database contoh sebagai aturan kompetisi resmi. Default durasi tetap belum disetujui.

Tim/grup/jadwal menggunakan REST admin [API](../../docs/02-engineering/API_CONTRACT.md); React Router/form validation dan komponen UI target dievaluasi saat implementasi. Zustand hanya untuk state presentasi jika diperlukan. Import preview menyimpan hash/revisi catalog, errors dan diff; commit memeriksa ulang isi, constraint dan role dalam transaksi. Shared schema adalah batas data, bukan tempat Prisma client/browser password.

## Integrasi dan Risiko

001 memasok daftar tim/grup/jadwal untuk 002; tidak mengaktifkan match atau membangun turnamen otomatis. Perubahan nama tidak menulis ulang snapshot sejarah 002. R-14 harus tersedia sebelum endpoint mutasi dipakai secara operasional. Risiko utama: perbedaan versi TS/Node, native SQLite, lock instalasi tidak lengkap, data duplikat, dan impor merusak master. Mitigasi: uji compatibility/fresh install pada tugas terpisah, preview, transaksi, arsip, revision conflict dan backup sebelum perubahan data nyata.

## Validasi dan Penyelesaian

Vitest/integrasi SQLite nyata untuk validasi CSV, constraint, rollback, receipt dan sesi; E2E admin/operator untuk formulir, role dan errors. Jalankan AC-01/02 bagian jadwal/18/19/22; AC-02 aktivasi menunggu 002. Uji migrasi fresh DB dan salinan, tanpa menyentuh DB acara. Selesai bila TM terpenuhi, tes bukti tersedia, README memuat script aktual, dan keputusan yang masih memblokir dilaporkan.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-15: kebijakan akun, format/batas impor dan retensi; D-04/08 format grup/jadwal. [ADR stack](../../docs/04-decisions/0002-tech-stack.md), [data](../../docs/02-engineering/DATA_MODEL.md), [tasks](tasks.md).

## Integrasi dan Validasi Remediasi

**[PROPOSED]** Fondasi OP menyediakan reservation, terminal receipt dan tombstone teruji sebelum lifecycle. AUTH menyediakan bootstrap anonim, rotasi sesi/CSRF, permission matrix operator/admin, dan keputusan lapangan sebagai authorityReference terpisah. F-05/F-06 membuktikan TC-32/35/37 di fixture; E2E gol/siaran penuh menyusul 002/004. Master resource/catalog revisions mengikat preview dan transaksi. Impor T-02 menunggu D-15 dan tetap gate rilis, tidak menjadi dependensi L-01.

Perubahan model/DTO/migrasi direncanakan, tidak dijalankan oleh dokumentasi. Uji TC-32/35/37 dengan fault/urutan yang sama seperti [test plan](../../docs/03-quality/TEST_PLAN.md); bukti harus membedakan snapshot committed, observasi volatile, dan hasil belum diketahui. Selesaikan penolakan/duplikasi/rollback sebelum menandai feature selesai. Sinkronisasi persetujuan dan residual risk: [remediasi](../../docs/03-quality/AUDIT_REMEDIATION.md).
