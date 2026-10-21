# Catatan Rulebook dan Register Keputusan

## Tujuan, Cakupan, dan Bukti

Mencegah ringkasan peraturan berubah menjadi aturan aplikasi tanpa persetujuan. Cakupan: empat kategori, keputusan operasional, dan konflik sumber. Pencarian seluruh berkas proyek pada 16 Oktober 2026 tidak menemukan rulebook asli, notulen technical meeting, atau SOP terisi selain [SDD asli](../SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md). Berkas product/engineering/quality/ADR sebelumnya kosong. Kami belum meninjau empat rulebook yang disebut Lampiran B SDD.

**Aturan resmi terverifikasi:** belum ada bukti primer yang dapat diverifikasi di repository. **Keputusan pengguna terkonfirmasi:** dua tim pada seluruh kategori, peran, Hybrid, 13 langkah, dan kendali manual berbasis juri. **Ringkasan sekunder:** pernyataan peraturan SDD §6/7 berikut. **Usulan teknik:** kontrak state/API/data, bertanda [PROPOSED].

## Ringkasan Sekunder — Seluruhnya [NEEDS CONFIRMATION]

| Kategori | Klaim di SDD asli §6/7 | Dampak aplikasi sebelum verifikasi |
|---|---|---|
| LF Digital Junior | 2/3 menit per start menurut tahap; penyisihan satu run, gugur dua start, empat checkpoint/total lima poin | Durasi/segmen dimasukkan setelah persetujuan; tanpa hitung checkpoint/kelolosan |
| LF Digital Umum | 2/3 menit; box/poin; jumlah checkpoint/box berbeda antarbab sumber | Tidak mengkodekan jumlah/poin; hanya timer dan dua nama |
| Sumo | Maksimal dua menit/ronde; dua kemenangan pada grup; redaksi ronde ketiga gugur ambigu | Tidak menentukan jumlah ronde atau pemenang otomatis |
| Soccer | Dua babak × tiga menit; dua robot/tim; poin klasemen 3/1/0; penalti untuk seri gugur | Gol normal terpisah dari catatan penalti; tanpa klasemen otomatis |
| Pemanggilan | Maksimal tiga panggilan berjeda 20 detik | Belum menentukan apakah timer per panggilan atau total |

Nama sumber yang belum tersedia: Rule Line Follower Digital JUNIOR v1.1, Rule Line Follower Digital UMUM v1.1, Rule Robot Sumo, Rule Robot Soccer. Jangan menganggap nomor halaman yang disebut SDD sebagai halaman yang telah diperiksa.

## Register Keputusan dan Konflik

Seluruh baris berikut berstatus **[NEEDS CONFIRMATION]**. “Sementara” adalah perilaku aman yang diusulkan, bukan aturan pertandingan.

