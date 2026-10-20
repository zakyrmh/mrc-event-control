# Runbook Panitia — Pengoperasian dan Pemulihan

## Tujuan, Cakupan, dan Status Kesiapan

Panduan tindakan praktis panitia MRC X 2026 saat persiapan, pertandingan, gangguan, dan penutupan. Berdasarkan [SOP](../01-product/SOP.md) serta R-03–R-16 [PRD](../01-product/PRD.md). **Aplikasi operasional belum tersedia.** Langkah tombol/layar di sini adalah alur target [PROPOSED], perlu dicocokkan dengan rilis dan dilatih sebelum dipakai. Jangan memakai template Vite untuk pertandingan resmi.

Operator menjalankan kontrol; juri/wasit memutuskan pertandingan; panitia arena memanggil/memeriksa peserta; super-admin mengelola data dan pemulihan; IT menangani proses, berkas dan perangkat; petugas OBS menjaga tayangan. “Hasil sementara” belum disahkan; “hasil resmi” hanya diubah lewat super-admin. Istilah rinci di [CONTEXT](../../CONTEXT.md).

## 1. Menyiapkan dan Menyalakan

**Saat ini:** hanya perintah frontend pada [README](../../README.md) yang tersedia. Belum ada launcher/script produksi, database, akun, maupun alamat overlay yang berfungsi. IT harus melengkapi kartu rilis berikut sebelum menyerahkan ke panitia; jika belum lengkap, penggunaan resmi **ditahan**.

| Kartu rilis wajib | Isi yang harus disediakan IT |
|---|---|
| Versi aplikasi/schema dan tanggal gladi lulus | Artifact yang benar-benar diuji, bukan “latest” |
| Launcher produksi dan cara membuka | Path serta langkah nyata yang sudah diuji tanpa internet |
| Alamat dashboard/overlay/port | Usulan `http://127.0.0.1:3000/operator` dan `/overlay/main`; belum tersedia, ganti sesuai rilis |
| Lokasi data dan media backup | Path absolut yang diuji dan media kedua yang diberi label |
| Akun dan kontak penanggung jawab | Kredensial diberikan pribadi; kontak koordinator, IT, super-admin, OBS; jangan taruh password di dokumen |
| Bukti kesiapan | Build, offline, restore, timer recovery dan OBS lulus; keputusan D relevan ditutup |

Setelah rilis siap: sambungkan daya stabil/UPS bila tersedia, pastikan ruang penyimpanan cukup, buka launcher sesuai kartu, tunggu indikator server/database siap, lalu masuk akun operator. IT memastikan hanya satu proses aplikasi dan port tidak bentrok. Jangan menginstal paket atau memigrasi DB mendadak saat sesi berlangsung.

## 2. Pemeriksaan Sebelum Sesi

1. Super-admin mencocokkan kategori, grup, pasangan, jadwal dan durasi dengan keputusan koordinator/juri. Pendaftaran tim atau impor CSV dilakukan melalui antarmuka admin dengan verifikasi pratinjau all-or-nothing (pastikan 0 baris error sebelum commit). Jika durasi belum disahkan, hentikan persiapan fungsi itu dan tanyakan penanggung jawab.
2. Buka dashboard; pastikan identitas acara, status koneksi server dan penyimpanan baik. Jika ada pemulihan timer, selesaikan pemeriksaan pada bagian 9 sebelum lanjut.
3. Petugas OBS memasang alamat Browser Source sesuai kartu rilis, ukuran/transparansi sesuai hasil gladi. Periksa label “OBS menerima data”; preview saja belum cukup.
4. Tampilkan match simulasi, cocokkan kedua tim, gol, waktu dan segmen pada output OBS sebenarnya; lepaskan simulasi sebelum data resmi dipakai.
5. Super-admin memeriksa backup terakhir, checksum/status valid dan salinan di media berbeda. Siapkan lembar manual, alat tulis dan pencatat waktu cadangan.
6. Koordinator menyatakan siap; operator mulai menggunakan jadwal resmi. Jika startup gagal, jangan berpindah ke Vite dev sebagai solusi hari-H.

## 3. Pilih Match, Panggil, dan Verifikasi

