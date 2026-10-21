# PRD — Kendali Pertandingan MRC X 2026

## Tujuan dan Cakupan

Menyediakan kendali pertandingan serta siaran yang mudah dioperasikan panitia IT, Elektronika, dan Mesin pada 31 Oktober–1 November 2026. Cakupan: empat kategori, dua tim, alur Hybrid, timer, gol Soccer, hasil resmi, audit, dan pemulihan lokal. Dokumen ini menetapkan kebutuhan; tidak menyatakan implementasi telah tersedia.

## Sumber dan Tingkat Kepastian

Sumber historis: [SDD asli](../SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md), khususnya §3–13 dan Lampiran A. Arahan pengguna 16 Oktober 2026 mengonfirmasi peran, 13 langkah SOP, Hybrid, kendali per kategori, serta prioritas UI dan reliabilitas. Arahan terbaru berlaku untuk perencanaan jika berbeda dari SDD; sumber asli tetap utuh. Rulebook asli tidak tersedia. Rancangan teknik bertanda [PROPOSED]; register [NEEDS CONFIRMATION] ada di [RULEBOOK_NOTES](RULEBOOK_NOTES.md).

## Pengguna, Sasaran, dan Batasan

Super-admin mengelola kategori, arena pertandingan dinamis, tim, grup, jadwal, akun operator, durasi, audit, backup/restore, serta koreksi hasil resmi. Operator memilih arena tugas, memilih match di arenanya, mengendalikan fase/segmen/timer/gol, menyiarkan, dan memfinalisasi berdasarkan juri. Panitia arena memanggil dan memverifikasi peserta; juri menetapkan keputusan tanpa wajib mengoperasikan aplikasi.

Keberhasilan berarti panitia menyelesaikan alur normal dan keadaan khusus dengan identitas benar, hasil terlindungi, multi-arena berjalan konkuren tanpa saling mengganggu, dan pemulihan yang dapat dijelaskan. Tidak termasuk pendaftaran daring, pembayaran, sinkronisasi publik, integrasi scene OBS, algoritme juara/klasemen/kelolosan otomatis, atau penilaian robot otomatis. Ekspor rekap bersifat disarankan (SDD K-16); bracket otomatis dan kontrol scene tetap pengembangan lanjutan (K-17/K-18).

## Register Kebutuhan dan Ketertelusuran

ID berikut stabil; AC adalah skenario dalam [acceptance](../03-quality/ACCEPTANCE_CRITERIA.md). Q merupakan target penerimaan [PROPOSED] yang harus diuji pada laptop acara, bukan jaminan.