| ID | Pernyataan/sumber yang perlu dipertemukan | Dampak | Pemilik keputusan | Perilaku sementara |
|---|---|---|---|---|
| D-01 | Asli §6/15.1: tiga panggilan/20 detik vs countdown belum final | Metode menghitung dan durasi | Koordinator arena + juri | Konfigurasi kosong; blok start timer sampai durasi diisi dan dikonfirmasi; catat panggilan manual |
| D-02 | Asli §6/15.2: pemanasan vs running test dan jeda | Durasi per kategori/fase | Koordinator + juri | Tidak mengisi angka resmi; konfigurasi eksplisit wajib |
| D-03 | Asli §1/A.4 satu komputer/satu match per arena vs §15.3 jumlah arena belum final | Kepemilikan kontrol/siaran | Koordinator + IT + OBS | **[ACCEPTED / DECIDED 21-Okt-2026]** Topologi 1 Laptop Server Pusat (Fastify + SQLite WAL) melayani N Laptop Meja Arena (Operator + OBS) via LAN lokal. Manajemen Master Arena bersifat dinamis; `ArenaState` dimutasi per arena independen; isolasi 1 match aktif per arena dijamin secara otoritatif ([ADR-0004](../04-decisions/0004-dynamic-multi-arena-topology.md)). |
| D-04 | Asli §7.1 dua tim LF vs §7.2 satu run penyisihan | Pasangan tayang berbeda dari penilaian | Juri LF | Tetap dua nama; hasil manual, tanpa memilih peserta lolos |
| D-05 | Asli §7.2/15.5 waktu terbaik/rata-rata dan seri LF; prosedur final kelolosan tiap kategori belum mempunyai bukti primer | Hasil dan penetapan peserta lolos | Juri kategori + koordinator | Catat keputusan juri dan daftar peserta lolos yang disahkan secara manual, tanpa algoritme |
| D-06 | Asli §7.2/15.6 checkpoint/box LF Umum tidak selaras | Poin dan data tambahan | Juri LF Umum | Tidak membangun kalkulator poin |
| D-07 | Asli §7.2/15.7 ronde ketiga/tambahan Sumo | Segmen dan akhir match | Juri Sumo | Ronde berikutnya dipilih manual sesuai keputusan yang dicatat |
| D-08 | Asli §7.2/15.8 jumlah lawan grup vs jumlah babak Soccer | Jadwal dan segmen | Juri Soccer + penjadwal | Jadwal manual; label babak, jumlah tidak dihardcode |
| D-09 | Asli §7.2/15.9: seri, WO, DQ, adu penalti | Bentuk hasil resmi | Dewan juri | Simpan keterangan keputusan juri; nilai enum khusus tidak diaktifkan sebelum disepakati |
| D-10 | Asli §6 angka timer disebut rulebook; file primer tidak ada | Salah durasi pertandingan | Juri tiap kategori | Tidak seed angka sebagai resmi; simpan sumber konfigurasi dan pengesah |
| D-11 | Asli §3/15.10: operator boleh ubah durasi, petugas pemberi izin belum ditetapkan | Otorisasi override lapangan | Koordinator + dewan juri | Hak operator menurut AUTH dipertahankan; daftar pemberi izin lapangan untuk authorityReference harus disahkan. Sebelum itu gunakan simulasi/penahanan cabang resmi terkait; jeda darurat operator tetap tersedia tanpa menunggu admin |
| D-12 | Asli §8/15.11 keluaran OBS tunggal vs per arena | Target siaran | Koordinator + OBS | **[ACCEPTED / DECIDED 21-Okt-2026]** Siaran OBS dibagi per arena melalui Socket.IO room (`arena:<kode>`) dan URL dinamis `http://<server-ip>:3000/overlay?arena=<kode>`. Mode EMERGENCY beroperasi per arena tanpa mengganggu siaran arena lain ([ADR-0004](../04-decisions/0004-dynamic-multi-arena-topology.md)). |
| D-13 | Asli §14 jadwal target vs kondisi starter 16 Oktober | Risiko kesiapan event | Koordinator + IT | Jadwalkan ulang dengan bukti gladi; fallback manual wajib |
| D-14 | Arahan terbaru: recovery/UX terukur; SDD §12 target ~0,5 detik tanpa hardware | Ambang Q, checkpoint, recovery dan batas durasi teknis | IT + perwakilan operator | [PROPOSED] target Q dan RO-01–04 (backup/RPO ≤30 menit, RTO end-to-end ≤10 menit, checkpoint ≤1 detik) diuji dan disetujui pada laptop acara; bukan janji performa |
| D-15 | Asli K-01 impor wajib, format belum ada; kebijakan akun/retensi/backup belum rinci | Persiapan data, keamanan, kapasitas | Super-admin + IT | [PROPOSED] CSV pratinjau, sesi lokal, backup penutupan sesi dan berkala menurut RO; format/batas/retensi/media dan bukti juri untuk input historis dikonfirmasi |

## Cara Menutup Keputusan

1. Lampirkan berkas sumber resmi atau notulen bertanggal beserta versi dan bagian/halaman yang relevan.
2. Catat ID D, pengambil keputusan, tanggal, isi keputusan, serta alasan bila berbeda dari SDD.
3. Ubah status hanya setelah bukti tersedia; tautkan bukti dari baris keputusan. Simpan pernyataan lama sebagai riwayat.
4. Perbarui kebutuhan [PRD](PRD.md), kontrak teknik, specs, dan AC terdampak tanpa mengganti ID. Ulangi tes terkait.

[SDD turunan](SDD.md) menjelaskan prioritas sumber. [SOP](SOP.md) menjelaskan tindakan lapangan ketika keputusan belum tersedia. Kontradiksi peraturan menghentikan implementasi cabang yang bergantung padanya, bukan diisi asumsi pengembang.

## Pemisahan Keputusan Setelah Remediasi

H-01–H-07/M-01/M-03/M-05/M-06/L-01 adalah celah kontrak engineering yang dijawab dengan desain [PROPOSED] dan oracle pengujian; bukan permintaan memilih aturan kompetisi. M-02 masih memerlukan D-11 untuk identitas pemberi keputusan lapangan, sementara hak aplikasi operator sudah dikonfirmasi dan tidak dikurangi. M-04 masih memerlukan D-14/15 untuk penerimaan target recovery/media/PIC. Rincian status ada di [AUDIT_REMEDIATION](../03-quality/AUDIT_REMEDIATION.md). Tidak satu pun D-01–D-15 ditutup hanya karena remediasi ditulis.