1. Cari match sesuai arahan arena; baca nama Tim A/B, kategori dan tahap keras-keras kepada petugas. Konfirmasi pilihan.
2. Tunggu pesan tersimpan; periksa OBS menjadi Tunggu Tanding dengan nama yang sama. Jika salah, jangan mulai. Lepaskan pilihan sebelum bermain dan pilih ulang dengan alasan.
3. Panitia memanggil peserta; operator mulai timer Pemanggilan yang telah disepakati. Jumlah panggilan dicatat menurut keputusan panitia, tidak diasumsikan otomatis.
4. Saat waktunya memeriksa, hentikan/jeda countdown sesuai kebutuhan dan pilih Verifikasi. Catat setiap tim: siap, belum siap, tidak hadir, atau gagal verifikasi berdasarkan laporan petugas.
5. Jika tidak siap, jangan menekan Mulai Pertandingan. Hubungi koordinator/juri; gunakan tunda bila diminta. Timer habis tidak berarti kalah.

## 4. Pemanasan dan Mulai Pertandingan

1. Setelah kedua tim dinyatakan siap, pastikan durasi Pemanasan benar dan mulai atas aba-aba. Panitia mengumumkan selesai pemanasan.
2. Pindah Siap Tanding setelah timer dibekukan/berakhir. Cocokkan start/ronde/babak serta durasi pertandingan.
3. Sebelum aba-aba, siapkan segmen pertama bila belum ada, baca ringkasan dan tekan “Siapkan Mulai”. Pastikan tim/segmen/durasi benar dan tombol siap. Pada aba-aba juri, satu klik “Mulai Pertandingan”, tanpa dialog lagi. Tunggu bukti tersimpan dan RUNNING; jika kesiapan kedaluwarsa, minta juri menunggu persiapan ulang, jangan memaksa start.
4. Awasi waktu, fase, koneksi dan OBS. Jika mencapai 00:00, tunggu putusan juri; hasil tidak selesai sendiri.

## 5. Gol Soccer dan Segmen Berikutnya

Untuk gol sah, pastikan sisi dan nama tim, lalu klik “+1 Gol” satu kali. Tunggu pesan tersimpan; kedua tombol +1 tetap terkunci. Untuk gol sah berikutnya, tekan “Siapkan gol berikutnya”, lalu +1 sisi yang benar. Jika salah sisi, buka “Koreksi gol ini” → “Pindahkan gol ke tim yang benar”; isi alasan/rujukan juri dan simpan sekali. Jika gol dibatalkan juri, pilih “Batalkan gol”. Periksa skor OBS sesudah commit. Jangan memasukkan adu penalti sebagai gol waktu normal.

Jika juri meminta ronde/babak/start berikutnya: hentikan/jeda timer lama, akhiri segmen, masuk Jeda, pilih segmen berikut sesuai keputusan, periksa nomor/durasi, lalu Siap Tanding dan mulai setelah aba-aba. Tidak ada jumlah ronde/babak baku yang boleh ditebak operator. Mengulang segmen harus melalui Tindakan Khusus dan membaca dampak waktu/gol sebelum konfirmasi; riwayat lama tetap disimpan.

## 6. Menetapkan Hasil dan Kembali ke Daftar

1. Terima keputusan juri, bekukan timer, dan buka Hasil. Cocokkan tim, skor sementara, keputusan akhir dan keterangan juri.
2. Isi hasil sesuai putusan; jangan menebak pemenang dari timer/gol/kehadiran. Untuk seri/WO/DQ/penalti yang formatnya belum disepakati, minta super-admin dan juri menetapkan pencatatan resmi.
3. Baca ringkasan lalu “Sahkan Hasil dan Selesaikan”. Tunggu bukti tersimpan; hindari menekan berulang saat respons lambat.
4. Pilih match berikutnya atau tampilkan Waiting. Setelah sesi, minta super-admin membuat backup.
5. Jika hasil resmi salah, operator mengajukan koreksi; super-admin membuka revisi dengan alasan dan dasar juri. Hasil lama tetap resmi hingga revisi disahkan. Jangan menghapus match atau membuat duplikat untuk menyembunyikan kesalahan.

## 7. Kendala Lapangan dan Salah Input

