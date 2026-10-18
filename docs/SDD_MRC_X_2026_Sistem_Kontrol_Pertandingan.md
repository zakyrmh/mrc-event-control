# Dokumen Perencanaan Sistem (SDD)
## Sistem Kontrol Pertandingan dan Tampilan Siaran — Minangkabau Robot Contest X 2026

**Penyelenggara:** UKM Robotik Politeknik Negeri Padang (PNP)  
**Waktu kegiatan:** 31 Oktober–1 November 2026  
**Versi dokumen:** 1.0 (draf untuk pembahasan bersama panitia)  
**Tanggal penyusunan:** 12 Oktober 2026  
**Sasaran pembaca:** Panitia bidang IT, Elektronika, Mesin, operator pertandingan, juri, dan tim dokumentasi/siaran  
**Status:** Rancangan kerja; belum merupakan pengganti rulebook dan keputusan dewan juri.

---

## 1. Ringkasan

Sistem ini membantu panitia mengatur pertandingan **dua tim (Tim A melawan Tim B)** pada empat kategori: **Line Follower Junior, Line Follower Umum, Robot Sumo, dan Robot Soccer**. Melalui satu komputer/laptop, operator memilih pertandingan, mengatur pemanggilan peserta, menjalankan waktu pemanasan dan pertandingan, memasukkan hasil, serta mengirimkan informasi ke tampilan **OBS** secara langsung.

Sistem **berjalan secara lokal tanpa membutuhkan internet atau server luar**. Satu komputer menjadi tempat penyimpanan data, pusat kendali operator, dan sumber tampilan grafis untuk OBS. Perangkat proyektor atau siaran dapat mengambil gambar dari OBS seperti biasa.

**Prinsip utama:** sistem mengikuti SOP panitia dalam kondisi normal, tetapi tetap memberi operator ruang untuk menangani perubahan mendadak. Setiap perubahan di luar alur normal (*override*) perlu alasan dan tercatat.

### 1.1 Tujuan

1. Memastikan nama tim, kategori, waktu, ronde/babak, dan skor yang ditayangkan sesuai pertandingan yang berlangsung.
2. Mengurangi penggantian teks atau tampilan OBS secara manual.
3. Menyediakan kendali waktu yang mudah dipakai panitia saat situasi lapangan berubah.
4. Menjaga data hasil pertandingan agar tidak hilang dan dapat diperiksa ulang.
5. Memudahkan penggunaan ulang sistem pada penyelenggaraan MRC berikutnya.

### 1.2 Batasan tahap awal

- Sistem **bukan pengganti juri atau wasit**. Hasil akhir ditetapkan oleh petugas berdasarkan keputusan juri.
- Sistem **tidak wajib menghitung pemenang otomatis** dari seluruh detail peraturan robot.
- Tidak diperlukan pendaftaran daring, pembayaran peserta, atau sinkronisasi dengan website publik `www.robotik-pnp.com`.
- Tidak diperlukan kendali otomatis atas scene OBS; halaman tampilan siaran dimuat sebagai *Browser Source*.
- Sistem dirancang **satu komputer**, tetapi data pertandingan disiapkan agar di masa depan dapat mendukung beberapa arena.

---

## 2. Istilah yang digunakan

| Istilah | Makna bagi panitia |
|---|---|
| **Super-admin** | Penanggung jawab data awal, grup, jadwal, pengaturan, dan koreksi resmi. |
| **Operator** | Petugas yang memilih pertandingan dan mengendalikan tahap kegiatan serta waktu. |
| **Pertandingan / match** | Pertemuan Tim A melawan Tim B dalam kategori dan tahap tertentu. |
| **Grup** | Kelompok peserta yang sudah diputuskan panitia. |
| **Fase** | Tahapan pekerjaan, seperti pemanggilan, pemeriksaan, pemanasan, atau pertandingan. |
| **Ronde/babak/start** | Bagian dari pertandingan yang dapat memiliki waktu tersendiri. |
| **Timer / countdown** | Hitung mundur menuju 00:00. |
| **OBS** | Aplikasi untuk menyusun tampilan yang diproyeksikan atau disiarkan. |
| **Overlay** | Informasi nama tim, waktu, dan skor yang ditampilkan di atas gambar kamera melalui OBS. |
| **Override** | Tindakan khusus untuk menyimpang dari alur normal karena kondisi lapangan. |
| **Riwayat perubahan** | Catatan siapa melakukan tindakan, kapan, dan mengapa. |
| **SDD (Spec-Driven Development)** | Cara mengembangkan sistem mulai dari kesepakatan kebutuhan dan cara kerjanya, baru kemudian menulis program. |

---

## 3. Pembagian peran dan kewenangan

