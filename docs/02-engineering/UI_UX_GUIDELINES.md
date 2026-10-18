# Panduan UI/UX Operator dan Tampilan OBS

## Tujuan, Cakupan, dan Status

Mendukung prioritas A pengguna serta R-02–R-10/R-18 dan Q-01–03/06/07/10/12 [PRD](../01-product/PRD.md). Panduan ini **[PROPOSED]** sebagai desain antarmuka, bukan deskripsi template yang sudah berfungsi. Cakupan meliputi perjalanan operator, admin, keadaan gagal, dan overlay. Definisi match/fase/hasil mengikuti [CONTEXT](../../CONTEXT.md).

## Prinsip Kendali Live

Satu layar harus menjawab: match mana, siapa Tim A/B, fase apa, timer bagaimana, dan apakah data tersimpan/siaran terhubung. Teks Indonesia menggunakan kata kerja langsung: “Mulai Pertandingan”, “Jeda”, “Lanjutkan”, “Simpan Hasil Resmi”. Hindari ikon tanpa label atau tombol generik “OK” untuk aksi berdampak besar. Keputusan juri tetap ditulis/dikonfirmasi manusia; UI tidak mendorong pemenang otomatis.

Kontrol yang dipakai saat bertanding tetap pada posisi konsisten. Pilihan kategori/akun/settings tidak menggeser tombol gol. Tombol tidak bertukar tempat antara RUNNING dan PAUSED; label/state berubah di tempat yang sama. Bantuan singkat menjelaskan kenapa tombol dinonaktifkan dan langkah yang diperlukan.

## Tata Letak Dashboard

```text
[Match ID | Kategori | Grup/tahap | Tim A vs Tim B | Status]
[Fase sekarang]     [Segmen aktif]     [Server • DB • OBS]
[                   TIMER BESAR                   ]
[Mulai / Lanjutkan] [Jeda] [Hentikan] [Ubah waktu...]
[Tim A: nama + gol +1]           [Tim B: nama + gol +1]  Soccer
[Koreksi gol...]                [Riwayat tindakan terakhir]
[LANGKAH SOP BERIKUTNYA] [Tindakan Khusus...] [Hasil...]
[Pratinjau OBS + mode + status konfirmasi OBS sebenarnya]
```

Header identitas tetap terlihat saat scroll. Desktop usulan 1366×768 sebagai minimum gladi; panel timer/kontrol utama/gol/fase tetap terlihat tanpa navigasi halaman. Pada 1920×1080 preview dapat di samping; pada lebar kecil panel ditumpuk tanpa tombol tumpang tindih. Pada zoom 200% gunakan scroll vertikal yang jelas, bukan memotong kontrol. Mode sempit tidak otomatis diizinkan sebagai perangkat utama sebelum uji panitia.

Usulan ukuran: teks isi ≥16 px, identitas ≥24 px, timer ≥64 px; target klik utama ≥48×48 px, jarak ≥12 px antara tindakan aman dan destruktif. Kontras teks biasa ≥4,5:1 dan teks besar ≥3:1 sebagai target pengujian aksesibilitas, bukan klaim sertifikasi. Pakai label dan bentuk selain warna. Warna merah untuk bahaya/penolakan; tim dibedakan oleh nama/sisi, tidak hanya merah/biru.

## Perjalanan Memilih Pertandingan

1. Daftar menyediakan pencarian nama/kode tim dan filter kategori/grup/tahap/status. Tim A/B, urutan, dan status terlihat tanpa membuka detail. Jangan memilih baris pertama otomatis setelah filter berubah.
2. Klik baris membuka ringkasan: match ID, kategori, Tim A/B, tahap, arena, durasi yang sudah disepakati, dan status verifikasi. Tombol berbunyi “Pilih Tim A vs Tim B”.
3. Setelah server commit, tampilkan identitas dashboard dan preview secara atomik. Tunggu snapshot baru; jangan memperlihatkan Tim A baru dengan skor match lama.
4. Bila ada match aktif, tolak penggantian dan arahkan “Kembali ke pertandingan aktif” atau “Tunda dengan alasan”. Jangan menyamarkan pemindahan sebagai navigasi biasa.
5. Sebelum mulai, salah pilihan dapat dilepas dengan konfirmasi dan audit. Setelah mulai, operator harus jeda/tunda lewat prosedur berizin, bukan mengganti pasangan di header.

