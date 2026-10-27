# MRC X 2026 Event Control

## Tujuan dan Cakupan

Sistem kendali pertandingan dan tampilan OBS untuk Minangkabau Robot Contest X, UKM Robotik Politeknik Negeri Padang, 31 Oktober–1 November 2026. Target penggunaan: satu komputer lokal tanpa internet, dengan super-admin, operator, panitia arena, dan juri. Juri menentukan hasil; operator menjalankan aplikasi.

Kategori: Line Follower Digital Junior, Line Follower Digital Umum, Robot Sumo, dan Robot Soccer. Semua tayangan mempertemukan Tim A dan Tim B. Status pertandingan, fase operasional, timer, dan mode tayangan adalah konsep terpisah; lihat [istilah](CONTEXT.md).

## Status Implementasi — 18 Oktober 2026

Frontend masih template React/Vite dengan penghitung contoh. Backend sudah mempunyai guard runtime, kontrak bersama, bootstrap Fastify, SQLite/Prisma, unit-of-work operasi, dan fondasi autentikasi lokal. API domain pertandingan, timer, dan integrasi OBS belum tersedia. Dokumentasi fitur operasional lain tetap menggambarkan kebutuhan dan rancangan, bukan fitur yang sudah tersedia.

## Teknologi yang Ditemukan

| Bagian | Tercantum dalam manifest / tersedia di node_modules | Status integrasi |
|---|---|---|
| Web | React 19, Vite 8, TypeScript 6, Oxlint | Template aktif; `strict` aktif |
| Server | Fastify 5, Socket.IO 4, Zod 4, tsx, TypeScript 6 | Bootstrap, health/readiness, autentikasi lokal, namespace `/control`, error envelope, build, launcher, dan unit test strict tersedia; belum ada API domain pertandingan |
| Root | Prisma 7, adapter better-sqlite3, dotenv | Prisma 7 terkonfigurasi (`apps/server/prisma.config.ts`), migrasi awal tersedia, dan `apps/server/.env` dibaca lewat `dotenv`; database acara belum dibuat |
| Rencana | Tailwind CSS v4, shadcn/ui, Zustand bila perlu, React Router, Vitest, Playwright, plugin static Fastify | [PROPOSED] Belum menjadi dependensi langsung aplikasi; `socket.io-client` hanya dev dependency server untuk fixture integrasi |

Baseline fondasi memakai Node 24 dan TypeScript 6 lintas paket. Node 24 disediakan otomatis oleh pnpm: `devEngines.runtime` di `package.json` membuat setiap script pnpm memakai Node 24 tanpa mengubah Node global mesin. Karena itu jalankan perintah server/web lewat `pnpm`, bukan `node dist/index.js` langsung; Node global yang berbeda mayor akan ditolak guard runtime. Hasil validasi Linux awal, termasuk native SQLite dan batas portabilitas, dicatat di [validasi F-01](docs/03-quality/F01_RUNTIME_VALIDATION.md). Validasi pada laptop acara tetap wajib.

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
pnpm --filter server dev
pnpm --filter server build
pnpm --filter server start
pnpm --filter server typecheck
pnpm --filter server test
pnpm --filter server bootstrap:admin
pnpm --filter server create:user
```

Orkestrasi dari root:

```bash
pnpm setup        # install + siapkan .env + prisma generate + migrate deploy
pnpm build        # build bundle server dan frontend web produksi
pnpm start        # jalankan server offline produksi (Fastify melayani web + API di port 3000)
pnpm dev          # server dan web sekaligus (mode pengembangan / dev)
pnpm db:migrate   # terapkan migrasi Prisma
pnpm db:admin     # bootstrap super-admin awal
pnpm user:create  # buat/perbarui akun operator atau super-admin (minimal 12 karakter)
pnpm verify       # typecheck + test + build server + lint + build web
```

## Konfigurasi Lokal

Server membaca `apps/server/.env`. `pnpm setup` menyalin `apps/server/.env.example`
menjadi `apps/server/.env` bila belum ada dan tidak pernah menimpa `.env` yang sudah
ada. Kedua file `.env` bersifat lokal dan tidak dilacak git; hanya template yang
dilacak. Variabel yang dikenal:

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ya | Protokol `file:` SQLite. Default template `file:./data/development.db`, relatif terhadap `apps/server`. |
| `ALLOWED_ORIGINS` | untuk frontend | Daftar origin dipisahkan koma. Default server hanya `http://<HOST>:<PORT>`, sehingga pemanggilan dari Vite `:5173` perlu didaftarkan. |
| `COOKIE_SECURE` | tidak | `true` hanya saat dilayani lewat HTTPS. |
| `HOST`, `PORT` | tidak | Default `127.0.0.1` dan `3000`. |
| `MRC_BOOTSTRAP_ADMIN_USERNAME`, `MRC_BOOTSTRAP_ADMIN_PASSWORD` | saat bootstrap | Hanya untuk `pnpm db:admin`; berikan lewat environment, jangan disimpan di `.env`. |

Bootstrap super-admin awal memerlukan `DATABASE_URL`,
`MRC_BOOTSTRAP_ADMIN_USERNAME`, dan `MRC_BOOTSTRAP_ADMIN_PASSWORD` unik minimal
12 karakter. Untuk menambah akun operator atau admin baru kapan saja, gunakan:
`pnpm user:create <username> <password> [OPERATOR|SUPER_ADMIN]`. Password wajib
minimal 12 karakter (scrypt). Bila username sudah ada, perintah akan memperbarui password.
Server memerlukan `DATABASE_URL`. `ALLOWED_ORIGINS` menerima daftar
origin lokal dipisahkan koma. Set `COOKIE_SECURE=true` saat HTTPS digunakan;
pengecualian HTTP hanya untuk baseline loopback dan tidak boleh diekspos ke jaringan umum.

