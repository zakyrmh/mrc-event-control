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
| Constraint SQLite nyata | F-04, AC-01, AC-18, TC-24 | PASS | Test driver nyata menolak FK orphan dan kode tim duplikat; audit update/delete ditolak |
| Durability/lifecycle | F-04, R-11, Q-08, AC-24 | PASS (fondasi) | Test memeriksa FK ON, WAL, synchronous FULL, busy timeout, disconnect/reconnect, dan data commit bertahan |
| Backup/restore copy | F-04, R-13, AC-16, TC-36 | PASS (copy terisolasi) | Writer dihentikan, SQLite backup API digunakan, checksum/integrity/version pairing diverifikasi, lalu jumlah team/audit diperiksa setelah membuka salinan |
| Fault injection penuh | AC-24/32/33/36, TC-24/32/33/36 | NOT RUN untuk skenario lintas modul | Ledger UoW, timer, storage gate, event session, media kedua, dan pengukuran RPO/RTO bergantung pada F-05/002/003 serta keputusan D-14/D-15 |

## Perintah dan Hasil

- `pnpm install` — PASS; lockfile/workspace links konsisten, 331 entry lolos
  supply-chain policy, tanpa paket baru diunduh.
- `pnpm --filter server typecheck` — PASS.
- `pnpm --filter server test` — PASS, 14 test; 0 gagal. Enam test SQLite
  nyata mencakup fresh schema, pragma durability, FK/unique, audit append-only,
  restart persistence, serta backup/restore.
- `pnpm --filter server build` — PASS.
- `pnpm --filter web lint` — PASS.
- `pnpm --filter web build` — PASS.
- `DATABASE_URL=file:<temporary>/fresh.db pnpm --filter server prisma:migrate:deploy`
  — PASS; migration `20261018190000_initial_foundation` diterapkan ke DB baru.
- Pemeriksaan tambahan dengan executable `sqlite3` — NOT RUN karena binary
  tidak tersedia. Pemeriksaan `PRAGMA integrity_check` yang setara dijalankan
  dan PASS melalui better-sqlite3 dalam test suite.
- `git diff --check` — PASS.

## Batas dan Prosedur Aman

Migration ini belum dan tidak boleh diterapkan ke database acara. Sebelum
migrasi non-fresh: maintenance tanpa match aktif, semua penulis berhenti,
backup konsisten diverifikasi dan restore digladi pada salinan, SQL ditinjau,
serta pasangan versi aplikasi/schema dicatat. Restore backup dengan record
RUNNING nantinya wajib masuk rekonsiliasi; jangan reset/drop database untuk
memulihkan startup.

Target RPO/RTO, media kedua, dan retensi masih **[NEEDS CONFIRMATION]** D-14/D-15.
Dokumen ini tidak mengklaim readiness rilis atau menutup QA independen.