| Keadaan | Langkah operator/panitia |
|---|---|
| Tidak hadir / gagal verifikasi | Catat kondisi dan panggilan; tahan/tunda sesuai koordinator; tunggu juri. Tidak menetapkan kalah sendiri. |
| Timer salah | Jeda bila perlu; catat sisa yang terlihat, minta waktu benar dari juri; Ubah Waktu dengan alasan; cek OBS sebelum lanjut. Reset mengisi ulang durasi awal, berbeda dari koreksi sisa. |
| Salah pilih setelah bermain | Jeda, hubungi koordinator, tunda match lama dengan alasan lalu pilih yang benar; jangan mengganti nama tim pada match yang sudah berjalan. |
| Gangguan arena | Utamakan keselamatan, jeda/tunda sesuai aba-aba, catat alasan; saat lanjut periksa fase/segmen/waktu. |
| Tombol ditolak | Baca pesan: kesiapan, izin, data berubah, atau hasil terkunci. Muat keadaan terbaru dan minta bantuan sesuai pesan; jangan memaksa dengan banyak klik. |
| Respons belum diketahui | Buka “Periksa tindakan sebelumnya”, termasuk sesudah refresh. Jika UNKNOWN, gunakan “Pastikan/batalkan permintaan lama” saat server sehat; hanya setelah terminal dan review snapshot boleh input baru. Setelah 30 detik masih tidak jelas, hubungi IT/catat manual. |

## 8. OBS atau Browser Terputus

Bila hanya OBS putus, pertandingan di server tetap berjalan. Hubungi petugas OBS; bila tersambung gunakan Waiting darurat, tetapi ingat timer tidak otomatis berhenti. Jika server tidak tersambung atau source membeku, petugas menyembunyikan Browser Source secara manual. Segarkan source, tunggu snapshot terbaru, cocokkan kedua tim/gol/segmen/waktu dan status penerimaan OBS sebelum menayangkan lagi. Jangan reset pertandingan untuk memperbaiki OBS.

Bila dashboard terputus, jangan terus klik. Beri tahu juri, catat keadaan terakhir dan ikuti keputusan jeda/manual. Setelah tersambung, baca snapshot terbaru; refresh browser tidak memulai ulang timer dan tidak boleh mengirim ulang antrean klik.

## 9. Restart Aplikasi, Listrik Padam, atau Penyimpanan Gagal

1. Operator memberi tahu koordinator/juri dan mencatat match, fase, segmen, gol serta sisa terakhir yang diketahui. Amankan siaran; gunakan lembar manual bila diperlukan.
2. IT memeriksa daya, proses, log dan ruang penyimpanan. Jangan menghapus database, WAL, backup, atau menjalankan reset/migrasi untuk sekadar membuat startup berhasil.
3. Jika memungkinkan, hentikan lewat launcher secara tertib; jika proses mati, jalankan versi yang sama sesuai kartu rilis. IT memeriksa readiness/schema/integritas DB.
4. Operator membuka layar Recovery. Timer yang semula berjalan harus menunggu konfirmasi, bukan langsung lanjut. Bandingkan sisa checkpoint dan perkiraan downtime dengan catatan juri; perkiraan bukan waktu pertandingan yang otomatis sah.
5. Masukkan sisa yang disetujui dan alasan, simpan rekonsiliasi; pastikan state Dijeda/00:00. Lanjutkan terpisah setelah aba-aba juri, lalu cocokkan OBS.
6. Jika DB gagal/disk penuh, hentikan input yang tidak tersimpan dan lanjutkan pencatatan manual. IT memindahkan log nonpenting/menyiapkan media hanya setelah memastikan data acara aman. Jangan menghapus file DB/backup demi ruang kosong.

Tidak ada jaminan pemulihan semua data setelah media rusak/listrik putus. Jika state meragukan, juri menentukan kelanjutan; gunakan bagian backup atau manual di bawah.

## 10. Backup dan Restore — Super-admin Bersama IT

**Backup:** sebelum acara, setelah setiap sesi, dan sebelum perubahan besar, gunakan fungsi backup konsisten yang sudah diuji. Tunggu status terverifikasi, catat waktu/versi/checksum, salin ke media berbeda, dan cek dapat dibaca. Jangan sekadar menyalin file `.db` saat aktif; data WAL bisa belum tersalin. Simpan cadangan baik sebelumnya sampai yang baru terbukti baik.