| ID | Kebutuhan / sumber | Pemilik desain / spesifikasi | Bukti |
|---|---|---|---|
| R-01 | CRUD/impor tim, kategori, grup; SDD K-01 | DATA_MODEL; 001 | AC-01 |
| R-02 | Jadwal dan pilihan Tim A/B; K-02/03 | STATE_MACHINE; 001/002 | AC-02/29 |
| R-03 | SOP 13 langkah, verifikasi eksplisit; K-05/06 | SOP; 002 | AC-03/29/30 |
| R-04 | Hybrid override dengan alasan; K-07/11/12 | STATE_MACHINE / API AUTH; 002 | AC-04/35 |
| R-05 | Durasi dan semua perintah timer; K-06/07 | TIMER_SPEC; 003 | AC-05/06/29/30/33 |
| R-06 | Segmen LF/start, Sumo/ronde, Soccer/babak; attempt pertama, reset vs restart; K-08 | STATE_MACHINE; 002/003 | AC-07/29 |
| R-07 | Tambah/koreksi gol Soccer, intent sekali pakai dan reassign atomik; K-09 | API_CONTRACT SC; 002 | AC-08/28 |
| R-08 | Finalisasi juri, reopen super-admin; K-10/12 | DATA_MODEL; 002 | AC-09/10/34 |
| R-09 | Mode OBS, preview dan revision diterima/dirender sinkron; K-04 | ARCHITECTURE BC; 004 | AC-11/31 |
| R-10 | Tidak hadir/gagal verifikasi/penundaan; K-11 | SOP; 002 | AC-12 |
| R-11 | Persistensi, ledger setelah refresh, restart dan storage recovery aman; K-13 | TIMER_SPEC ST / API OP; 003 | AC-13/14/32/33 |
| R-12 | Operasi offline termasuk aset; K-14 | ARCHITECTURE; 004 | AC-15 |
| R-13 | Backup/restore, fallback dan rekonsiliasi historis atomik; K-15 | RUNBOOK RO / API REC; 002 | AC-16/17/34/36 |
| R-14 | RBAC, hak operator, izin lapangan terpisah, sesi/bootstrap CSRF; §3/11 | API_CONTRACT AUTH; 001 fondasi | AC-18/35 |
| R-15 | Audit seluruh mutasi/sensitif; K-12 | DATA_MODEL / API OP; 002 | AC-19/28/32/34/37 |
| R-16 | Produksi satu server lokal tanpa Vite dev; arahan pengguna | ARCHITECTURE; 004 | AC-20 |
| R-17 | Default timer per kategori/fase dapat diatur; §6 | TIMER_SPEC; 003 | AC-05 |
| R-18 | Pemilihan/gol aman dan satu start sadar pada aba-aba setelah review; §9/10 | UI_UX_GUIDELINES; 002 | AC-02/08/21/28/30 |
| R-19 | Manajemen arena dinamis, isolasi konkurensi match per arena, siaran OBS room terpisah; ADR-0004 | ARCHITECTURE / DATA_MODEL; 001/004 | AC-38 |
| Q-01 | OBS: p95 commit-ke-render ≤500 ms, 100 perubahan di komputer acara; §12 | ARCHITECTURE; 004 | AC-11 |
| Q-02 | Lima panitia lintas bidang; ≥4/5 menyelesaikan SOP tanpa bantuan setelah latihan 15 menit | UI_UX_GUIDELINES | AC-21 |
| Q-03 | Gol sah: ≥4/5 pengguna input ≤2 detik, koreksi ≤10 detik tanpa mengubah tim lawan | UI_UX_GUIDELINES | AC-08/21 |
| Q-04 | 100 retry key sama/payload sama satu mutasi; 20 key berbeda dengan versi sama tepat satu pemenang | API_CONTRACT | AC-22/37 |
| Q-05 | Nol kehilangan mutasi yang sudah diakui pada 20 kill/restart proses; timer tidak auto-resume | TIMER_SPEC | AC-14 |
| Q-06 | Reconnect setelah layanan sehat: snapshot terbaru ≤3 detik pada 20 percobaan | API_CONTRACT | AC-13 |
| Q-07 | Selisih timer dashboard/OBS ≤250 ms p95 selama 10 menit, termasuk pause/adjust | TIMER_SPEC | AC-23 |
| Q-08 | Fault DB/disk: nol sukses palsu, nol state/audit parsial pada 10 injeksi per jenis | DATA_MODEL | AC-24 |
| Q-09 | [PROPOSED] RO-01–04: backup cut media kedua ≤30 menit, RPO host ≤30 menit, RTO end-to-end ≤10 menit, checkpoint sehat ≤1 detik | RUNBOOK RO | AC-16/25/36 |
| Q-10 | Layar 1366×768 dan 1920×1080, keyboard/200% zoom, tanpa kontrol utama hilang | UI_UX_GUIDELINES | AC-21 |
| Q-11 | Soak 4 jam tanpa internet dengan ≥100 match simulasi, tanpa divergensi state/hasil | TEST_PLAN | AC-15/26 |
| Q-12 | Safe display pada heartbeat/timer.sync basi 3 detik atau mismatch revision gagal resync 3 detik sejak terdeteksi; CONNECTED ≠ SYNCHRONIZED | ARCHITECTURE BC | AC-27/31 |

## Prioritas dan Gate Rilis

Prioritas A: operator memahami match/fase, kontrol utama besar, feedback dan koreksi jelas. Prioritas B: state server persisten, transaksi, validasi, idempotency, clock monotonic, rekonsiliasi restart, serta recovery. Semua R wajib untuk rilis operasional; fitur lanjutan dapat ditunda. Target Q harus disepakati penanggung jawab IT dan dibuktikan; kegagalan kritis menahan rilis, bukan dilabeli lulus.

## Keputusan Terbuka dan Referensi

D-01–D-15 di [register](RULEBOOK_NOTES.md) memuat pemilik dan perilaku sementara. [SDD turunan](SDD.md) menghubungkan sumber, peran, dan kontrak; [test plan](../03-quality/TEST_PLAN.md) menetapkan pelaksanaan bukti. Tidak ada aturan kompetisi yang menjadi resmi hanya karena dicantumkan dalam PRD.

## Penutupan Celah Audit dan Otoritas

Penajaman kebutuhan di atas mempertahankan ID. [Laporan remediasi](../03-quality/AUDIT_REMEDIATION.md) memetakan H-01–H-07/M-01–M-06/L-01 ke requirement dan AC-28–37. Kontrak SC/OP/AUTH/REC pada API, BC pada arsitektur, ST pada timer dan RO pada runbook adalah [PROPOSED] engineering yang dapat diimplementasikan untuk pembuktian; tidak mengesahkan aturan lomba. Hak operator tidak dikurangi sambil menunggu D-11. [NEEDS CONFIRMATION] M-02/D-11 (pemberi keputusan lapangan) dan M-04/D-14/15 (penerimaan target recovery) tetap gate operasional. Pilihan GoalIntent/rearm wajib dibuktikan UAT, bukan dinyatakan mudah hanya dari desain.
