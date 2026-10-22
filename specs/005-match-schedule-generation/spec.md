# 005 — Spesifikasi Generate Jadwal Babak Grup

## Tujuan, Cakupan, dan Status

Super-admin dapat membuat seluruh jadwal babak grup satu kategori dalam satu tindakan, bukan mengetik puluhan match satu per satu. Cakupan: generate round robin per grup, penyuntingan urutan main, pembatalan batch, dan konfigurasi jumlah ronde per tie. **[PROPOSED]** desain rinci; bukan aturan kompetisi resmi.

Fitur ini adalah **alat bantu penjadwalan**. Panitia tetap pemilik keputusan format. Sistem tidak menghitung kelolosan, tidak menentukan juara, dan tidak menetapkan peserta babak berikutnya (AGENTS.md; ARCHITECTURE.md BC `tournament`).

## Definisi

Istilah kanonik (lihat [CONTEXT](../../CONTEXT.md)):

| Istilah | Arti |
|---|---|
| **Tahap** | Fase turnamen: `GROUP` (babak grup), `KNOCKOUT` (babak gugur), `FINAL` |
| **Putaran** | Satu gelombang match lintas grup yang dimainkan bergantian |
| **Ronde** | Satu game dalam satu tie; disebut juga *leg* |
| **Tie** | Pertemuan dua tim yang terdiri dari N ronde |
| **Babak** | Segmen di dalam satu match Soccer (arti lama dipertahankan) |

Kata "penyisihan" **tidak dipakai** karena SDD memakainya untuk arti lain (satu run penilaian LF).

## Kebutuhan Fungsional dan Aturan

- **SG-01 (R-02/TM-03):** Generate jadwal babak grup untuk satu kategori memakai round robin satu putaran. Jumlah tie per grup = C(n,2) untuk n tim; tidak di-hardcode.
- **SG-02:** Setiap tie dipecah menjadi N ronde sesuai `TieConfig`. N wajib diisi super-admin; tidak ada nilai default di kode.
- **SG-03:** Sisi A/B berganti setiap ronde (ronde 1: A vs B, ronde 2: B vs A, ...). Setiap ronde adalah `Match` terpisah sehingga pencatatan gol per sisi tetap benar.
- **SG-04:** Generate bersifat idempoten. Pasangan tie yang sudah ada dilewati, bukan diduplikasi, dan dilaporkan sebagai `skipped`.
- **SG-05:** Generate bersifat atomik. Bila satu grup gagal divalidasi, tidak ada match yang tersimpan.
- **SG-06:** `sequence` unik per kategori dan menjadi urutan main. Match hasil generate menempati blok berurutan per grup.
- **SG-07:** Super-admin dapat menyusun ulang urutan main (naik/turun dan lompat ke nomor tertentu) dan menyimpannya sebagai satu transaksi.
- **SG-08:** Super-admin dapat membatalkan satu batch generate. Rollback hanya berhasil bila seluruh match batch belum pernah dimainkan dan tidak punya segmen, gol, atau revisi hasil.
- **SG-09:** Jadwal manual yang sudah ada tetap didukung dan tidak boleh tertimpa generate.

## Kasus Tepi dan Penerimaan

- Kategori tanpa tim atau dengan satu tim pada grup terpilih ditolak 422 tanpa menulis apa pun.
- `rondeCount` kosong, nol, atau negatif ditolak 422.
- Klik generate dua kali: panggilan kedua menghasilkan `created = 0` dan seluruh baris masuk `skipped` dengan alasan `ALREADY_EXISTS`.
- Tim baru ditambahkan ke grup setelah generate: generate ulang hanya membuat tie/ronde yang belum ada.
- `expectedCatalogRevision` basi (katalog berubah sejak pratinjau) ditolak 409 `VERSION_CONFLICT`.
- Rollback ditolak 409 `INVALID_TRANSITION` bila satu match batch sudah `hasStarted` atau berstatus selain `SCHEDULED`.
- Operator memanggil endpoint mutasi langsung: 403.
- Reorder dengan daftar yang tidak memuat seluruh match kategori tepat sekali: 422 tanpa perubahan.

Bukti wajib: unit test algoritma untuk n = 2, 3, 4, 5, 7; test integrasi untuk generate, idempotensi, skip, rollback, reorder, dan penolakan role.

## Keputusan Terbuka dan Referensi

- **D-08 (amendemen):** sebelumnya "jadwal manual; label babak, jumlah tidak dihardcode". Amendemen: jadwal babak grup **boleh digenerate** sistem; klausul "jumlah tidak dihardcode" **tetap berlaku** dan dipenuhi melalui C(n,2) generik serta `TieConfig`. Dicatat di [register keputusan](../../docs/01-product/RULEBOOK_NOTES.md).
- **Jumlah ronde per tie** belum final dari panitia. Karena itu wajib input dan dapat diubah.
- **Format babak gugur** (round robin pool 3, play-off K1/L1/M1, final 3 tim) dicatat sebagai keputusan panitia tetapi **diekskusi di Fase 2**.
- **Arena** belum diimplementasikan (ADR-0004 masih rancangan). `sequence` untuk sini bersifat per kategori; saat arena masuk, artinya menyempit menjadi per arena melalui migrasi terpisah.
- [API](../../docs/02-engineering/API_CONTRACT.md), [model data](../../docs/02-engineering/DATA_MODEL.md), [plan](plan.md), [tasks](tasks.md).

## Di Luar Cakupan

Master `Arena`, registry timer multi-arena, room Socket.IO per arena, bracket knockout, tabel poin/klasemen, dan penetapan peserta lolos.