Loading daftar memakai indikator dengan teks, bukan baris palsu yang bisa diklik. Daftar kosong menampilkan filter aktif dan langkah admin menyiapkan jadwal. Match tertunda menampilkan fase/segmen/sisa terakhir dan meminta pemeriksaan sebelum dilanjutkan.

## Timer dan Fase

Timer menampilkan jenis (Pemanggilan/Pemanasan/Pertandingan/Jeda), state, sisa, segmen, dan label “Durasi belum disepakati” bila kosong. “Mulai” dinonaktifkan sampai konfigurasi/kesiapan valid. READY menampilkan “Siapkan segmen pertama”, “Siapkan Mulai”, atau “Mulai Pertandingan” sesuai preparation/arming; pindah fase tidak terjadi akibat timer 00:00.

Saat 00:00 tampilkan “Waktu habis — tunggu keputusan juri”; jangan menampilkan “Selesai” atau pemenang. Bunyi opsional bisa dimatikan dan bukan satu-satunya tanda. Pause memperlihatkan “Dijeda” permanen. Stop menjelaskan “Waktu berhenti pada sisa sekarang”; Reset menjelaskan bahwa waktu kembali ke durasi awal. Dialog “Tetapkan sisa waktu” menampilkan nilai sebelum/sesudah dan alasan; tidak memakai istilah ambigu durasi total.

Lanjut Tahap menampilkan nama fase tujuan dan guard yang belum terpenuhi. Ronde (Sumo), babak (Soccer), start (LF) dilabeli sesuai kategori; kontrol tidak membangun jumlah segmen dari asumsi rulebook. Jeda/segmen berikutnya membutuhkan konfirmasi nomor/durasi, tidak membuat gol baru atau menghapus sejarah.

## Gol Soccer dan Koreksi

Panel sisi A dan B terikat identitas yang stabil. Tombol utama “+1 Gol Tim A — [nama]” dan “+1 Gol Tim B — [nama]” langsung mengirim satu command; tidak perlu dialog pada setiap gol sah. Pending menonaktifkan aksi yang bertentangan dan menampilkan “Menyimpan gol...”. Skor terlihat tetap pada nilai committed sampai respons/snapshot; tidak ada skor sukses semu.

Setelah sukses, tampilkan “Gol Tim A tersimpan, 2–1” dan “Koreksi gol ini”. Koreksi membuka dialog berisi gol/segmen/tim yang dibatalkan dan alasan; commit berupa compensating event. Tidak ada tombol minus yang menurunkan skor tanpa konteks/alasan. Nilai negatif ditolak. “Undo” hanya berlaku pada event yang masih dapat dikoreksi; jika sudah dikoreksi/hasil resmi terkunci, jelaskan prosedur yang benar.

Input gol memakai GoalIntent sekali pakai (SC pada API). Setelah satu gol, kedua tombol +1 tetap terkunci meskipun respons sudah selesai. Untuk gol sah berikutnya operator menekan tombol terpisah “Siapkan gol berikutnya”, lalu +1 tim yang benar. Respons cepat, timeout, refresh, dblclick dan key repeat tidak pernah mengaktifkan gol berikutnya secara otomatis. Tidak ada buffer klik tersembunyi; pending/UNKNOWN wajib diselesaikan sebelum rearm. Hasil sementara diberi label “Gol sementara”; hasil final diberi label dan waktu pengesahan berbeda. Adu penalti bukan tambah gol normal.

## Konfirmasi, Override, dan Hasil

