# ADR-0004 — Topologi Native Multi-Arena Dinamis Terpusat

## Tujuan, Cakupan, dan Status

Merekam keputusan resmi panitia/pengguna mengenai arsitektur multi-arena untuk MRC X 2026.
- **Status:** **ACCEPTED** (Arahan Resmi Panitia, 21 Oktober 2026).
- **Menyelesaikan:** Keputusan terbuka **D-03** (jumlah arena dan kepemilikan kontrol) dan **D-12** (target siaran dan channel OBS) pada [RULEBOOK_NOTES](../01-product/RULEBOOK_NOTES.md).
- **Cakupan:** Model data arena dinamis, isolasi state pertandingan konkuren, registry timer per arena, segmentasi siaran Socket.IO room, dan topologi jaringan lokal offline.

---

## Konteks

Kompetisi MRC X 2026 menyelenggarakan berbagai kategori pertandingan (misalnya Robot Soccer, Sumobot, Line Follower, DRC) di beberapa arena fisik secara serentak. Sebelumnya, sistem mengasumsikan model *single arena* (`ArenaState` tunggal/singleton).

Panitia telah menetapkan format operasional di hari-H:
1. **1 Laptop Server Pusat (Pusat Data & Server Web):** Berada di meja kontrol pusat/IT, menjalankan Fastify server, database SQLite terpusat (WAL mode), dan melayani file aplikasi frontend web via LAN lokal.
2. **N Laptop Meja Arena (Client Operator + OBS):** Setiap arena fisik memiliki 1 laptop di meja lapangan yang terhubung ke server pusat melalui switch/router LAN lokal. Laptop ini menjalankan Dashboard Operator untuk kontrol pertandingan dan OBS Studio untuk overlay siaran kamera arena tersebut.
3. **Kebutuhan Arena Dinamis:** Jumlah dan identitas arena tidak boleh dikodekan secara kaku (*hardcoded*), melainkan dapat dikelola secara dinamis (*CRUD*) oleh Super-Admin sesuai denah venue acara.

---

## Keputusan dan Alasan

### 1. Manajemen Master Arena Dinamis
Super-Admin dapat membuat, mengubah nama/kode, mengaitkan kategori pertandingan, dan mengaktifkan/menonaktifkan arena:
- Entitas baru `Arena`: `id`, `code` (unik, misal `LF-1`, `SOCCER-A`), `name` (misal "Arena Robot Soccer 1"), `categoryId` (opsional/filter kategori yang berhak bertanding di arena ini), `enabled`, dan `revision`.
- Arena yang dinonaktifkan tidak dapat dipilih untuk memulai pertandingan baru, namun riwayat pertandingan lama tetap utuh.

### 2. Multi-Row `ArenaState` dan Isolasi Invarian
- `ArenaState` diubah dari tabel baris tunggal (*singleton*) menjadi relasi 1:1 terhadap `Arena` (`arenaId` foreign key unik).
- **Invarian Otoritatif:** Satu pertandingan (`Match`) hanya dapat aktif di maksimal satu arena dalam satu waktu. Dua operator di arena berbeda tidak dapat memilih atau mengendalikan pertandingan yang sama secara bersamaan (*mutual exclusion* via CAS `matchVersion` & `arenaVersion`).
- Setiap arena memiliki fasa, segmen, attempt, dan `arenaVersion` mandiri. Insiden atau jeda di satu arena tidak mempengaruhi jalannya arena lain.

### 3. Registry Timer Engine per Arena
- `TimerEngine` di server Fastify mengelola multi-instance timer independen menggunakan registry berbasis Map: `Map<arenaId, TimerInstance>`.
- Tick countdown berjalan secara monotonik dan aman; penyesuaian durasi atau pause/resume di satu arena dijamin terisolasi dari arena lainnya.

### 4. Segmentasi Siaran Real-Time via Socket.IO Room
- Namespace siaran `/overlay` membagi saluran siaran publik berdasarkan ruangan (*Room*):
  - Klien OBS bergabung ke room sesuai kode arena: `socket.join(`arena:${arenaCode}`)`.
  - Update skor, fasa, dan countdown hanya dipancarkan ke room arena terkait.
- URL OBS Browser Source bersifat dinamis berbasis query parameter:
  `http://<IP_SERVER>:3000/overlay?arena=<kode_arena>`
- Snapshot publik REST juga menerima filter arena: `GET /api/v1/broadcast/snapshot?arena=<kode_arena>`.
- Telemetri status OBS (ACK) dicatat per arena, sehingga dashboard operator dapat melihat status spesifik OBS di arenanya sendiri.

### 5. Pengalaman Operator (Dashboard UX)
- Di bagian atas Dashboard Operator disediakan pemilih **Arena Tugas**.
- Operator memilih arena yang menjadi tanggung jawabnya; seluruh daftar jadwal yang ditampilkan disaring sesuai kategori arena tersebut.
- Seluruh aksi kontrol (Panggil, Verifikasi, Start, Pause, Goal, Finalisasi) dikirimkan bersama identitas `arenaId` yang valid.

---

## Konsekuensi dan Remedi Teknis

1. **Migrasi Skema SQLite:**
   - Pembuatan tabel `Arena` dan migrasi tabel `ArenaState` untuk menambahkan kolom `arenaId` dan relasi ke `Arena`.
2. **Kompatibilitas Backward:**
   - Klien OBS tanpa query parameter `?arena=` akan diarahkan ke arena aktif pertama atau menampilkan layar tunggu informatif yang meminta pemilihan parameter arena.
3. **Kapasitas LAN & Kinerja Fastify:**
   - Database SQLite dengan mode `WAL` dan `PRAGMA busy_timeout = 5000` telah dibuktikan mampu menangani transaksi konkuren dari N operator arena tanpa kegagalan lock (dibuktikan dalam tes soak).
   - Seluruh koneksi Socket.IO tetap lokal tanpa internet; latensi siaran dipertahankan jauh di bawah target ambang < 100 ms.

---

## Rujukan dan Lihat Juga
- [PRD MRC X 2026](../01-product/PRD.md)
- [Arsitektur Teknis](../02-engineering/ARCHITECTURE.md)
- [Model Data](../02-engineering/DATA_MODEL.md)
- [Register Keputusan Panitia](../01-product/RULEBOOK_NOTES.md) (Penutupan D-03 dan D-12)
- [Runbook Operasional Lapangan](../03-quality/RUNBOOK.md)
