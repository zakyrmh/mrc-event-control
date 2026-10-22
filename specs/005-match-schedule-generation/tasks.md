# 005 — Tugas Implementasi Generate Jadwal Babak Grup

## Tujuan, Cakupan, dan Cara Membaca

Daftar pekerjaan pada [spec](spec.md) dan [plan](plan.md). Checkbox dicentang hanya setelah bukti tersedia, bukan setelah file dibuat.

## Fase 0 — Persiapan

- [x] **S-00** — Cadangkan database acara secara konsisten (`sqlite3 .backup`, bukan salin berkas mentah karena ada WAL aktif), verifikasi `pragma integrity_check`, dan catat jumlah tim/match sebelum migrasi. Selesai: berkas cadangan terverifikasi dan dapat dibaca.

## Fase 1 — Skema

- [x] **S-01** — Tambah `stage`, `tieId`, `rondeNumber`, `generationBatchId`, `bracketSlot` pada `Match`; buat `TieConfig` dan `MatchGenerationBatch`; tambah unique `(categoryId, sequence)` dan unique parsial `(tieId, rondeNumber)`. Selesai: `prisma generate` bersih, migrasi berjalan pada database baru dan pada salinan database acara tanpa kehilangan data.

## Fase 2 — Domain

- [x] **S-02** — Implementasikan `generateRoundRobin` sebagai fungsi murni beserta pembentukan `tieId`. Selesai: unit test n = 2, 3, 4, 5, 7 membuktikan cakupan pasangan lengkap tanpa duplikat, jumlah pasangan C(n,2), dan determinisme.

## Fase 3 — Kontrak

- [x] **S-03** — Tambah skema Zod di `packages/shared`: input preview/generate, reorder, rollback, `TieConfig`, dan enum `matchStage`. Selesai: tipe dipakai bersama server dan web, validasi menolak `rondeCount` kosong/nol dan daftar reorder yang tidak lengkap.

## Fase 4 — Server

- [x] **S-04** — Implementasikan `GET /match-schedules/group-preview` dan `POST /match-schedules/generate` (atomik, idempoten, lapor `created`/`skipped`). Selesai: test integrasi membuktikan generate pertama membuat seluruh match, generate kedua menghasilkan `created = 0` dengan seluruh baris `skipped`, dan kegagalan validasi tidak menulis apa pun.

- [x] **S-05** — Implementasikan `POST /match-schedules/reorder` dengan renumber dua tahap dan `POST /match-schedules/{batchId}/rollback` dengan guard ketat. Selesai: test membuktikan urutan tersimpan benar, daftar tidak lengkap ditolak 422, rollback menghapus seluruh batch, dan rollback ditolak bila satu match sudah dimainkan.

- [x] **S-06** — Implementasikan `GET`/`PUT /tie-configs` dan penegakan role super-admin pada seluruh endpoint baru. Selesai: operator menerima 403 pada semua mutasi; konfigurasi tersimpan per kategori+tahap dengan revision guard.

## Fase 5 — Antarmuka

- [x] **S-07** — Bangun panel jadwal: form konfigurasi, pratinjau collapsible per grup, tabel tersimpan dengan naik/turun dan "pindahkan ke #", serta rollback per batch. Selesai: alur generate dapat diselesaikan dari UI, keadaan kosong/loading/error ditangani, dan form manual lama tetap tersedia.

## Fase 6 — Dokumentasi dan Validasi

- [x] **S-08** — Perbarui `API_CONTRACT.md`, `DATA_MODEL.md`, `UI_UX_GUIDELINES.md`, `CONTEXT.md` (glosarium Tahap/Putaran/Ronde/Tie), dan `RULEBOOK_NOTES.md` (amendemen D-08 serta catatan format knockout sebagai keputusan Fase 2). Selesai: istilah konsisten dan tidak ada tautan rusak.

- [x] **S-09** — Jalankan `pnpm --filter server typecheck`, `pnpm --filter server test`, `pnpm --filter web lint`, `pnpm --filter web build`. Selesai: seluruh perintah lulus dan hasilnya dicatat.

## Gate

Fase 2 (arena, knockout, bracket, tabel poin) tidak dimulai sebelum Fase 1 selesai dan tervalidasi pada data acara nyata.

## Catatan Bukti

- **S-00** — Cadangan `apps/server/data/backups/development.db.20261023T000429.bak`, `pragma integrity_check = ok`, 39 tim / 13 grup / 0 match. Salinan berkas mentah **tidak sah** karena WAL belum di-checkpoint; gunakan `sqlite3 .backup`.
- **S-01** — Migrasi `20261023000000_add_match_schedule_generation` diterapkan pada salinan DB acara dan pada DB acara asli; data 39 tim dan 13 grup utuh, `integrity_check = ok`.
- **S-02** — 23 unit test lulus (n = 2, 3, 4, 5, 7; cakupan pasangan; determinisme; alternasi sisi; `tieId` per pasangan).
- **S-03** — `pnpm --filter shared typecheck` dan 29 test shared lulus.
- **S-04** — 17 test integrasi lulus, termasuk pratinjau 117, generate 117, klik kedua `created = 0` + `skipped = 117`, dan penolakan tanpa tulis parsial.
- **S-05** — Reorder 117 id tersimpan dan bernomor 1..117; daftar tidak lengkap 422; rollback menghapus 117 dan menandai batch; rollback kedua 409; rollback dengan match sudah dimulai 409 tanpa menghapus apa pun.
- **S-06** — Operator menerima 403 pada generate, reorder, dan tie-config; konfigurasi ronde tersimpan dengan revision guard.
- **S-07** — `pnpm --filter web lint` bersih dan `pnpm --filter web build` berhasil.
- **S-08** — `CONTEXT.md` (Tahap/Putaran/Tie/Ronde/Babak), `RULEBOOK_NOTES.md` (amendemen D-08), `API_CONTRACT.md`, dan `DATA_MODEL.md` diperbarui.
- **S-09** — Server 145 test lulus, typecheck server dan shared lulus, lint web bersih, build web berhasil.

### Temuan selama implementasi

1. `tieId` awalnya dihitung per grup sehingga tiga tie dalam satu grup berbagi id yang sama. Unit test menangkapnya; identitas diubah menjadi per pasangan.
2. Renumber reorder tidak boleh memakai nilai negatif karena `CHECK (sequence > 0)`. Diganti parkir di atas nilai maksimum, lalu tulis nilai final.
3. Sepuluh berkas test menduplikasi daftar migrasi sehingga setiap migrasi baru memecahkannya. Diganti helper `test/helpers/migrations.ts` yang membaca direktori migrasi.
4. `PATCH /matches/{id}` dan `POST /matches` dapat melanggar unique `(categoryId, sequence)`; kini dipetakan ke 409 `VERSION_CONFLICT`, bukan 500.
5. `pnpm exec prisma migrate deploy` gagal dengan "SQLite database error" saat dev server memegang berkas; berhasil setelah WAL di-checkpoint. Ini perlu dicatat di runbook.

### Keterbatasan yang dilaporkan

- Babak gugur, bracket, tabel poin, dan penetapan peserta lolos **belum** diimplementasikan (Fase 2).
- `sequence` masih per kategori. Saat arena masuk, maknanya harus menyempit menjadi per arena melalui migrasi terpisah.
- Format knockout 14 pertandingan yang disepakati panitia belum dapat dieksekusi sistem; masih manual.
- Belum ada UI untuk mengubah `TieConfig` secara terpisah; nilai tersimpan saat generate dengan `saveTieConfig`.