| Kegiatan | Super-admin | Operator | Panitia arena / verifikasi | Juri / wasit |
|---|:---:|:---:|:---:|:---:|
| Memasukkan dan memperbaiki data tim, grup, jadwal | **Ya** | Tidak | Memberi informasi | Tidak |
| Memilih pertandingan yang ditayangkan | Ya | **Ya** | Mengarahkan | Tidak |
| Memanggil tim dan mengecek kehadiran | Tidak wajib | Mencatat status | **Ya** | Mengawasi sesuai tugas |
| Memeriksa robot dan peserta | Tidak | Mencatat hasil pemeriksaan | **Ya** | Sesuai aturan |
| Memulai/menghentikan timer | Ya | **Ya** | Memberi aba-aba | Memberi keputusan |
| Memasukkan gol Soccer | Ya | **Ya** | Memberi informasi | Menentukan gol sah |
| Memasukkan hasil akhir pertandingan | Ya | **Ya, berdasar keputusan juri** | Menyampaikan hasil | **Menentukan hasil** |
| Mengoreksi hasil yang sudah disahkan | **Ya**, dengan alasan | Mengajukan koreksi | Menginformasikan | Menyetujui keputusan |
| Mengatur durasi standar dan pemulihan data | **Ya** | Tidak | Tidak | Memberi masukan |
| Mengubah fase/durasi karena kendala | Ya | **Ya**, tercatat | Menginformasikan | Sesuai keputusan lapangan |

**Aturan penting:** tindakan operator dalam aplikasi tidak mengesampingkan instruksi keselamatan, keputusan wasit, atau keputusan dewan juri.

---

## 4. SOP utama kegiatan (13 langkah)

Alur berikut adalah urutan normal. Setiap tahap **tidak harus berpindah otomatis** saat waktu habis; operator menyesuaikan dengan kondisi sebenarnya.

| Langkah | Penanggung jawab | Kegiatan | Respons sistem / OBS |
|---:|---|---|---|
| 1 | Super-admin | Memasukkan semua tim, grup, dan daftar pertandingan yang sudah ditetapkan. | Data tersimpan dan siap dipilih. |
| 2 | Operator | Memilih pertandingan Tim A vs Tim B. | Pertandingan ditandai sebagai yang sedang disiapkan. |
| 3 | Sistem | Mengganti OBS dari tampilan **Waiting** ke **Tunggu Tanding**. | Nama Tim A, Tim B, dan kategori muncul. |
| 4 | Panitia arena | Memanggil dua tim menuju arena. | Operator dapat mencatat pemanggilan. |
| 5 | Operator | Memulai hitung mundur pemanggilan. | Waktu pemanggilan terlihat; durasinya dapat diatur. |
| 6 | Panitia verifikasi | Memeriksa identitas peserta, kondisi robot, dan kesiapan tim. | Operator menandai siap, belum siap, atau tidak hadir. |
| 7 | Operator | Memulai hitung mundur pemanasan. | OBS menampilkan fase pemanasan dan waktunya. |
| 8 | Panitia arena | Mengumumkan pemanasan selesai dan peserta harus bersiap. | Operator mengalihkan fase ke **Siap Tanding**. |
| 9 | Operator | Memulai hitung mundur pertandingan. | Waktu pertandingan dimulai untuk ronde/babak aktif. |
| 10 | Sistem | Memperbarui OBS mengikuti informasi pertandingan. | Tampilan berubah langsung saat ada perintah operator. |
| 11 | Operator dan panitia arena | Bila ada ronde/babak/start berikutnya, siapkan bagian berikut dan kembali ke langkah 9. | Identitas match tetap; nomor ronde/babak dan timer bagian baru diperbarui. |
| 12 | Operator | Menerima keputusan juri, memasukkan hasil akhir, lalu menyelesaikan pertandingan. | Hasil disimpan; OBS dapat menampilkan tanda selesai. |
| 13 | Operator | Kembali memilih pertandingan selanjutnya. | OBS dapat kembali ke Waiting atau Tunggu Tanding pertandingan baru. |

**Catatan penting:** langkah 6 tidak boleh dianggap otomatis lulus. Apabila salah satu tim belum lolos pemeriksaan, operator dapat menunda atau mengubah alur sesuai keputusan petugas berwenang.

### 4.1 Alur singkat untuk ditempel di meja operator

```text
DATA TIM & GRUP SIAP
       ↓
PILIH PERTANDINGAN (TIM A vs TIM B)
       ↓
OBS: TUNGGU TANDING
       ↓
PEMANGGILAN + COUNTDOWN
       ↓
VERIFIKASI PESERTA DAN ROBOT
       ↓
PEMANASAN + COUNTDOWN
       ↓
SIAP TANDING
       ↓
PERTANDINGAN + COUNTDOWN
       ↓
Ada ronde/babak berikutnya? ── YA ──→ Siapkan bagian berikut → PERTANDINGAN
       │
     TIDAK
       ↓
HASIL AKHIR DARI JURI → SIMPAN → SELESAI
       ↓
PILIH PERTANDINGAN BERIKUTNYA
```

