# SOP — Pelaksanaan Pertandingan

## Tujuan dan Cakupan

Panduan alur panitia MRC X 2026 dari persiapan data sampai memilih match berikutnya. Berdasarkan [SDD asli §3–5](../SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md) dan R-01–R-10 [PRD](PRD.md). Ini alur yang harus didukung aplikasi; fitur belum tersedia pada starter saat ini. Istilah ada di [CONTEXT](../../CONTEXT.md).

## Sebelum Sesi

Koordinator memastikan jadwal dan keputusan juri tersedia. Super-admin memeriksa identitas tim, akun, durasi yang telah disetujui, serta backup yang dapat dipulihkan. Operator dan petugas OBS mencocokkan layar dengan arena. Pemanggilan dan pemanasan belum punya durasi resmi: jangan mengandalkan angka contoh. Wasit tidak wajib menyentuh aplikasi.

## Alur Normal — 13 Langkah

| No. | Penanggung jawab | Tindakan dan pemeriksaan |
|---|---|---|
| 1 | Super-admin | Daftarkan tim sesuai kategori/grup yang ditetapkan, siapkan jadwal; periksa Tim A tidak sama dengan Tim B. |
| 2 | Operator | Pilih match; baca kategori, tahap, kedua tim, dan arena sebelum konfirmasi. |
| 3 | Sistem/operator OBS | Mode berubah dari Waiting menjadi Tunggu Tanding pada Browser Source yang sama; periksa kedua nama. Tidak ada pergantian scene wajib. |
| 4 | Panitia arena | Panggil peserta dan sampaikan informasi ke operator. |
| 5 | Operator | Mulai countdown pemanggilan dengan durasi yang telah disetujui; jumlah panggilan dicatat sesuai keputusan panitia. |
| 6 | Panitia verifikasi/operator | Verifikasi peserta dan robot; operator mencatat masing-masing siap/belum siap/tidak hadir/gagal verifikasi. Tidak ada kelulusan otomatis. |
| 7 | Operator | Setelah kedua tim siap dan ada aba-aba, mulai countdown pemanasan. |
| 8 | Panitia arena/operator | Umumkan pemanasan selesai; hentikan/jeda timer bila perlu dan pindah ke Siap Tanding. |
| 9 | Operator | Sebelum aba-aba, siapkan segmen pertama bila belum ada, periksa tim/durasi lalu “Siapkan Mulai”. Pada aba-aba juri, satu klik Mulai tanpa dialog lagi. |
| 10 | Sistem/operator | Periksa OBS mengikuti Tim A/B, timer, ronde/babak, dan gol Soccer. |
| 11 | Operator + arena | Bila juri meminta segmen berikutnya, hentikan timer lama, masuk Jeda, siapkan segmen, kembali ke Siap Tanding lalu langkah 9. |
| 12 | Juri/operator | Terima hasil juri, hentikan seluruh timer, isi hasil, periksa ringkasan dan konfirmasi selesai; simpan hasil resmi. |
| 13 | Operator | Setelah hasil tersimpan, kembali ke daftar; pilih match berikutnya atau lepaskan tayangan ke Waiting. |

Waktu 00:00 hanya peringatan; operator tidak menganggap match selesai atau tim kalah. Gol selama pertandingan merupakan hasil sementara sampai finalisasi berdasarkan juri.

## Penyimpangan dan Tanggung Jawab

| Keadaan | Tindakan | Pengaman |
|---|---|---|
| Tim tidak hadir/gagal verifikasi | Catat kondisi; tahan alur atau tunda, minta keputusan juri | Tidak menetapkan WO/pemenang otomatis |
| Salah pilih sebelum mulai | Konfirmasi pelepasan pilihan, kembali daftar dan pilih ulang | Riwayat pilihan lama disimpan; tidak mengganti tim match diam-diam |
| Salah pilih setelah mulai | Jeda, beri tahu koordinator, gunakan prosedur khusus yang berizin | Match lama ditunda/dikoreksi, tidak ditimpa |
| Waktu/gol keliru | Jeda bila diperlukan; koreksi dengan alasan dan cek OBS | Koreksi menjadi catatan baru; hasil resmi terkunci |
| Gangguan arena/ronde diulang | Jeda/tunda; catat alasan dan pemberi keputusan | Ulangan adalah percobaan segmen baru; yang lama tetap ada |
| Salah hasil resmi | Operator mengajukan; super-admin membuka revisi atas keputusan juri | Hasil lama tetap terbaca sampai revisi disahkan |
| Tayangan salah/bermasalah | Waiting darurat jika tersambung; bila tidak, petugas OBS sembunyikan source | Mengamankan tayangan tidak menghentikan timer secara otomatis |