| Aksi | Perlakuan UI |
|---|---|
| Jeda, lanjut, gol +1 yang valid | Respons langsung dengan pending/receipt; audit; tanpa modal berulang |
| Mulai/lanjut pertandingan | Review Tim A/B, segmen, durasi sebelum aba-aba; arm token tanpa start; pada aba-aba satu aksi start/resume, tanpa dialog tambahan |
| Stop sebelum 00:00, reset, ubah waktu | Tampilkan dampak, alasan bila diwajibkan; reset berjalan butuh konfirmasi eksplisit |
| Tunda/kembali fase/ulang segmen | Dialog Tindakan Khusus: alasan, pemberi izin, dampak waktu/gol dan target fase/attempt |
| Finalisasi | Ringkasan hasil juri, nama pemenang bila diputuskan, gol final, sumber keputusan; “Sahkan Hasil dan Selesaikan” |
| Reopen hasil | Hanya super-admin; alasan + dasar juri, hasil resmi lama tetap terbaca, draft revisi berlabel belum disahkan |
| Restore/arsip/penggantian data besar | Admin maintenance; ringkasan sumber/target dan backup valid; bukan dialog di tengah pertandingan |
| Waiting darurat | Tombol mudah dijangkau; segera tampilkan peringatan “Tayangan aman; timer pertandingan tetap [state]” |

Dialog menahan fokus, punya judul/uraian yang dapat dibaca pembaca layar, tombol batal jelas, dan mengembalikan fokus ke pemicu. Enter dari field alasan tidak boleh tanpa sengaja memfinalisasi hasil; konfirmasi ditempatkan setelah ringkasan. Hindari konfirmasi hanya mengandalkan warna atau checkbox yang sudah tercentang. Jika version berubah selama modal terbuka, hentikan submit dan tampilkan perbedaan; minta review ulang.

## Feedback dan Keadaan Sistem

| Keadaan | Yang dilihat/dilakukan operator |
|---|---|
| Loading snapshot awal | “Memuat keadaan dari server”; kontrol mutasi disabled; jangan gunakan state cache sebagai fakta |
| Sukses | Pesan dekat kontrol + riwayat terakhir, mis. “Waktu +10 detik tersimpan”; target feedback lokal ≤1 detik setelah respons |
| Pending/timeout | “Hasil belum diketahui”; metadata operasi tetap ada sesudah refresh. Baca ledger; cancel-or-observe bila perlu; tidak rearm/key baru sebelum terminal dan review snapshot |
| Input tidak valid | Pesan dekat field + langkah perbaikan; input dan alasan tetap tersedia |
| 409 konflik | “Data sudah berubah”; tampilkan state terbaru dan review ulang tanpa replay otomatis |
| Sesi habis/izin ditolak | Bootstrap/login ulang lalu pulihkan ledger milik akun; jangan mengubah role operator untuk menggantikan izin lapangan; timer server tetap berotoritas |
| Terputus | Banner permanen, waktu snapshot terakhir, kontrol mutasi disabled, tanpa antrean offline |
| Storage gagal/penuh | “Penyimpanan terganggu; hasil perintah perlu diperiksa”; gate DEGRADED, tampilkan checkpoint vs observasi belum tersimpan; catat manual. RECOVERY_PENDING tidak auto-resume |
| Recovery restart | Panel khusus sisa checkpoint dan perkiraan downtime, input sisa berdasarkan juri, reconcile lalu resume terpisah |
| Empty jadwal/default | Instruksi ke super-admin menyiapkan data; tidak membuat durasi/tim contoh otomatis |

Gunakan live region untuk sukses/error, tetapi jangan mengumumkan setiap tick timer. Semua tombol bisa dijangkau Tab, fokus terlihat, Escape membatalkan dialog aman. Shortcut [PROPOSED] dapat diaktifkan per sesi setelah latihan; tidak aktif saat mengetik/dialog dan tidak menembus konfirmasi. Shortcut gol tidak memakai tombol satu huruf tanpa modifier; uji risiko sebelum menentukan kombinasi. Bantuan shortcut terlihat, bukan hafalan wajib.

## OBS, Preview, dan Data Basi