---

## 5. Mode kendali **Hybrid** (keputusan tetap)

### 5.1 Saat kegiatan berjalan normal

- Operator melihat **satu tombol utama** untuk melanjutkan ke tahap SOP berikutnya.
- Tindakan penting seperti memulai pertandingan dan menyimpan hasil tetap membutuhkan tindakan sadar dari operator.
- Waktu yang habis **tidak otomatis** menyatakan tim gugur atau pertandingan selesai.

### 5.2 Saat ada keadaan khusus

Operator dapat membuka menu **Tindakan Khusus** untuk:

1. Menambah/mengurangi waktu atau mengganti durasi.
2. Menjeda dan melanjutkan timer.
3. Menunda pertandingan, lalu kembali ke tahap sebelumnya.
4. Mengulangi ronde/babak dengan catatan alasan.
5. Menandai tim tidak hadir atau gagal verifikasi dan menunggu keputusan juri.
6. Membatalkan pilihan pertandingan yang keliru.
7. Menampilkan layar siaran aman (**Waiting darurat**) tanpa mengubah hasil pertandingan.

Setiap tindakan khusus mencatat **nama akun petugas, tanggal/jam, pertandingan, keadaan sebelum/sesudah, dan alasan**. Operator tidak dapat mengubah hasil yang sudah disahkan tanpa izin super-admin.

### 5.3 Contoh penanganan kondisi lapangan

| Keadaan | Langkah panitia / operator | Dampak pada sistem |
|---|---|---|
| Tim terlambat | Panitia memanggil ulang; operator menambah waktu bila diizinkan. | Countdown disesuaikan dan alasan dicatat. |
| Tim tidak hadir | Catat pemanggilan; tandai **Tidak Hadir** dan hubungi juri. | Match ditahan, **tanpa otomatis menentukan pemenang**. |
| Robot gagal pemeriksaan | Tandai **Belum Siap / Gagal Verifikasi**. | Pertandingan ditunda sesuai keputusan panitia. |
| Gangguan listrik atau alat arena | Jeda waktu, tunda match jika diperlukan. | Sisa waktu dan tahap terakhir disimpan. |
| Kesalahan memilih tim | Operator batalkan pilihan sebelum mulai atau gunakan prosedur koreksi. | Identitas tayangan diperbaiki; tindakan dicatat. |
| Salah memasukkan gol | Koreksi gol dengan alasan. | Nilai OBS ikut diperbarui. |
| Salah menetapkan hasil akhir | Minta super-admin membuka koreksi berdasarkan keputusan juri. | Hasil lama tetap terekam dalam riwayat. |
| OBS terganggu | Gunakan tampilan Waiting darurat atau segarkan halaman OBS. | Data pertandingan tidak dihapus. |
| Komputer harus dimulai ulang | Pulihkan aplikasi; cek hasil dan waktu bersama petugas. | Timer lama **tidak langsung berjalan sendiri** sampai dikonfirmasi operator. |

---

## 6. Pengendalian waktu (timer)

Semua timer memakai fungsi dasar yang sama: **Mulai, Jeda, Lanjutkan, Hentikan, Atur Ulang, Tambah/Kurangi Waktu**, dan **Tetapkan Durasi Baru**.

| Kegiatan | Durasi awal yang direncanakan | Catatan |
|---|---|---|
| Pemanggilan | **Belum diputuskan** | Rulebook menyebut maksimal tiga panggilan berjeda 20 detik; bentuk timer operasional masih perlu persetujuan panitia. |
| Pemanasan | **Belum diputuskan** | Dapat berbeda dari waktu *running test* dalam rulebook. |
| Line Follower Junior | 2 atau 3 menit per start | Bergantung tahap perlombaan. |
| Line Follower Umum | 2 atau 3 menit per start | Bergantung tahap perlombaan. |
| Sumo | 2 menit per ronde | Berdasarkan rulebook. |
| Soccer | 3 menit per babak | Berdasarkan rulebook. |
| Jeda antarbagian | **Belum diputuskan** | Bila diberlakukan, dapat diatur panitia. |

**Catatan:** angka pertandingan di atas adalah acuan dari rulebook. Operator dapat mengubah durasi untuk keadaan khusus dengan alasan tercatat, bukan mengubah aturan lomba sepihak.

