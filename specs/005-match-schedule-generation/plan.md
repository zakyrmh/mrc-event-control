# 005 — Rencana Teknis Generate Jadwal Babak Grup

## Tujuan, Cakupan, dan Status

**[PROPOSED]** Rencana SG-01–SG-09 pada [spec](spec.md). Mencakup satu migrasi, algoritma round robin murni, lima endpoint, dan satu panel UI. Fase 2 (arena + knockout + bracket) hanya dicatat, tidak dikerjakan.

## Dependensi

```text
Fase 0  backup DB terverifikasi
   ↓
Fase 1  skema + migrasi ──→ algoritma round robin ──→ DTO shared
                                                     ↓
                                              schedule-routes + tes
                                                     ↓
                                                  panel UI
                                                     ↓
                                        dokumentasi + validasi penuh
```

Bergantung pada 001 T-01 (kategori/grup/tim) dan T-03 (jadwal manual) yang sudah selesai. Tidak bergantung pada 002/003/004.

## Desain dan Data

### Migrasi `20261023000000_add_match_schedule_generation`

Tiga kolom baru pada `Match`, tiga tabel/kolom pendukung, dan dua unique index. `Match` masih kosong di database acara sehingga tidak ada backfill.

```text
Match
  + stage             TEXT NOT NULL DEFAULT 'GROUP'   CHECK IN ('GROUP','KNOCKOUT','FINAL')
  + tieId             TEXT NULL
  + rondeNumber       INTEGER NULL   CHECK (rondeNumber IS NULL OR rondeNumber > 0)
  + generationBatchId TEXT NULL
  + bracketSlot       TEXT NULL      (disiapkan Fase 2, tidak dipakai Fase 1)
  + UNIQUE (categoryId, sequence)
  + UNIQUE (tieId, rondeNumber) WHERE tieId IS NOT NULL
  + INDEX (generationBatchId)

TieConfig              id, categoryId, stage, rondeCount>0, revision, approvedBy, sourceNote,
                       UNIQUE (categoryId, stage)

MatchGenerationBatch   id, categoryId, stage, rondeCount, stageLabel, createdCount,
                       actorId, createdAt, rolledBackAt
```

`tieId` deterministik per pasangan: `sha256(categoryId|stage|groupId|sortedPairIds)` dipotong 32 karakter. Per pasangan, bukan per grup, agar grup yang mendapat tim baru tetap mempertahankan tie lamanya. Konsekuensi: klik generate dua kali tidak dapat membuat duplikat karena unique index menolaknya di level database, bukan hanya di kode.

### Algoritma round robin

Fungsi murni `generateRoundRobin(teamIds: string[])` memakai **circle method**:

1. Bila jumlah tim ganjil, tambahkan satu slot `BYE`.
2. Kunci tim pertama, putar sisanya setiap putaran.
3. Hasilkan daftar `{ roundIndex, homeId, awayId }`, buang pasangan yang mengandung `BYE`.

Properti yang diuji: setiap pasangan muncul tepat sekali; jumlah pasangan = C(n,2); jumlah putaran = n-1 untuk n genap dan n untuk n ganjil.

Ekspansi ronde: untuk setiap pasangan ke-`i`, buat `rondeCount` baris. Ronde ganjil memakai `(home, away)`, ronde genap memakai `(away, home)`.

Urutan `sequence` (blok per grup): match manual yang sudah ada menempati nomor lebih dulu; generate mulai dari `max(sequence)+1` kategori itu, lalu mengisi grup demi grup sesuai urutan nama grup, dan di dalam grup menurut putaran lalu ronde.

### Endpoint

| Method | Path | Role | Catatan |
|---|---|---|---|
| GET | `/match-schedules/group-preview` | S | Hitung tanpa menulis |
| POST | `/match-schedules/generate` | S | Commit atomik, idempoten |
| POST | `/match-schedules/reorder` | S | Kirim urutan lengkap |
| POST | `/match-schedules/{batchId}/rollback` | S | All-or-nothing |
| GET/PUT | `/tie-configs` | S | Konfigurasi ronde per kategori+tahap |

Preview dan generate memakai **perhitungan yang sama**; commit menghitung ulang dari database sehingga tidak ada cache yang bisa basi. `expectedCatalogRevision` menjadi pengikat agar perubahan tim di antara preview dan commit terdeteksi.

Reorder menerima `orderedMatchIds` lengkap, bukan pasangan tukar. Alasan: setelah rollback `sequence` dapat berlubang, sehingga "geser blok" ambigu. Server cukup memvalidasi cakupan lalu menomori ulang 1..N. Karena `UNIQUE(categoryId, sequence)` akan bentrok di tengah proses, renumber dilakukan dua tahap di dalam satu transaksi: seluruh baris ke nilai negatif, lalu ke nilai final.

Rollback menghapus baris, bukan menandai batal, dengan syarat ketat: seluruh match batch harus `status = 'SCHEDULED'`, `hasStarted = false`, dan tidak memiliki `SegmentAttempt`, `GoalEvent`, atau `ResultRevision`. Bila satu saja gagal, seluruh rollback ditolak.

### UI

Panel baru `MatchSchedulePanel` di dalam tab "Jadwal Pertandingan": form konfigurasi (kategori, tahap, ronde per tie, label, pilihan grup), pratinjau collapsible per grup dengan penanda `skipped`, tabel jadwal tersimpan dengan tombol naik/turun dan input "pindahkan ke #", serta tombol rollback per batch. Form jadwal manual lama dipindah ke bagian collapsible "Tambah Manual".

## Integrasi dan Risiko

| Risiko | Mitigasi |
|---|---|
| `rondeCount` belum final dari panitia | Wajib input, tanpa default, tersimpan di `TieConfig` agar mudah diubah |
| 117 match membuat tabel panjang | Pratinjau collapsible; reorder mengirim array lengkap, bukan swap |
| Kategori lain belum punya tim | Ditolak 422 dengan pesan per kategori |
| Unique `(categoryId, sequence)` bertabrakan saat renumber | Renumber dua tahap dalam satu transaksi |
| Generate ulang setelah tim masuk grup | Idempoten lewat `tieId` + unique index |
| Format knockout custom belum diuji lapangan | Di luar cakupan; dicatat sebagai keputusan Fase 2 |

Tidak mengubah kontrak lifecycle, timer, atau siaran. Match hasil generate adalah match biasa berstatus `SCHEDULED` sehingga seluruh alur operator yang ada tetap berlaku.

## Validasi dan Penyelesaian

- Unit test algoritma: n = 2, 3, 4, 5, 7; cakupan pasangan; determinisme; alternasi sisi.
- Integrasi: generate, klik dua kali, skip parsial, rollback sukses dan rollback ditolak, reorder, role 403, revision basi 409.
- Migrasi diuji pada database baru dan pada salinan database acara.
- `pnpm --filter server typecheck`, `pnpm --filter server test`, `pnpm --filter web lint`, `pnpm --filter web build`.

Selesai bila SG-01–SG-09 terbukti, dokumentasi tersinkron, dan keterbatasan dilaporkan.