Mode AUTO memetakan PRE_MATCH→Tunggu Tanding, CALLING→Pemanggilan, VERIFICATION→Verifikasi, WARMUP→Pemanasan, READY→Siap Tanding, COMPETITION→Pertandingan, INTERMISSION→Jeda, RESULT→Menunggu keputusan, FINISHED→Selesai. Status PAUSED menambah label Dijeda. Mode WAITING/EMERGENCY menampilkan identitas acara/pesan netral tanpa mengubah state. POSTPONED normal melepas arena; mode publik menjadi Waiting, bukan mengambil match lama.

LF menampilkan dua nama + timer; Sumo menambah ronde; Soccer menambah gol + babak. Pemenang hanya dari revisi resmi. Saat CORRECTION_PENDING, hasil resmi lama tetap berlaku; bila ditayangkan, label “Koreksi sedang ditinjau” bersifat netral. Nama panjang harus dapat dibaca (wrap/penyesuaian terbatas), bukan terpotong menjadi nama lain yang ambigu.

Target desain [PROPOSED] canvas 1920×1080, area aman 5% dari tepi, latar transparan untuk kamera, diuji pada output OBS sebenarnya. Tidak tampil tombol admin, alasan override, data akun, atau status pemeriksaan robot rinci. Asset/font harus lokal. Preview menggunakan proyeksi yang sama, tetapi statusnya terpisah dari heartbeat/ack Browser Source OBS. Jika OBS belum pernah ack, tulis “OBS belum terverifikasi”.

Putus heartbeat ≥3 detik, timer.sync basi, atau mismatch revision gagal resync 3 detik: overlay menampilkan safe display netral tanpa countdown/skor live. Terapkan protokol BC pada ARCHITECTURE, termasuk ketika heartbeat tetap sehat. Refresh/reconnect menunggu snapshot terbaru, membersihkan identitas lama sebelum render baru, target pulih ≤3 detik setelah server sehat. Bila OBS hang sehingga JavaScript tidak berjalan, petugas menyembunyikan source secara manual; heartbeat tidak menjamin frame OBS selalu sehat.

## Uji Usabilitas dan Gate

[PROPOSED] Lima panitia mewakili IT, Elektronika, Mesin, operator arena, dan OBS; latihan 15 menit, lalu gunakan data simulasi. ≥4/5 harus menyelesaikan alur 13 langkah tanpa bantuan; seluruh peserta mengidentifikasi match/fase/timer dengan benar dalam ≤5 detik pada jarak meja normal 60–100 cm. ≥4/5 memasukkan gol ≤2 detik dan koreksi beralasan ≤10 detik; tidak ada gol pada tim salah yang lolos tanpa koreksi.

Salah pilih setelah mulai, reset berjalan, finalisasi, double-click, stale modal, server restart dan OBS putus harus diuji. Tidak boleh ada mutasi resmi tanpa sadar atau double commit. Periksa 1366×768/1920×1080, keyboard, zoom 200%, kontras, nama panjang, empty/loading/error/recovery. Ukur bantuan, waktu, kesalahan, keberhasilan dan komentar peserta; jangan hanya meminta “sudah mudah?”. [AC-02/08/10/11/21/27](../03-quality/ACCEPTANCE_CRITERIA.md) dan [test plan](../03-quality/TEST_PLAN.md) menentukan bukti.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-11/12/14: izin, keluaran OBS, ukuran/hardware dan target Q. Komposisi visual final/identitas acara perlu persetujuan panitia; jangan memakai default branding template sebagai identitas resmi. Lihat [SOP](../01-product/SOP.md), [timer](TIMER_SPEC.md), [API](API_CONTRACT.md), dan [runbook](../03-quality/RUNBOOK.md).

## Interaksi Setelah Remediasi Audit

**[PROPOSED]** Detail ini mengikat komponen pada SC/OP/AUTH/BC/ST; bukan fitur yang sudah ada.

### Gol dan Koreksi