**Perilaku saat timer mencapai 00:00:** layar menampilkan waktu habis dan memberi tanda kepada operator; sistem **tidak otomatis menentukan hasil pertandingan**.

**Jika koneksi tampilan OBS terputus:** waktu dan status yang berlaku tetap tersimpan pada komputer utama. Setelah halaman tayangan tersambung lagi, tampilkan keadaan terbaru.

---

## 7. Kebutuhan menurut kategori lomba

### 7.1 Kesepakatan tampilan dan kontrol

**Semua kategori menggunakan Tim A melawan Tim B.** Pada Line Follower, kedua tim tetap muncul di OBS, termasuk saat penyisihan jika panitia memasangkannya dalam satu sesi tayangan.

| Kategori | Yang dilakukan operator | Yang ditampilkan pada OBS saat bertanding |
|---|---|---|
| **Line Follower Junior** | Pilih pertandingan, start/stop/pause timer, ubah status, pindah start/bagian, tetapkan hasil akhir. | **Nama Tim A, nama Tim B, waktu.** |
| **Line Follower Umum** | Sama seperti LF Junior. | **Nama Tim A, nama Tim B, waktu.** |
| **Robot Sumo** | Pilih pertandingan, kontrol timer, ubah status, pindah ronde, tetapkan hasil akhir. | **Nama Tim A, nama Tim B, timer, ronde.** |
| **Robot Soccer** | Pilih pertandingan, kontrol timer, ubah status, pindah babak, tambah/koreksi gol, tetapkan hasil akhir. | **Nama Tim A, nama Tim B, skor gol, waktu, babak.** |

**Tidak perlu ditampilkan di OBS:** poin checkpoint, rincian penalti Line Follower, rincian pemeriksaan robot, atau panel kendali panitia. Data tambahan tersebut hanya dicatat apabila kemudian diperlukan untuk administrasi atau keputusan juri.

### 7.2 Ringkasan hal penting dari rulebook

**Line Follower Junior**
- Penyisihan: satu run, dengan pemilihan peserta lolos berdasar ketentuan kecepatan menurut rulebook.
- Babak gugur: dua start (kanan dan kiri), dengan aturan pemecahan seri berdasarkan waktu dan poin.
- Terdapat empat checkpoint; mencapai finish memberikan total lima poin.
- Waktu tahap awal 2 menit/start, tahap lanjut tertentu 3 menit/start.
- Sistem MVP menampilkan waktu dan dua nama tim; keputusan hasil akhir tetap berasal dari juri.

**Line Follower Umum**
- Penyisihan dan babak gugur menggunakan pola yang sejenis dengan Junior.
- Terdapat tantangan box dan ketentuan poin tersendiri.
- Waktu pertandingan bervariasi 2 atau 3 menit per start tergantung tahap.
- Terdapat ketidaksesuaian jumlah checkpoint/box antara bagian lapangan dan bagian poin dalam rulebook; perlu diputuskan pada pertemuan teknis.

**Robot Sumo**
- Pertandingan menggunakan ronde maksimal 2 menit.
- Grup dan gugur mempunyai ketentuan jumlah ronde yang perlu ditangani berbeda.
- Pada bagian grup, pertandingan dapat berhenti setelah satu tim meraih dua kemenangan ronde.
- Ada perbedaan redaksi mengenai kewajiban memainkan ronde ketiga pada babak gugur; panitia/juri perlu memastikan pelaksanaan final.

**Robot Soccer**
- Pertandingan dimainkan oleh dua tim; tiap tim memiliki dua robot.
- Bagian aturan saat pertandingan menyebut dua babak, masing-masing tiga menit.
- Sistem grup menggunakan poin kemenangan 3, seri 1, kekalahan 0; jika poin sama, jumlah gol menjadi pembeda menurut rulebook.
- Babak gugur yang seri dapat dilanjutkan adu penalti; catatan adu penalti sebaiknya terpisah dari gol waktu normal.
- Ada perbedaan redaksi antara jumlah lawan/ronde di grup dan babak pertandingan, sehingga jadwal serta pelaksanaannya perlu dikonfirmasi.

**Rujukan utama:** berkas rulebook MRC X 2026 yang dibagikan panitia: *Rule Line Follower Digital JUNIOR v1.1*, *Rule Line Follower Digital UMUM v1.1*, *Rule Robot Sumo*, dan *Rule Robot Soccer*. Dokumen ini hanya merangkum hal yang memengaruhi sistem; untuk keputusan peraturan tetap merujuk berkas aslinya.

---

## 8. Bentuk tampilan OBS

Tampilan siaran mempunyai beberapa keadaan. Perubahan keadaan **tidak perlu mengubah scene OBS secara manual**.