**Restore:** hanya dalam maintenance setelah semua proses/penulis database berhenti atau terfence. Record RUNNING lama di database/backup bukan proses timer yang hidup dan tidak menghalangi restore; record itu wajib direkonsiliasi sesudah pemulihan. Koordinator menyetujui jeda operasi; catat data yang mungkin lebih baru dari backup. IT mengarsipkan data sekarang, memverifikasi checksum/versi pada salinan, menguji integritas dan jumlah match/hasil/audit, lalu menghentikan semua penulis. Gunakan prosedur restore launcher yang telah digladi untuk mengganti data secara atomik; jangan merge file DB atau overwrite saat aplikasi berjalan. Jalankan aplikasi yang kompatibel, login ulang, rekonsiliasi timer, cocokkan hasil bersama juri, dan input ulang hanya catatan tervalidasi sesudah waktu backup. Target dan cara mengukur recovery mengikuti bagian RO di bawah; kehilangan dihitung dari titik transaksi backup, bukan dianggap nol.

**Backup hilang/rusak:** jangan menimpa data yang masih ada dengan file tak terverifikasi. Hubungi IT/super-admin, lanjutkan lembar manual, dan cari salinan media lain. Jika tidak ada sumber yang valid, laporkan batas pemulihan; hasil tidak direka ulang dari ingatan satu orang.

## 11. Menutup Acara

Selesaikan atau tunda secara resmi semua match aktif, hentikan timer, verifikasi hasil dengan juri, dan buat backup akhir ke media berbeda. Ekspor rekap hanya jika fungsi tersebut tersedia dan telah diuji; backup DB tetap diperlukan. IT menghentikan aplikasi melalui launcher, lalu OBS dan komputer. Catat insiden, versi terakhir, lokasi cadangan dan penanggung jawab penyimpanan. Pertahankan aplikasi/schema yang sesuai backup; retensi menunggu keputusan panitia.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] Isi kartu rilis, nama PIC/kontak, durasi/metode panggilan, arena/channel, izin override, hasil khusus, retensi dan media backup: [D-01–D-15](../01-product/RULEBOOK_NOTES.md). Buktikan prosedur melalui [test plan](TEST_PLAN.md) dan [AC-01–AC-27](ACCEPTANCE_CRITERIA.md); jangan menyatakan panduan siap hari-H sebelum gladi.

## 12. Kartu Insiden Penyimpanan dan Rekonsiliasi

**[PROPOSED]** prosedur berikut harus tersedia pada launcher/layar rilis; saat ini belum ada implementasi.

1. Bila muncul DEGRADED, operator memberi tahu juri, catat match/fase/segmen/gol, checkpoint terakhir, observasi saat gangguan dan jam kejadian. Jangan menyebut observasi yang belum tersimpan sebagai data resmi. Jeda lapangan sesuai arahan keselamatan; bila backend tak dapat menyimpan jeda, catat manual dan petugas OBS hide source.
2. IT memperbaiki penyebab, lalu menjalankan Pemeriksaan Penyimpanan pada alat rilis teruji. Tiga probe berhasil, pemeriksaan integritas dan kapasitas membawa sistem ke RECOVERY_PENDING, bukan langsung pertandingan berjalan.
3. Operator/juri memeriksa setiap timer terdampak dan memilih sisa yang sah. Aplikasi mencatat alasan, incidentId dan rujukan juri. Periksa pula operasi UNKNOWN; IT membantu cancel-or-observe, tidak membuat command pengganti tanpa hasil terminal.
4. IT menutup insiden sesudah semua timer direconcile dan ledger ditangani. Operator memeriksa snapshot/OBS SYNCHRONIZED, review/Siapkan Mulai sebelum aba-aba, lalu satu klik Lanjutkan setelah aba-aba. Jika storage gagal lagi, kembali prosedur pertama.

### Formulir Manual dan Input Historis (H-07)

Gunakan formulir bernomor/QR recordId UUID yang disiapkan sebelum acara, dengan eventId dan matchId. Jika kertas cadangan tanpa nomor dipakai, super-admin menetapkan recordId satu kali saat penerimaan, menuliskannya pada kertas, dan selalu memakai ID sama saat input ulang. Semua versi lembar lama tetap disimpan.

