# ADR-0002 — Baseline Teknologi dan Paket yang Belum Tersedia

## Tujuan, Cakupan, dan Status

Mencatat fakta repository dan rencana stack untuk semua modul. **Fakta diperiksa 18 Oktober 2026:** manifest root/web/server, lockfile, konfigurasi TS/Oxlint, source starter dan tautan node_modules. **[PROPOSED]** pilihan integrasi berikut adalah target engineering sesuai arahan pengguna, bukan klaim seluruh stack telah diterapkan atau disetujui sebagai paket rilis.

## Konteks dan Inventaris

| Area | Bukti aktual | Rencana / gap |
|---|---|---|
| Web | React/React DOM `^19.2.8`, Vite `^8.3.0`, TypeScript `~6.0.2`, Oxlint `^1.81.0` di `apps/web/package.json` | Masih template; belum ada routing/state domain/overlay |
| Server | Fastify `^5.12.5`, Socket.IO `^4.8.4`, Zod `^4.6.5`, tsx, dan TypeScript `~6.0.2` | Guard Node 24, tsconfig strict/noUncheckedIndexedAccess, typecheck, dan unit test tersedia; bootstrap aplikasi serta script dev/build/start belum ada |
| Persistensi | Prisma/client/adapter better-sqlite3 `^7.10.0`, dotenv `^18.0.7` di root | SQLite target; schema/client generation/migrasi belum ada |
| Tooling | Node `>=24 <25`; pnpm 12.11.2; TypeScript `~6.0.2` lintas root/web/server; Oxlint react/typescript/oxc | Web/server strict aktif dan server test nyata tersedia; root test tetap placeholder gagal |
| UI rencana | Tidak ada dependensi langsung Tailwind v4, shadcn/ui, Zustand, React Router | Tambah hanya melalui tugas implementasi terpisah |
| Pengujian rencana | Vitest dan Playwright belum menjadi dependensi langsung | Runner/script/fixture/failure injection perlu dibuat |
| Transport/static rencana | Socket.IO server terdaftar, belum ada client aplikasi dan plugin static Fastify | Tentukan paket/version kompatibel saat implementasi |

Versi tabel adalah rentang manifest, bukan jaminan versi runtime pada semua host. Paket transitive pada node_modules bukan bukti integrasi aplikasi. F-01 menyelaraskan TypeScript, mematok Node mayor 24, mengunci workspace dengan pnpm 12.11.2, dan mengizinkan lifecycle build hanya untuk `@prisma/engines`, `better-sqlite3`, serta `esbuild`. Frozen install dan native SQLite smoke lulus pada host Linux yang dicatat di [validasi F-01](../03-quality/F01_RUNTIME_VALIDATION.md); laptop acara, cache dingin yang dipindahkan, dan fallback kompilasi tetap harus diuji sebelum rilis.

## Keputusan dan Alasan

Target: React/Vite/TypeScript strict untuk UI; Fastify/Node untuk server; Socket.IO untuk update; SQLite/Prisma untuk data; Zod untuk validasi kontrak di `packages/shared`; Tailwind CSS v4 dan shadcn/ui untuk komponen konsisten; Zustand hanya bila state presentasi lintas komponen memerlukannya; React Router untuk halaman; Vitest/Playwright untuk bukti. pnpm dan Oxlint mengikuti baseline yang ada.

State penting selalu berasal dari server, bukan store browser. Rute dan state presentasi tidak boleh menjadi salinan otoritas bisnis. Penggunaan Prisma dipadukan transaksi/constraint, bukan sekadar CRUD otomatis.

## Konsekuensi dan Alternatif

Tim harus memvalidasi versi Node yang didukung seluruh paket dari metadata lokal/dokumentasi primer saat implementasi, native SQLite pada OS acara, build offline dan konfigurasi strict. Jangan mematok runtime Node hanya dari versi `@types/node`. Paket hash/sesi/static/Socket.IO client serta backup API belum dipilih seluruhnya.

SQL langsung dapat mengurangi lapisan ORM tetapi menambah disiplin query/migrasi; Prisma mengikuti dependensi tersedia. Polling mengurangi transport ekstra tetapi pembaruan siaran perlu diuji terhadap target latensi; Socket.IO sudah terdaftar dan diprioritaskan. UI komponen buatan sendiri memberi kebebasan tetapi menambah pekerjaan aksesibilitas; pilihan shadcn tetap membutuhkan uji keyboard dan tidak memberi sertifikasi otomatis.

## Validasi dan Keputusan Terbuka

Buktikan build strict/lint, schema transaksi, API dan produksi melalui [test plan](../03-quality/TEST_PLAN.md). [NEEDS CONFIRMATION] D-14/15: hardware/packaging/kebijakan akun dan batas kapasitas. Referensi: [README](../../README.md), [arsitektur](../02-engineering/ARCHITECTURE.md), [001 plan](../../specs/001-team-management/plan.md). Tidak ada instalasi atau migrasi yang diotorisasi oleh ADR ini sendiri.

## Konsekuensi Remediasi Kontrak

**[PROPOSED]** Stack tetap sama; tidak ada dependensi baru yang dianggap telah terpasang. Implementasi harus membuktikan transaksi ledger/tombstone/reassign/import historis pada SQLite adapter nyata, penyimpanan metadata browser yang durable, anonymous CSRF bootstrap dan pencabutan socket, serta heartbeat revision independen outbox. F-05/F-06 menyediakan fondasi sebelum lifecycle; impor T-02/T-04 hanya gate rilis, bukan prasyarat L-01. Semua perubahan dependency/migrasi tetap tugas implementasi terpisah. Lihat [API](../02-engineering/API_CONTRACT.md), [001 plan](../../specs/001-team-management/plan.md) dan [remediasi](../03-quality/AUDIT_REMEDIATION.md).