| Mode tayangan | Informasi yang tampil |
|---|---|
| **Waiting** | Identitas MRC X 2026; tidak ada pertandingan aktif. |
| **Tunggu Tanding** | Kategori, nama Tim A dan Tim B. |
| **Pemanggilan** | Kategori, kedua tim, label pemanggilan, countdown. |
| **Verifikasi** | Kedua tim dan informasi bahwa pemeriksaan sedang berlangsung. |
| **Pemanasan** | Kedua tim, label pemanasan, countdown. |
| **Siap Tanding** | Kedua tim dan pesan bersiap. |
| **Pertandingan** | Sesuai tabel empat kategori pada Bagian 7. |
| **Jeda / Pindah Ronde** | Kedua tim dan keterangan jeda atau persiapan bagian berikutnya. |
| **Selesai** | Kedua tim dan pesan pertandingan selesai; pemenang ditampilkan hanya setelah disahkan. |
| **Tertunda / Waiting Darurat** | Pesan netral tanpa menghilangkan data atau hasil match. |

**Prinsip desain grafis:** huruf besar, kontras tinggi, mudah dibaca dari jauh, tidak menutupi area utama kamera, dan sesuai identitas visual MRC X. Halaman grafis dapat menggunakan latar transparan supaya gambar kamera masih terlihat.

Contoh tampilan saat pertandingan:

```text
LINE FOLLOWER JUNIOR
TIM A                  VS                  TIM B
                    01:35

ROBOT SUMO
TIM A                  VS                  TIM B
                RONDE 2  |  01:24

ROBOT SOCCER
TIM A                 2 - 1                TIM B
                BABAK 2  |  01:50
```

---

## 9. Kebutuhan utama sistem (untuk dicek bersama)

| Kode | Kebutuhan | Prioritas |
|---|---|---|
| K-01 | Super-admin memasukkan, mengimpor, dan mengoreksi tim serta grup. | Wajib |
| K-02 | Super-admin menyiapkan daftar pertandingan untuk empat kategori. | Wajib |
| K-03 | Operator memilih pertandingan yang sedang disiapkan. | Wajib |
| K-04 | OBS berpindah otomatis ke tampilan sesuai tahap SOP. | Wajib |
| K-05 | Operator menjalankan pemanggilan dan mencatat kesiapan tim. | Wajib |
| K-06 | Operator mengendalikan countdown pemanasan dan pertandingan. | Wajib |
| K-07 | Operator dapat menjeda, mengubah, dan mengulangi waktu dengan pengaman. | Wajib |
| K-08 | Operator dapat melanjutkan ronde/babak/start pada match yang sama. | Wajib |
| K-09 | Operator Soccer dapat menambah atau mengoreksi gol. | Wajib |
| K-10 | Operator dapat memasukkan dan menyimpan hasil akhir sesuai juri. | Wajib |
| K-11 | Keadaan tidak hadir, terlambat, penundaan, dan perubahan fase dapat ditangani. | Wajib |
| K-12 | Setiap perubahan penting memiliki riwayat. | Wajib |
| K-13 | Data tidak hilang saat halaman atau OBS direfresh. | Wajib |
| K-14 | Sistem tetap berjalan tanpa internet. | Wajib |
| K-15 | Data dapat dicadangkan dan dipulihkan secara aman. | Wajib |
| K-16 | Rekap hasil dapat diekspor (misalnya CSV). | Disarankan |
| K-17 | Bagan turnamen dan pemilihan tim lolos otomatis. | Pengembangan lanjutan |
| K-18 | Kontrol scene OBS langsung dari dashboard. | Pengembangan lanjutan |

### 9.1 Hal yang **tidak boleh** terjadi

- Pertandingan dinyatakan selesai hanya karena timer habis.
- Tim dinyatakan kalah otomatis hanya karena terlambat, tanpa keputusan petugas berwenang.
- Skor resmi berubah tanpa jejak riwayat.
- Operator tidak sengaja mengaktifkan pertandingan yang berbeda ketika ronde sedang berlangsung.
- OBS menampilkan data dari pertandingan lama setelah operator memilih match baru.
- Kehilangan internet membuat sistem tidak dapat digunakan.

---

## 10. Rencana halaman sistem

### 10.1 Halaman super-admin

- Daftar kategori dan grup.
- Daftar tim (tambah, ubah, impor).
- Daftar pertandingan per kategori, grup, dan tahap.
- Pengaturan durasi standar dan identitas acara.
- Daftar hasil dan riwayat perubahan.
- Cadangan data dan pemulihan.

### 10.2 Halaman operator

Bagian utama disusun dalam satu layar:

