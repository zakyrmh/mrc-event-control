# Validasi Runtime F-01

Tanggal pengujian: 18 Oktober 2026 UTC. Dokumen ini mencatat bukti implementasi [001 F-01](../../specs/001-team-management/tasks.md), bukan persetujuan QA atau kesiapan rilis.

## Keputusan fondasi

- Node dipatok pada mayor 24 (`>=24 <25`), sesuai host uji 24.22.0 dan rentang Prisma 7.10.0 serta `better-sqlite3` 12.11.1. Major tunggal mengurangi variasi ABI native pada persiapan offline.
- TypeScript diselaraskan ke `~6.0.2` pada root, web, dan server. Web serta server mengaktifkan `strict` eksplisit; server menambah `noUncheckedIndexedAccess`.
- Runner minimum menggunakan `node:test` melalui loader `tsx` yang sudah ada. Ini menghindari dependensi test baru sebelum fondasi server tersedia.
- `allowBuilds` mengizinkan `@prisma/engines`, `better-sqlite3`, dan `esbuild`. `prisma` ditolak karena manifest terkunci hanya memiliki `preinstall`, bukan install/postinstall; CLI tetap dapat digunakan tanpa mengizinkan lifecycle script paket tersebut.

## Bukti lokal

Host: Linux x86_64, kernel 7.2.10, Node 24.22.0, ABI module 137, N-API 10, pnpm 12.11.2.

| Perintah | Hasil |
|---|---|
| `pnpm install --fix-lockfile` | PASS; supply-chain policy 354 entri lulus; build `esbuild`, `@prisma/engines`, dan `better-sqlite3` selesai |
| `pnpm install --offline --frozen-lockfile` | PASS; lockfile up-to-date tanpa resolusi jaringan |
| `pnpm --filter server typecheck` | PASS; TypeScript strict/no-emit |
| `pnpm --filter server test` | PASS; 3 test runtime guard, 0 gagal |
| `pnpm --filter web build` | PASS; TypeScript project build dan Vite 8.3.4 |
| `pnpm --filter web lint` | PASS; Oxlint 1.87.0 |
| smoke `better-sqlite3` dari virtual store | PASS; binding native membuka database `:memory:` dan menjalankan `select sqlite_version()` |
| `pnpm test` | FAIL yang diketahui; root masih placeholder `Error: no test specified` |

Lockfile terdiri dari dua dokumen YAML yang dikelola pnpm 12: dokumen pertama mengunci binary pnpm dari `devEngines.packageManager`, dokumen kedua mengunci workspace. Frozen install menerima struktur ini; itu bukan duplikasi yang dihapus manual.

## Batas dan risiko

- Hasil native hanya membuktikan host Linux ini. Laptop acara, Windows bila dipilih, fallback kompilasi tanpa prebuild, dan cache offline yang benar-benar dipindahkan masih **NOT RUN**.
- `skipLibCheck` tetap aktif di web untuk kompatibilitas dependency; source aplikasi sendiri diperiksa strict.
- `packages/shared` belum ada sampai F-02, sehingga boundary DTO lintas paket belum dapat diuji. Versi compiler telah diselaraskan sebagai prasyarat.
- Root test tetap placeholder dan dilaporkan gagal; server test bukan bukti integrasi API, migrasi, SQLite durability, atau E2E.
- D-14/D-15 tetap **[NEEDS CONFIRMATION]**. Baseline ini tidak menyetujui hardware, target recovery, media backup, format impor, akun, atau retensi.
- Tidak ada database acara, schema, atau migrasi yang dibuat maupun diubah.

Checkbox F-01 tetap belum dicentang sampai review independen SENTINEL menerima bukti ini. F-02–F-05 tidak boleh dimulai melalui perubahan ini.
