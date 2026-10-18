# SDD Turunan — Spesifikasi Sistem MRC X 2026

## Tujuan, Cakupan, dan Status

Mengorganisasikan kebutuhan [SDD asli](../SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md) bertanggal 12 Oktober 2026 menjadi spesifikasi implementasi. Mencakup semua kebutuhan wajib PRD dan empat paket fitur; tidak menggantikan rulebook. Arahan pengguna 16 Oktober 2026 menambah detail UI/reliabilitas dan menjadi dasar keputusan perencanaan terbaru. State, skema, dan endpoint teknik adalah [PROPOSED] sampai diimplementasikan dan ditinjau.

## Definisi dan Kepemilikan

[CONTEXT](../../CONTEXT.md) menetapkan istilah. Status match menjawab “kedudukan pertandingan”; fase menjawab “kegiatan sekarang”; segmen menyatakan start/ronde/babak; timer menyatakan kondisi hitung mundur; mode OBS hanya presentasi. Mengganti mode OBS ke Waiting tidak menjeda timer.

| Domain | Otoritas / persyaratan | Sumber |
|---|---|---|
| Data acara | Super-admin: kategori/tim/grup/jadwal/durasi/akun | Asli §3/10; R-01/02/14/17 |
| Kegiatan lapangan | Panitia memanggil/verifikasi; juri memberi aba-aba dan putusan | Asli §3/4; R-03/10 |
| Kendali match | Operator mengirim perintah, server memvalidasi, persistensi mendahului OBS | Asli A.4; R-04/15 |
| Hasil | Operator mengonfirmasi keputusan juri; hanya super-admin membuka revisi resmi | Asli §5/11; R-08 |
| Siaran | Halaman baca publik terbatas, tidak mengendalikan scene OBS | Asli §8/10; R-09/12/16 |
| Recovery | Super-admin menangani backup; operator memverifikasi waktu setelah restart | Asli §5/12/13; R-11/13 |

Super-admin mewarisi aksi operasional untuk penanganan darurat, tetap mengikuti validasi dan audit; hak koreksi hasil tidak otomatis diberikan ke operator. Alasan override tidak sama dengan izin: server tetap memeriksa role, match, dan invariant.

## Alur dan Variasi Kategori

Alur normatif terdiri dari 13 langkah [SOP](SOP.md). Pemanasan baru boleh dimulai setelah kedua peserta diverifikasi siap. Perpindahan biasa menampilkan langkah berikutnya, tetapi selalu tindakan sadar operator. Timer habis tidak memindahkan fase atau menetapkan hasil. Tim tidak hadir/gagal verifikasi ditahan untuk keputusan petugas; tidak ada pemenang otomatis.

| Kategori resmi untuk dokumentasi | Kontrol segmen/gol | Data minimum OBS saat pertandingan |
|---|---|---|
| Line Follower Digital Junior | Start bila disepakati, tanpa kalkulasi poin | Tim A/B, timer |
| Line Follower Digital Umum | Start bila disepakati, tanpa kalkulasi poin | Tim A/B, timer |
| Robot Sumo | Ronde, tanpa otomatis berhenti karena kemenangan ronde | Tim A/B, timer, ronde |
| Robot Soccer | Babak, gol sementara dan koreksi | Tim A/B, gol, timer, babak |

## Ketertelusuran Sumber

| Bagian asli | Dokumen normatif turunan |
|---|---|
| §1–3, §9 | [PRD R-01–R-18 dan Q-01–Q-12](PRD.md) |
| §4–5 | [SOP](SOP.md), [state machine](../02-engineering/STATE_MACHINE.md) |
| §6 | [timer](../02-engineering/TIMER_SPEC.md) |
| §7, §15, Lampiran B | [rulebook dan keputusan terbuka](RULEBOOK_NOTES.md) |
| §8, §10 | [UI/UX](../02-engineering/UI_UX_GUIDELINES.md) |
| §11, A.4 | [data](../02-engineering/DATA_MODEL.md), [API](../02-engineering/API_CONTRACT.md) |
| §12–14 | [test plan](../03-quality/TEST_PLAN.md), [runbook](../03-quality/RUNBOOK.md) |
| Lampiran A | [arsitektur](../02-engineering/ARCHITECTURE.md), specs 001–004 |

K-01–K-15 dipetakan ke register R di PRD; K-16 disarankan, K-17/18 di luar MVP. Penomoran folder fitur sekarang mengikuti permintaan terbaru, bukan daftar contoh 12 folder Lampiran A.3. Tugas mendasar seperti akun/audit/backup dialokasikan eksplisit pada specs dan tidak diasumsikan sudah tersedia.

## Konflik dan Perilaku Sementara

Nama LF pada asli §1/7 disingkat; gunakan nama Digital Junior/Umum dari arahan terbaru tanpa mengubah dokumen asli. Klaim “berdasarkan rulebook” asli §6/7 adalah ringkasan sekunder, bukan verifikasi baru. Angka durasi tidak boleh menjadi default resmi sebelum persetujuan. Satu komputer dikonfirmasi; jumlah arena tetap D-03. Startup produksi satu server merupakan [PROPOSED] desain untuk memenuhi R-16. Semua konflik dan dampak ada di [register keputusan](RULEBOOK_NOTES.md).

## Penyelesaian dan Gate

Implementasi dilakukan sesuai spesifikasi fitur, membuktikan AC yang terpetakan di PRD, menguji pemulihan pada laptop acara, dan memperbarui runbook dengan launcher produksi yang benar-benar tersedia. [NEEDS CONFIRMATION] Persetujuan D-01–D-15 dilakukan sebelum fungsi yang bergantung padanya dipakai resmi; pekerjaan fondasi independen dapat berjalan.

## Penajaman Kontrak Setelah Audit Substantif

R-07/R-18 memakai GoalIntent sekali pakai, rearm eksplisit dan reassign atomik (SC); R-11 memakai ledger pending yang bertahan refresh (OP) serta storage gate (ST); R-09 memakai revision received/rendered yang dibedakan dari connection heartbeat (BC). R-13 menyediakan rekonsiliasi historis terverifikasi tanpa menjalankan ulang pertandingan (REC). Matriks fase/attempt/timer, pemilihan ulang postponed dan start satu tindakan sesudah review sebelum aba-aba diperinci pada [state machine](../02-engineering/STATE_MACHINE.md).

Semua pilihan teknik tersebut **[PROPOSED]** untuk implementasi dan pembuktian AC-28–37; [laporan remediasi](../03-quality/AUDIT_REMEDIATION.md) memetakan seluruh 14 temuan. Hak operator mengikuti keputusan sumber, sedangkan [NEEDS CONFIRMATION] D-11 menyangkut pemberi keputusan lapangan; D-14/15 menyangkut target recovery RO, bukan pengesahan otomatis peraturan.