1. **Pertandingan aktif** — Tim A, Tim B, kategori, grup/tahap, status.
2. **Tahap kegiatan saat ini** — misalnya Pemanggilan, Pemanasan, atau Pertandingan.
3. **Countdown besar** — terlihat jelas; tombol Mulai, Jeda, Lanjut, Hentikan.
4. **Kontrol ronde/babak/start** — muncul sesuai kategori.
5. **Input gol** — hanya tampil untuk Soccer.
6. **Lanjut Tahap** — tindakan normal sesuai SOP.
7. **Tindakan Khusus** — penundaan, koreksi waktu, ganti fase, ulang ronde, dan sebagainya.
8. **Tetapkan Hasil Akhir** — disertai konfirmasi.
9. **Pratinjau OBS dan indikator tersambung/tidak** — agar operator tahu apa yang ditonton publik.

### 10.3 Halaman OBS

Halaman khusus yang hanya menampilkan grafis untuk siaran. Tidak ada tombol atau menu administrasi.

---

## 11. Penyimpanan data dan perlindungan hasil

Sistem menyimpan minimal:

- Kategori dan grup pertandingan.
- Identitas tim dan institusi asal bila diperlukan.
- Jadwal/urutan match serta Tim A dan Tim B.
- Status pertandingan dan fase operasional terakhir.
- Catatan kehadiran/verifikasi singkat.
- Waktu, ronde/babak/start, serta penyesuaian yang pernah dilakukan.
- Skor gol Soccer dan hasil akhir dari juri.
- Match yang sedang ditayangkan di OBS.
- Riwayat perubahan dan alasan tindakan khusus.

**Cadangan data:** data disimpan di komputer utama, kemudian dicadangkan secara berkala ke media berbeda. Panitia perlu menyediakan file hasil ekspor atau lembar catatan manual sebagai langkah darurat jika komputer rusak.

**Keamanan:** hanya akun yang diberikan akses yang boleh mengubah data. Tampilan OBS hanya membaca data yang perlu ditayangkan, tidak memiliki akses untuk mengubah hasil.

---

## 12. Pengujian sebelum hari acara

Pengujian dilakukan bersama perwakilan panitia IT, Elektronika, Mesin, dan petugas OBS, bukan oleh pembuat aplikasi saja.

| Uji | Cara memeriksa | Lulus bila... |
|---|---|---|
| Pilih pertandingan | Pilih Tim A vs Tim B dari daftar. | Identitas benar di dashboard dan OBS. |
| Pemanggilan | Jalankan countdown pemanggilan. | Waktu dapat dimulai, dijeda, dan diubah. |
| Verifikasi | Tandai satu tim belum siap. | Pertandingan tidak dipaksa lanjut. |
| Pemanasan | Jalankan waktu lalu habiskan. | Timer menjadi 00:00 tanpa otomatis memulai pertandingan. |
| Pertandingan | Mulai dan hentikan waktu. | Tampilan OBS mengikuti timer operator. |
| Ronde berikutnya | Pindah ke ronde/babak selanjutnya. | Match tetap sama, nomor bagian berubah, timer siap. |
| Gol Soccer | Tambahkan lalu koreksi gol. | Skor berubah di OBS dan riwayat tercatat. |
| Tidak hadir | Tandai satu tim tidak hadir. | Sistem menunggu keputusan petugas. |
| Penundaan | Tunda saat pertandingan berlangsung. | Waktu dan fase dapat dipulihkan. |
| Salah pilih tim | Perbaiki pilihan secara aman. | Tidak ada data lama yang tertimpa diam-diam. |
| Finalisasi | Tetapkan hasil dan konfirmasi. | Hasil tersimpan dan terlindungi dari perubahan sembarang. |
| OBS refresh | Segarkan Browser Source. | Tampilan kembali pada keadaan terbaru. |
| Tanpa internet | Matikan akses internet saat simulasi. | Sistem tetap berjalan. |
| Restart aplikasi | Matikan lalu jalankan kembali aplikasi. | Hasil tidak hilang; timer tidak diam-diam berjalan kembali. |
| Backup dan restore | Pulihkan cadangan percobaan. | Pertandingan dan hasil sesuai data cadangan. |

**Target teknis awal:** perubahan nama tim, skor, dan status tampilan diharapkan muncul pada OBS dengan jeda sangat kecil (target internal maksimal sekitar 0,5 detik dalam komputer yang sama). Target ini harus dibuktikan melalui pengujian, bukan dianggap jaminan.

---

## 13. Persiapan operasional dan pembagian tugas hari-H

### Sebelum acara

