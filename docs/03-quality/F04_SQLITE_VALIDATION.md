# Bukti Validasi F-04 SQLite

Tanggal: 18 Oktober 2026. Lingkungan: Linux, Node.js 24.22.0, pnpm 12.11.2,
Prisma 7.10.0, better-sqlite3 12.11.1. Seluruh database validasi dibuat di
direktori sementara; tidak ada database acara atau deployment produksi yang
disentuh.

## Cakupan dan Ketertelusuran

| Scope | ID terkait | Status | Bukti |
|---|---|---|---|
| Schema master/auth | F-04, TM-01, TM-04 | PASS | Migration membentuk EventConfig, Category, Group, Team, GroupMembership, User, dan Session dengan FK/unique/revision |
| Fondasi integritas operasi | F-04, TM-05, TM-07, R-11, R-15, H-05 | PASS (schema) | OperationLedger, CommandReceipt, AuditEntry append-only, dan OutboxEvent terbentuk; perilaku UoW/OP tetap scope F-05 |
| Migrasi fresh DB | F-04 | PASS | `prisma migrate deploy` menerapkan satu migration ke file baru di `/tmp` |
| Constraint SQLite nyata | F-04, TM-01, AC-01 | PASS (fondasi) | Test driver nyata menolak FK orphan, kode tim duplikat, dan membership lintas kategori; audit update/delete ditolak. CRUD/import/authorization tetap di luar F-04 |
| Durability/lifecycle | F-04, R-11, Q-08 | PASS (fondasi) | Test memeriksa FK ON, WAL, synchronous FULL, busy timeout, disconnect/reconnect, dan data commit bertahan; recovery gate R-11 tetap NOT RUN |
| Backup/restore copy | F-04, R-13, AC-16 | PASS (fondasi copy terisolasi) | Writer dihentikan; candidate dibuat di direktori sementara dalam root yang disetujui, diverifikasi sebelum atomic rename, dan kegagalan mempertahankan cadangan lama. Restore salinan memeriksa versi serta jumlah team/audit |
| Auth dan fault injection penuh | AC-18/24/32/33/36, TC-24/32/33/36 | NOT RUN/BLOCKED untuk skenario lintas modul | Auth boundary, ledger UoW, fault campaign, timer, storage gate, event session, manifest/media kedua, dan pengukuran RPO/RTO bergantung pada F-05/F-06/002/003 serta keputusan D-14/D-15 |

## Perintah dan Hasil

- `pnpm install` — PASS; lockfile/workspace links konsisten, 331 entry lolos
  supply-chain policy, tanpa paket baru diunduh.
- `pnpm --filter server typecheck` — PASS.
- `pnpm --filter server test` — PASS, 17/17. Sembilan test SQLite nyata
  mencakup fresh schema, pragma durability, FK/unique, penolakan membership
  lintas kategori, audit append-only, restart persistence, backup/restore,
  preservasi cadangan lama saat verifikasi gagal, dan pembatasan backup root.
- `pnpm --filter server build` — PASS.
- `pnpm --filter web lint` — PASS.
- `pnpm --filter web build` — PASS.
- `DATABASE_URL=file:<temporary>/fresh.db pnpm --filter server prisma:migrate:deploy`
  — PASS; migration `20261018190000_initial_foundation` diterapkan ke DB baru.
- Pemeriksaan tambahan dengan executable `sqlite3` — NOT RUN karena binary
  tidak tersedia. Pemeriksaan `PRAGMA integrity_check` yang setara dijalankan
  dan PASS melalui better-sqlite3 dalam test suite.
- `git diff --check` — PASS.

## Remediasi QA Independen

Verdict awal [ZAK-24](/ZAK/issues/ZAK-24) menemukan dua defect HIGH pada commit
`a4a2866`: kategori membership tidak terikat ke kategori group/team dan failure
backup menghapus destination existing. Remediasi menambahkan FK komposit
`(groupId, categoryId)` serta `(teamId, categoryId)`. Backup sekarang membuat
candidate unik hanya di dalam root backup yang disetujui, memeriksa integrity
dan version pairing, melakukan fsync, lalu mempromosikannya dengan atomic
rename. Failure hanya membersihkan direktori temporary milik invocation dan
tes regresi membuktikan cadangan lama tetap byte-identik.

Klaim acceptance juga dipersempit: AC-18 dan TC-24 bukan bukti constraint
master; AC/TC-24/32/33/36 tetap NOT RUN atau BLOCKED sampai fault campaign dan
modul dependennya tersedia. Bukti ini tidak mengklaim EventSession, manifest
persisten, media kedua, RPO/RTO, auth boundary, atau readiness hari-H.

## Batas dan Prosedur Aman

Migration ini belum dan tidak boleh diterapkan ke database acara. Sebelum
migrasi non-fresh: maintenance tanpa match aktif, semua penulis berhenti,
backup konsisten diverifikasi dan restore digladi pada salinan, SQL ditinjau,
serta pasangan versi aplikasi/schema dicatat. Restore backup dengan record
RUNNING nantinya wajib masuk rekonsiliasi; jangan reset/drop database untuk
memulihkan startup.

Target RPO/RTO, media kedua, dan retensi masih **[NEEDS CONFIRMATION]** D-14/D-15.
Dokumen ini tidak mengklaim readiness rilis atau menutup QA independen.