Field wajib: recordId, matchId, kategori, Tim A/B, waktu kejadian (occurredAt), fase/segmen dan waktu yang diamati, keputusan/hasil akhir juri, gol final Soccer bila relevan, nama pemberi keputusan dan refereeReference, tanda persetujuan sesuai kebijakan panitia, serta evidenceRef lokasi lembar. Waktu input (recordedAt) diisi aplikasi, bukan disamakan dengan jam pertandingan. [NEEDS CONFIRMATION] D-09/11/15 menentukan format hasil khusus, petugas pengesah dan bentuk bukti yang diterima.

Sesudah layanan pulih, super-admin membuka Rekonsiliasi Historis dalam maintenance. Cocokkan formulir dengan cut backup dan hasil yang sudah ada; lakukan preview, tangani recordId duplikat atau konflik hasil, dan minta keputusan juri bila berbeda. Commit seluruh batch hanya setelah preview disetujui. Batch gagal tidak memasukkan sebagian hasil. Revisi hasil resmi tetap menunjukkan versi sebelumnya. Tidak menjalankan ulang pemanggilan/timer atau mengaktifkan match lampau untuk memasukkan catatan. Catatan baru yang mengoreksi formulir memakai supersedesRecordId, bukan menyembunyikan sumber lama. Sebelum keluar maintenance, cocokkan hasil/jumlah record dan siapkan match berikutnya secara normal.

## 13. Tujuan Recovery dan Pengukuran — RO (M-04)

**[PROPOSED] [NEEDS CONFIRMATION] D-14/15:** angka berikut adalah target gladi yang harus disetujui koordinator/IT, bukan jaminan atau aturan lomba.

| ID | Definisi terukur / target usulan | Bukti |
|---|---|---|
| RO-01 | Sesi = blok jadwal dengan eventSessionId, daftar match, penanggung jawab serta waktu buka/tutup yang dicatat. Backup wajib sebelum acara, saat sesi ditutup, sebelum perubahan besar, dan setiap ≤30 menit selama sesi. Target umur cut backup terverifikasi di media kedua ≤30 menit selama event | Manifest cut, waktu copy/verify dan snapshot daftar match; sesi belum dianggap ditutup sampai backup memuat seluruh commit sesi itu dan diverifikasi |
| RO-02 | RPO = selang titik transaksi durable terakhir yang dapat dipulihkan sampai waktu insiden; laporkan juga daftar match/command sesudah backup. Target kehilangan akibat rusak host ≤30 menit jika checkpoint backup terpenuhi; pencatatan manual bukan alasan mengklaim RPO nol | backupCutCommandId/At, incidentAt, daftar selisih; bila backup/media hilang, laporkan target gagal, bukan menyatakan pasti pulih |
| RO-03 | Target checkpoint timer ≤1 detik saat HEALTHY; ukur jarak antar checkpoint durable dan selisih observasi saat kill. Ini bukan jaminan RPO hasil/gol saat daya/media gagal | Log/manifest checkpoint dan 20 restart; acknowledged command diuji terpisah |
| RO-04 | Target RTO restore ≤10 menit. Mulai ketika koordinator menyatakan layanan tidak dapat dipakai (incidentDeclaredAt); selesai ketika artifact kompatibel/data valid tersedia, login berhasil, semua timer/ledger terkait direconcile, hasil diverifikasi dan operator siap menjalankan match berikutnya (serviceReadyAt). Termasuk pencarian backup, verifikasi, restore dan review; tidak berhenti saat proses sekadar menyala | Stopwatch/rekaman, incident log, manifest, checklist operator/juri. Waktu lanjutan input historis yang belum selesai tetap dilaporkan; bila diperlukan untuk kesiapan, termasuk RTO |

RO-01 adalah jadwal cadangan yang diusulkan, tidak otomatis diterima karena tertulis. Sampai disetujui dan diuji, persiapan backup/timer/hasil resmi tetap wajib tetapi klaim RPO/RTO tertentu belum dapat dipakai sebagai janji. Media kedua dan petugas backup harus ditetapkan; disk penuh/media tak ada memicu peringatan dan keputusan koordinator. Cadangan baik terakhir tetap disimpan.

Validasi AC-32/33/34/36 pada [acceptance](ACCEPTANCE_CRITERIA.md). Sinkronisasi siaran mengikuti BC [arsitektur](../02-engineering/ARCHITECTURE.md). Status penutupan temuan ada pada [laporan remediasi](AUDIT_REMEDIATION.md).