- **Koordinator pertandingan:** memastikan daftar peserta, grup, tahap, jadwal, dan keputusan rulebook telah disahkan.
- **Super-admin:** memeriksa ulang data, menyiapkan akun operator, durasi standar, dan backup.
- **Petugas arena dan verifikasi:** menyepakati prosedur pemanggilan, pemeriksaan, serta pemberian status kesiapan.
- **Operator sistem:** berlatih mengubah fase dan timer, mengoreksi nilai, serta menunda pertandingan.
- **Tim OBS/dokumentasi:** menguji ukuran grafis, keterbacaan, dan pembaruan langsung dari komputer.
- **Tim teknis:** menguji komputer, daya listrik, penyimpanan, dan perangkat cadangan.

### Saat acara

- Petugas arena berkomunikasi dengan operator sebelum pemindahan fase penting.
- Operator hanya menetapkan hasil resmi setelah menerima keputusan juri.
- Penggantian waktu, babak, atau pertandingan karena kendala harus memiliki alasan.
- Setelah satu sesi pertandingan selesai, super-admin membuat cadangan data.

### Jika aplikasi tidak dapat digunakan

1. Hentikan penggunaan kontrol otomatis dan hubungi koordinator.
2. Lanjutkan pencatatan pertandingan pada lembar manual sesuai instruksi juri.
3. Jika memungkinkan, tampilkan mode Waiting pada OBS atau sembunyikan grafis pertandingan.
4. Setelah aplikasi kembali normal, super-admin memasukkan ulang catatan yang tervalidasi.
5. Cocokkan hasil input ulang dengan keputusan juri sebelum pertandingan berikutnya.

---

## 14. Jadwal pengembangan menuju acara

| Periode | Fokus | Hasil yang diharapkan |
|---|---|---|
| 12–15 Oktober | Kesepakatan kebutuhan, data tim/grup, rancangan halaman. | Kebutuhan disetujui dan data uji tersedia. |
| 16–20 Oktober | Alur SOP, mode hybrid, timer. | Operator bisa menjalankan satu pertandingan dari awal sampai akhir. |
| 21–24 Oktober | Tampilan OBS dan empat kategori. | Semua kategori bisa ditampilkan dengan tepat. |
| 25–28 Oktober | Simulasi lengkap dan penanganan kendala. | Panitia dapat menguji skenario normal maupun darurat. |
| 29–30 Oktober | Pembekuan perubahan dan persiapan laptop. | Versi stabil, backup, dan prosedur operasional siap. |
| 31 Oktober–1 November | Pelaksanaan MRC X 2026. | Sistem digunakan dan diawasi selama acara. |

Jadwal ini adalah **target kerja**, bukan jaminan penyelesaian. Jika waktu terbatas, prioritasnya adalah memilih match, alur SOP, timer, tampilan OBS, pencatatan hasil, dan pemulihan data.

---

## 15. Daftar keputusan yang belum final

Bagian ini **wajib dibahas** bersama koordinator, juri, dan operator sebelum penggunaan resmi.

| No. | Hal yang harus diputuskan | Alasan |
|---:|---|---|
| 1 | Durasi countdown pemanggilan dan apakah dihitung per panggilan atau total. | Agar sinkron dengan prosedur tiga kali pemanggilan pada rulebook. |
| 2 | Durasi pemanasan dan jeda untuk masing-masing kategori. | Agar tidak bertentangan dengan ketentuan running test. |
| 3 | Jumlah arena yang aktif secara bersamaan. | Menentukan kebutuhan layar/operator terpisah. |
| 4 | Format pertandingan Line Follower pada penyisihan: pasangan tayang vs satu run penilaian. | Permintaan tampilan dua tim harus tetap konsisten dengan mekanisme penilaian penyisihan. |
| 5 | Aturan waktu dan poin saat hasil Line Follower imbang. | Redaksi waktu terbaik/rata-rata perlu dipastikan. |
| 6 | Jumlah checkpoint dan box yang dihitung pada LF Umum. | Ada perbedaan angka dalam dua bagian rulebook. |
| 7 | Aturan ronde ketiga dan tambahan pada Sumo, khususnya babak gugur. | Ada redaksi yang berpotensi berbeda. |
| 8 | Format grup Soccer: dua lawan, dua babak, dan tahap berikutnya. | Agar daftar match dan babak selaras. |
| 9 | Tata cara input hasil seri, menang tanpa lawan, diskualifikasi, dan adu penalti. | Agar hasil akhir konsisten dengan keputusan juri. |
| 10 | Siapa petugas yang memberi izin perubahan durasi pertandingan dan perubahan status. | Agar tindakan khusus punya dasar keputusan yang jelas. |
| 11 | Apakah OBS hanya satu keluaran utama atau memiliki tampilan terpisah tiap arena. | Untuk memastikan operator tidak salah menayangkan pertandingan. |

### Formulir persetujuan singkat