`install` memasang dependensi; perlu internet/cache saat persiapan, bukan hari acara. Pada web, `dev` menjalankan Vite, `build` memeriksa TypeScript lalu membangun frontend, `lint` menjalankan Oxlint, dan `preview` memeriksa hasil build secara lokal. Pada server, `dev` menjalankan launcher dengan watch, `build` menghasilkan `apps/server/dist`, dan `start` menjalankan hasil build. Ketiganya membaca `.env` bila tersedia dan tetap berjalan tanpanya. Laptop acara tetap harus diuji terpisah.

`pnpm-workspace.yaml` mengizinkan build hanya untuk `@prisma/engines`, `better-sqlite3`, dan `esbuild`; lifecycle script `prisma` ditolak karena CLI tidak memerlukannya untuk instalasi. Root `test` masih sengaja gagal sebagai placeholder, sedangkan `server test` menjalankan unit test nyata. Launcher server ini merupakan fondasi pengembangan lokal, belum launcher hari-H atau server statis frontend/OBS. Jangan memakai Vite dev/preview sebagai server produksi. Rencana satu server lokal ada di [arsitektur](docs/02-engineering/ARCHITECTURE.md).

## Panduan Deployment Server Hari-H (Mini PC / Ubuntu Bare-Metal)

Deployment di venue menggunakan satu komputer server lokal (Mini PC OS Ubuntu) tanpa Docker. Seluruh antarmuka web dan API dilayani dari satu port produksi (`PORT=3000`).

### 1. Prasyarat Mini PC (Koneksi Internet Awal)
Pastikan Node.js 24, pnpm, git, dan compiler native terpasang:
```bash
sudo apt update && sudo apt install -y git build-essential
corepack enable
```

### 2. Clone dan Inisialisasi
```bash
git clone <URL_REPO_GITHUB> mrc-x-event-control
cd mrc-x-event-control
pnpm setup
```
> `pnpm setup` otomatis mengunduh paket dependensi, mengompilasi binary SQLite (`better-sqlite3`), menyalin template `.env`, dan menerapkan migrasi database lokal.

### 3. Konfigurasi Jaringan LAN (`apps/server/.env`)
Sesuaikan file konfigurasi server agar dapat diakses oleh laptop operator di jaringan yang sama:
```bash
nano apps/server/.env
```
Atur variabel berikut:
```env
HOST=0.0.0.0
PORT=3000
ALLOWED_ORIGINS=http://192.168.1.100:3000,http://localhost:3000
```
*(Ganti `192.168.1.100` dengan alamat IP statis/LAN Mini PC di venue).*

### 4. Build Bundle Produksi
Sebelum server dijalankan, kompilasi frontend dan backend:
```bash
pnpm build
```

### 5. Buat Akun Operator & Admin
Buat akun untuk masing-masing meja pertandingan (password minimal 12 karakter):
```bash
pnpm user:create superadmin SuperAdminMRC2026! SUPER_ADMIN
pnpm user:create operator.meja1 OperatorMeja12026! OPERATOR
pnpm user:create operator.meja2 OperatorMeja22026! OPERATOR
```

### 6. Menjalankan Server Produksi
```bash
pnpm start
```
Akses dari laptop operator atau OBS di LAN:
```text
http://192.168.1.100:3000/
```

### 7. Opsional: Auto-Start via Systemd
Agar server otomatis berjalan saat Mini PC dinyalakan, buat service di `/etc/systemd/system/mrcx.service`:
```ini
[Unit]
Description=MRC X 2026 Event Control
After=network.target

[Service]
Type=simple
User=YOUR_UBUNTU_USER
WorkingDirectory=/path/to/mrc-x-event-control
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
```
Aktifkan dengan:
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now mrcx
```

### 8. Prosedur Pembaruan Kode (Bila Ada Perubahan di Hari-H/Gladi)
Jika terdapat commit perbaikan dari GitHub:
```bash
git pull
pnpm build
pnpm start
```

## Kontribusi dan Keputusan Terbuka

Gunakan prefix commit seperti riwayat awal `chore: initialize MRC X event control monorepo`; contoh `feat: add match timer`. PR menyertakan kebutuhan terkait, langkah verifikasi, risiko pemulihan, dan screenshot bila UI berubah. Seluruh fitur operasional masih memerlukan implementasi dan gladi bersih. [NEEDS CONFIRMATION] Rulebook asli, durasi, jumlah arena, dan otoritas lapangan ada dalam register D-01–D-15. Hasil pemeriksaan dokumentasi: [audit](docs/03-quality/DOCUMENTATION_AUDIT.md).

## Status Remediasi Audit

[Remediasi 14 temuan](docs/03-quality/AUDIT_REMEDIATION.md) memperjelas intent gol/rearm, koreksi atomik, ledger pending, start satu tindakan setelah review, pemulihan postponed/storage, revision freshness OBS, CSRF bootstrap dan input historis. Seluruhnya kontrak [PROPOSED] yang belum diimplementasikan. AC-28–37 menyediakan oracle verifikasi; belum ada tes aplikasi yang dijalankan. [NEEDS CONFIRMATION] Pemberi izin lapangan serta penerimaan target recovery tetap memerlukan panitia. Urutan implementasi ada di [001 plan](specs/001-team-management/plan.md); impor wajib sebelum rilis, tidak menghambat fondasi lifecycle.
