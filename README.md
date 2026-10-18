# MRC X 2026 Event Control

## Tujuan dan Cakupan

Sistem kendali pertandingan dan tampilan OBS untuk Minangkabau Robot Contest X, UKM Robotik Politeknik Negeri Padang, 31 Oktober–1 November 2026. Target penggunaan: satu komputer lokal tanpa internet, dengan super-admin, operator, panitia arena, dan juri. Juri menentukan hasil; operator menjalankan aplikasi.

Kategori: Line Follower Digital Junior, Line Follower Digital Umum, Robot Sumo, dan Robot Soccer. Semua tayangan mempertemukan Tim A dan Tim B. Status pertandingan, fase operasional, timer, dan mode tayangan adalah konsep terpisah; lihat [istilah](CONTEXT.md).

## Status Implementasi — 16 Oktober 2026

Frontend masih template React/Vite dengan penghitung contoh. Backend hanya mempunyai manifest dependensi; belum ada server, autentikasi, API, timer, integrasi OBS, skema Prisma, migrasi, atau pengujian aplikasi. Dokumentasi menggambarkan kebutuhan dan rancangan, bukan fitur yang sudah tersedia. Folder `prisma/`, `tests/`, dan `packages/shared/` belum berisi implementasi.

## Teknologi yang Ditemukan

| Bagian | Tercantum dalam manifest / tersedia di node_modules | Status integrasi |
|---|---|---|
| Web | React 19, Vite 8, TypeScript 6, Oxlint | Template aktif; `strict` belum diaktifkan eksplisit |
| Server | Fastify 5, Socket.IO 4, Zod 4, tsx, TypeScript 7 | Belum ada source/runtime |
| Root | Prisma 7, adapter better-sqlite3, dotenv | Belum ada database atau konfigurasi Prisma |
| Rencana | Tailwind CSS v4, shadcn/ui, Zustand bila perlu, React Router, Vitest, Playwright, socket.io-client, plugin static Fastify | [PROPOSED] Belum menjadi dependensi langsung aplikasi |

Target SQLite dan TypeScript strict mengikuti arahan proyek; kompatibilitas runtime Node, native SQLite, dan perbedaan versi TypeScript perlu divalidasi sebelum implementasi. Detail ada di [ADR stack](docs/04-decisions/0002-tech-stack.md).

## Struktur dan Peta Baca

- `apps/web/src/`, `src/assets/`, `public/`: frontend, aset impor, aset statis.
- `apps/server/`: paket backend; `packages/shared/`: lokasi kontrak bersama yang direncanakan.
- [PRD](docs/01-product/PRD.md) → [SDD turunan](docs/01-product/SDD.md) → [arsitektur](docs/02-engineering/ARCHITECTURE.md).
- [SOP](docs/01-product/SOP.md) dan [runbook](docs/03-quality/RUNBOOK.md): panduan panitia.
- [Keputusan terbuka](docs/01-product/RULEBOOK_NOTES.md), [tes](docs/03-quality/TEST_PLAN.md), [penerimaan](docs/03-quality/ACCEPTANCE_CRITERIA.md).
- [001 tim](specs/001-team-management/spec.md), [002 lifecycle](specs/002-match-lifecycle/spec.md), [003 timer](specs/003-timer-engine/spec.md), [004 OBS](specs/004-obs-overlay/spec.md).
- [AGENTS](AGENTS.md): aturan kontribusi; [SDD asli](docs/SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md) dipertahankan utuh.

## Perintah yang Sudah Didefinisikan

Jalankan dari root dengan `pnpm@12.11.2` yang dipatok di `package.json`.

```bash
pnpm install
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web preview
```

`install` memasang dependensi; perlu internet/cache saat persiapan, bukan hari acara. `dev` menjalankan Vite; `build` memeriksa TypeScript lalu membangun frontend; `lint` menjalankan Oxlint; `preview` memeriksa hasil build secara lokal. Perintah ini bersumber dari manifest, belum divalidasi lewat eksekusi dalam pekerjaan dokumentasi ini.

`pnpm-workspace.yaml` masih memuat nilai placeholder `allowBuilds`; tim harus meninjau izin build native secara eksplisit sebelum instalasi. Root/server `test` sengaja gagal karena placeholder. Belum ada script backend dev/build/start, test runner, ataupun startup produksi. Jangan memakai Vite dev/preview sebagai server produksi. Rencana satu server lokal ada di [arsitektur](docs/02-engineering/ARCHITECTURE.md).

## Kontribusi dan Keputusan Terbuka

Gunakan prefix commit seperti riwayat awal `chore: initialize MRC X event control monorepo`; contoh `feat: add match timer`. PR menyertakan kebutuhan terkait, langkah verifikasi, risiko pemulihan, dan screenshot bila UI berubah. Seluruh fitur operasional masih memerlukan implementasi dan gladi bersih. [NEEDS CONFIRMATION] Rulebook asli, durasi, jumlah arena, dan otoritas lapangan ada dalam register D-01–D-15. Hasil pemeriksaan dokumentasi: [audit](docs/03-quality/DOCUMENTATION_AUDIT.md).

## Status Remediasi Audit

[Remediasi 14 temuan](docs/03-quality/AUDIT_REMEDIATION.md) memperjelas intent gol/rearm, koreksi atomik, ledger pending, start satu tindakan setelah review, pemulihan postponed/storage, revision freshness OBS, CSRF bootstrap dan input historis. Seluruhnya kontrak [PROPOSED] yang belum diimplementasikan. AC-28–37 menyediakan oracle verifikasi; belum ada tes aplikasi yang dijalankan. [NEEDS CONFIRMATION] Pemberi izin lapangan serta penerimaan target recovery tetap memerlukan panitia. Urutan implementasi ada di [001 plan](specs/001-team-management/plan.md); impor wajib sebelum rilis, tidak menghambat fondasi lifecycle.