| Peran | Nama | Tanggal | Persetujuan / catatan |
|---|---|---|---|
| Koordinator MRC X | | | |
| Koordinator perlombaan | | | |
| Perwakilan juri LF | | | |
| Perwakilan juri Sumo | | | |
| Perwakilan juri Soccer | | | |
| Penanggung jawab operator/IT | | | |
| Penanggung jawab OBS | | | |

---

## Lampiran A — Gambaran teknis singkat untuk tim pengembang

Lampiran ini ditujukan terutama kepada panitia yang mengembangkan aplikasi. Panitia non-IT cukup memahami Bagian 1–15.

### A.1 Cara kerja sistem

```text
Dashboard Super-admin ──┐
                        ├── Aplikasi Lokal (satu komputer)
Dashboard Operator ─────┘           │
                                   ├── Penyimpanan data pertandingan
                                   ├── Pengendali fase dan countdown
                                   └── Pembaruan tampilan langsung
                                                 │
                                            OBS Browser Source
                                                 │
                                           Proyektor / Siaran
```

### A.2 Rekomendasi perangkat lunak

- Antarmuka: React, Vite, TypeScript, Tailwind CSS.
- Program lokal: Node.js dengan Fastify.
- Data lokal: SQLite (dapat dibantu Prisma).
- Pembaruan langsung: Socket.IO.
- Validasi input: Zod.
- Pengujian: Vitest dan Playwright.

Seluruh fitur utama harus dapat berjalan **tanpa internet**, termasuk file tampilan, ikon, font, dan pustaka yang dipakai.

### A.3 Modul pengembangan

```text
specs/
  001-konfigurasi-acara/
  002-tim-dan-grup/
  003-daftar-pertandingan/
  004-alur-sop-pertandingan/
  005-pengendali-timer/
  006-line-follower/
  007-sumo/
  008-soccer/
  009-tampilan-obs/
  010-penanganan-kendala/
  011-hasil-dan-riwayat/
  012-cadangan-dan-pemulihan/
```

Setiap modul mempunyai penjelasan kebutuhan (`spec.md`), rencana pengerjaan (`plan.md`), dan daftar pekerjaan (`tasks.md`). Nama folder dapat disesuaikan tim pengembang.

### A.4 Prinsip internal yang tidak boleh dilanggar

1. Penyimpanan lokal adalah sumber data resmi; OBS hanya menampilkan salinannya.
2. Status pertandingan, fase SOP, serta kondisi timer disimpan terpisah.
3. Setiap perubahan penting disimpan terlebih dahulu sebelum diumumkan ke tampilan OBS.
4. Satu arena hanya boleh memiliki satu pertandingan aktif pada saat yang sama.
5. Operasi penambahan gol dan penyelesaian match harus aman dari klik ganda.
6. Hasil final hanya dapat diperbaiki melalui alur koreksi resmi.
7. Jika komputer menyala lagi setelah gangguan, timer yang sebelumnya aktif menunggu konfirmasi operator.
8. Data dan semua halaman penting tersedia tanpa layanan pihak ketiga.

### A.5 Contoh kriteria penerimaan

> **Ketika operator memilih pertandingan Tim A melawan Tim B**, sistem menyimpan pilihan tersebut dan OBS menampilkan kedua nama tim dalam mode Tunggu Tanding.
>
> **Ketika operator menjeda waktu pertandingan**, timer operator serta timer OBS sama-sama berhenti dan dapat dilanjutkan dari sisa waktu sebelumnya.
>
> **Ketika satu tim tidak hadir**, operator dapat mencatatnya, tetapi sistem tidak otomatis menyatakan tim lain menang sebelum keputusan juri.
>
> **Ketika operator mengubah durasi di luar ketentuan standar**, sistem meminta alasan, menyimpan riwayat, dan memperbarui OBS.

---

## Lampiran B — Dokumen rujukan

1. **Rule Line Follower Digital JUNIOR MRC X 2026 v1.1**, terutama bagian Waktu, Poin, Sistem Pertandingan, dan Peraturan Teknis (halaman 4–6).
2. **Rule Line Follower Digital UMUM MRC X 2026 v1.1**, terutama bagian Waktu, Poin, Sistem Pertandingan, dan Peraturan Teknis (halaman 3–6).
3. **Rule Robot Sumo MRC X 2026**, terutama bagian Peraturan Permainan, Waktu, dan Diskualifikasi (halaman 4–6).
4. **Rule Robot Soccer MRC X 2026**, terutama bagian Peraturan Permainan, Waktu, Sistem Poin, dan Diskualifikasi (halaman 4–8).

**Catatan akhir:** Apabila dokumen ini berbeda dari rulebook atau keputusan technical meeting yang lebih baru, panitia harus meninjau ulang spesifikasi terkait sebelum sistem digunakan.