Override menggunakan alasan dan izin, bukan sekadar tombol bebas fase. D-11 pada [register](RULEBOOK_NOTES.md) menentukan petugas pemberi izin; hak akun operator tetap mencakup kendali timer dan override yang telah disetujui. Identitas pemberi keputusan lapangan harus ditetapkan sebelum aksi terkait dipakai resmi; super-admin tidak otomatis menggantikan juri. Jeda darurat tidak perlu menunggu admin. Keselamatan lapangan dan instruksi wasit tetap didahulukan.

## Darurat dan Penutupan Sesi

Jika aplikasi gagal, beritahu koordinator dan juri, catat jam/sisa waktu/gol terakhir yang diketahui, gunakan lembar manual, dan sembunyikan tayangan yang menyesatkan. IT memulihkan aplikasi, operator mencocokkan data bersama petugas, lalu melanjutkan hanya setelah konfirmasi. Super-admin mencadangkan setelah sesi dan sebelum perubahan besar. Langkah rinci di [runbook](../03-quality/RUNBOOK.md); transisi teknik di [state machine](../02-engineering/STATE_MACHINE.md).

## Keputusan Belum Selesai

[NEEDS CONFIRMATION] D-01/02/03/04/07/08/09/10/11/12: durasi/metode panggilan, segmen, arena, hasil khusus dan otoritas lapangan. SOP tidak menetapkan jawaban atas peraturan tersebut.

## Penjelasan Setelah Audit

- **Gol Soccer:** satu input = satu gol. Setelah pesan tersimpan, tombol +1 tetap terkunci; untuk gol berikutnya tekan “Siapkan gol berikutnya”, kemudian +1 sisi yang benar. Untuk salah tim, gunakan “Pindahkan gol” satu kali dengan alasan, bukan mengurangi lalu menambah lewat dua tombol. Gol hanya dicatat sesuai keputusan juri.
- **Match tertunda:** pilih kembali match lama; cocokkan fase, segmen, gol dan sisa yang dipulihkan. Jangan mengulang pemanggilan/reset waktu tanpa keputusan tersendiri. Jika ada Recovery, tetapkan sisa bersama juri dahulu; persiapan resume dan aba-aba terpisah.
- **Reset vs ulang segmen:** Reset Timer hanya mengatur ulang waktu, gol/attempt tetap. Ulang Segmen membuat percobaan baru dan menunjukkan dampak gol sebelum konfirmasi.
- **Respons belum jelas/refresh:** buka panel pemeriksaan tindakan sebelumnya. Jangan klik gol/finalisasi baru sampai aplikasi memastikan hasil lama tersimpan atau dibatalkan. Catat manual bila tidak dapat dipastikan.
- **OBS:** “tersambung” belum berarti tayangan sesuai backend. Periksa SYNCHRONIZED; SYNCING/STALE meminta pemeriksaan snapshot/source. Waiting darurat tidak menghentikan timer.
- **Gangguan penyimpanan:** hentikan input aplikasi yang tidak dapat disimpan, beri tahu juri dan catat manual. Setelah IT memperbaiki, lakukan rekonsiliasi; jangan langsung melanjutkan timer hanya karena indikator disk kembali baik.

Alur rinci dan formulir manual ada di [runbook](../03-quality/RUNBOOK.md); kontrak teknik di [state machine](../02-engineering/STATE_MACHINE.md) dan [API](../02-engineering/API_CONTRACT.md). Verifikasi AC-28–37; perubahan ini tidak menetapkan durasi, jumlah ronde, atau hasil kompetisi.