Letakkan tombol “Siapkan gol berikutnya” terpisah ≥48 px dari tombol +1 dengan label tanpa nama tim. Satu GoalIntent berlaku untuk kedua sisi, jadi klik A lalu B cepat tidak menciptakan dua gol. Tampilkan “Gol tersimpan. Siapkan input untuk gol berikutnya” sesudah sukses; jangan memindahkan tombol rearm ke lokasi +1. Rearm tidak menambah skor. Abaikan pointer kedua dalam dblclick, key repeat, dan aktivasi sintetis hasil fokus kembali; server token tetap melindungi jika event UI terlewat. Tombol jeda darurat tetap dapat dijangkau saat input gol pending; konflik versi diselesaikan server dan tidak dipaksa menjadi gol baru.

Dialog koreksi menyediakan “Batalkan gol” atau “Pindahkan gol ke Tim A/B”; opsi pindah mengirim goal.reassign sekali, bukan minus lalu plus. Preview menampilkan skor sebelum/sesudah, total tetap, sumber gol/segmen dan alasan/rujukan juri. Jika source telah dikoreksi atau versi berubah, tolak dan tampilkan lineage terkini. Fase RESULT mengizinkan koreksi/gol terlambat menurut juri dengan alasan sampai finalisasi; hasil resmi hanya melalui super-admin.

### Keadaan Operasi Belum Diketahui

Sebelum mengirim command kritis, simpan metadata OP durable; kegagalan menyimpan metadata mencegah execute. Sesudah refresh/login, panel “Periksa tindakan sebelumnya” menampilkan target/action ringkas dan status ledger. SUCCEEDED ditandai tersimpan dan diikuti snapshot baru. UNKNOWN tidak disebut gagal. Tombol “Pastikan/batalkan permintaan lama” menjalankan cancel-or-observe; jangan menampilkan “Coba gol baru” sebelum terminal. Setelah terminal CANCELLED/REJECTED dan snapshot ditinjau, tindakan baru memerlukan pilihan sadar. Tanpa server/storage sehat gunakan catatan manual dan hubungi IT, bukan antrean klik.

### Siap Start dan Pemulihan

READY awal menampilkan “Siapkan segmen pertama” sampai attempt/timer tersedia. Review dan “Siapkan Mulai” dilakukan sebelum aba-aba; tampilan ARMED memperlihatkan tim, attempt, durasi serta masa berlaku token 60 detik usulan. Pada aba-aba, satu klik “Mulai Pertandingan” menjalankan waktu; tombol tetap pada lokasi, tanpa modal kedua. Key repeat/reconnect/page load tidak start. Perubahan state, blur, storage fault, expiry token atau logout membatalkan kesiapan; minta review ulang. Resume setelah pause/recovery mengikuti persiapan yang sama.

Reset diberi teks “Hanya waktu; gol dan segmen tetap”. Restart diberi teks “Ulang segmen; dampak gol ditampilkan” dengan alasan/rujukan juri. Select POSTPONED menampilkan fase/attempt/sisa tersimpan tanpa memindahkan PRE_MATCH. RECOVERY_PENDING menampilkan alasan penahanan dan langkah reconcile terpisah dari resume.

### Status Siaran

Tampilkan terpisah: “Server CONNECTED”, “OBS SYNCHRONIZED / SYNCING / STALE / DISCONNECTED / UNKNOWN”, revision backend/diterima/dirender, serta umur ack. Preview mempunyai indikator sendiri. Badge CONNECTED tidak berwarna/berlabel sama dengan SYNCHRONIZED. Safe display hanya dibuka setelah snapshot otoritatif dirender dan storage/timer sehat sesuai BC; heartbeat saja tidak cukup.

UAT AC-28–37 meliputi respons sangat cepat, dua gol disengaja termasuk rearm, salah sisi pada RESULT, refresh saat UNKNOWN, resume postponed, reset tanpa kehilangan gol, start satu tindakan pada aba-aba, dan OBS tertinggal ketika connected. Target input gol ≤2 detik untuk ≥4/5 peserta mencakup rearm bila diperlukan; keselamatan tidak dianggap lulus hanya karena input cepat. [NEEDS CONFIRMATION] D-14 untuk penerimaan target oleh panitia.
