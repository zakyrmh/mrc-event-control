# State Machine Pertandingan dan Mode Hybrid

## Tujuan, Cakupan, dan Status

Kontrak **[PROPOSED]** untuk R-02–R-08/R-10/R-11/R-15/R-18 [PRD](../01-product/PRD.md), diperjelas oleh H-03/M-01/M-05. Hybrid dan kendali operator telah dikonfirmasi; enum/guard adalah desain. [CONTEXT](../../CONTEXT.md) membedakan status, fase, attempt, timer dan mode OBS. Peraturan jumlah segmen/hasil tetap menunggu keputusan panitia.

## Status dan Kepemilikan Arena

| Status | Arti | Transisi sah |
|---|---|---|
| SCHEDULED | Belum dipilih | select →PREPARING; cancel oleh S →CANCELLED |
| PREPARING | Persiapan sebelum start pertama | start →IN_PROGRESS; release →SCHEDULED; postpone →POSTPONED; hasil khusus berizin →COMPLETED |
| IN_PROGRESS | Sudah bermain, termasuk jeda | pause →PAUSED; postpone →POSTPONED; finalize →COMPLETED |
| PAUSED | Match yang sudah bermain ditahan | start/resume sesuai guard →IN_PROGRESS; postpone →POSTPONED; finalize →COMPLETED |
| POSTPONED | Fase/attempt/timer disimpan, arena dilepas | select-resume →PREPARING bila hasStarted=false, selain itu PAUSED |
| COMPLETED | Hasil resmi terkunci | reopen oleh S →CORRECTION_PENDING |
| CORRECTION_PENDING | Draft revisi, hasil resmi lama tetap berlaku | refinalize/cancel-correction oleh S →COMPLETED |
| CANCELLED | Pembatalan sebelum bermain | Tidak kembali bermain; jadwal baru bila diputuskan |

Fase: PRE_MATCH, CALLING, VERIFICATION, WARMUP, READY, COMPETITION, INTERMISSION, RESULT, FINISHED. Attempt: PREPARED/ACTIVE/ENDED/REPLACED. Timer: IDLE/RUNNING/PAUSED/STOPPED/EXPIRED/RECOVERY_REQUIRED. Satu match aktif per arena, satu attempt ACTIVE dan satu timer RUNNING per match. Command operasional wajib menargetkan activeMatchId arena, matchVersion dan timer/attempt milik match yang benar. POSTPONED tidak boleh menerima timer.resume/goal hanya karena fase tersimpan masih COMPETITION. Koreksi hasil resmi dan impor historis adalah jalur terpisah tanpa mengambil arena.

## Pemilihan Pertama dan Pemilihan Ulang (H-03)

| Command/kondisi | Efek atomik |
|---|---|
| select SCHEDULED | Arena kosong atau match COMPLETED dilepas; PREPARING/PRE_MATCH, currentSegmentId kosong dan belum ada timer kompetisi terpilih; riwayat persiapan lama tetap arsip; data verifikasi UNKNOWN/PENDING pada match baru; OBS Tunggu Tanding |
| select POSTPONED belum bermain | Pulihkan resumePhase/attempt/timer tersimpan, status PREPARING; bukan kembali PRE_MATCH; timer tetap beku |
| select POSTPONED sudah bermain | Pulihkan resumePhase/currentSegmentId dan sisa, status PAUSED; attempt ACTIVE/ENDED tetap sebagaimana ditunda; timer PAUSED/STOPPED/EXPIRED/recovery tetap beku; OBS fase tersimpan + label ditahan |
| release sebelum bermain | Freeze/arsipkan instance persiapan; attempt PREPARED bila ada→ENDED tanpa pernah ACTIVE, kosongkan currentSegmentId, lepaskan arena, SCHEDULED/PRE_MATCH; catat pembatalan pilihan; pemilihan berikutnya meminta verifikasi ulang dan instance persiapan baru |
| postpone | Freeze hanya timer RUNNING (0→EXPIRED, selain itu PAUSED); IDLE/PAUSED/STOPPED/EXPIRED yang sudah beku tetap state semula, simpan resumePhase/attempt, POSTPONED dan lepas arena; tidak menentukan hasil |
| release COMPLETED | Lepas arena, tidak mengubah hasil/FINISHED |
| reopen COMPLETED masih di arena | Atomik lepas arena dengan expectedArenaVersion lalu CORRECTION_PENDING; bila sudah lepas, tidak mengubah arena lain |

Select/postpone/release memeriksa matchVersion dan arenaVersion. Resume memilih state lama apa adanya; perubahan fase setelah itu harus command tersendiri yang audited. Tidak ada reset implicit saat select-resume. Rekonsiliasi recovery selesai sebelum resume/start. Uji AC-29.

## Transisi Fase, Attempt Pertama dan Timer

| Dari →ke | Guard dan efek |
|---|---|
| PRE_MATCH→CALLING | Durasi disetujui; buat/start instance CALLING atomik |
| CALLING→VERIFICATION | Timer CALLING nonrunning; simpan laporan masing-masing tim |
| VERIFICATION→WARMUP | PRESENT/READY kedua tim; buat/start instance WARMUP |
| WARMUP→READY pertama | hasStarted=false, warmup nonrunning; fase READY tanpa attempt; tombol utama “Siapkan segmen pertama” |
| WARMUP→READY setelah override | hasStarted=true, timer bantu nonrunning; attempt ACTIVE lama dan timer kompetisi beku tetap, status PAUSED; arm/resume kompetisi, bukan persiapan attempt pertama |
| READY tanpa attempt: segment.prepare | Operator memilih kind sesuai kategori, ordinal awal positif menurut juri, config durasi disetujui; buat attempt PREPARED dan timer COMPETITION IDLE atomik; fase tetap READY |
| READY→COMPETITION | Attempt PREPARED, timer IDLE/STOPPED/PAUSED dengan sisa >0, kesiapan valid, arena tepat, HEALTHY, readinessToken sah; attempt→ACTIVE, timer→RUNNING (engine start untuk IDLE/STOPPED, resume untuk PAUSED), hasStarted=true, status IN_PROGRESS, token dikonsumsi atomik |
| COMPETITION→INTERMISSION | Timer nonrunning; attempt ACTIVE→ENDED; fase INTERMISSION; timer jeda baru IDLE bila dipakai, tidak auto-start |
| INTERMISSION: segment.prepare | Timer jeda nonrunning, attempt lama ENDED; buat ordinal berikut manual dan attempt PREPARED/timer COMPETITION IDLE; fase→READY atomik |
| COMPETITION/INTERMISSION→RESULT | Timer nonrunning, keputusan juri ada; ACTIVE→ENDED jika perlu; jangan membuat attempt palsu |
| PRE_MATCH/CALLING/VERIFICATION/WARMUP/READY→RESULT khusus | Juri memutuskan tanpa bermain; reason+authorityReference wajib, semua timer dibekukan, attempt PREPARED bila ada ditutup ENDED tanpa start; hasil tidak dihitung otomatis |
| RESULT→FINISHED | Draft/review cocok versi, dasar juri lengkap, timer nonrunning dan bukan recovery; hasil FINAL, status COMPLETED; tidak ada winner otomatis |

READY dapat sebentar tanpa attempt hanya pada awal atau setelah pembatalan persiapan tercatat; tidak boleh start sampai segment.prepare selesai. Nomor ordinal dan jumlah segmen bukan aturan yang ditetapkan pengembang. Intermission timer opsional; jika belum disepakati, tidak dipaksa berjalan agar alur dapat berlanjut.

## Matriks Kombinasi yang Valid (M-01)

| Status / fase | Attempt kompetisi | Timer yang boleh berjalan / aksi |
|---|---|---|
| SCHEDULED / PRE_MATCH | Tidak ada yang ACTIVE | Tidak ada; hanya pilih/data master yang berizin |
| PREPARING / PRE_MATCH atau VERIFICATION | Belum ada/PREPARED | Tidak ada; laporan dan persiapan |
| PAUSED / PRE_MATCH atau VERIFICATION setelah override | ACTIVE dipertahankan atau ENDED sesuai snapshot | Semua timer kompetisi beku; inspeksi ulang, bukan start baru |
| PREPARING / CALLING atau WARMUP | Belum ada/PREPARED | Hanya timer jenis fase; jika RUNNING sisa dihitung, jika recovery reconcile dahulu; hasStarted tetap false |
| PAUSED atau IN_PROGRESS / CALLING atau WARMUP setelah override | ACTIVE kompetisi dipertahankan atau ENDED | Timer kompetisi beku; hanya timer bantu fase boleh RUNNING. Mulai timer bantu→IN_PROGRESS, pause/stop→PAUSED; hasStarted tetap true |
| PREPARING atau PAUSED atau IN_PROGRESS / READY | Tidak ada (awal) atau PREPARED | Timer kompetisi IDLE/PAUSED/STOPPED/EXPIRED, tidak berjalan; start hanya jika sisa >0; prepare/arm/start sesuai guard |
| PAUSED / READY setelah kembali fase | ACTIVE lama | Timer kompetisi beku; hanya resume ke COMPETITION dengan arm, bukan segment.prepare baru |
| IN_PROGRESS / COMPETITION | ACTIVE | COMPETITION RUNNING atau EXPIRED; start/resume memulihkan IN_PROGRESS |
| PAUSED / COMPETITION | ACTIVE | PAUSED/STOPPED/IDLE setelah reset/EXPIRED/RECOVERY_REQUIRED; start/resume butuh readiness; recovery wajib reconcile dahulu |
| IN_PROGRESS atau PAUSED / INTERMISSION | ENDED | Hanya INTERMISSION dapat RUNNING; saat PAUSED, tidak ada timer RUNNING |
| IN_PROGRESS atau PAUSED atau PREPARING / RESULT | ENDED atau tidak ada | Semua timer nonrunning, bukan recovery; gol terlambat/koreksi mengikuti SC API dan keputusan juri |
| POSTPONED / resumePhase | Tidak ada/PREPARED/ACTIVE/ENDED sesuai snapshot | Tidak ada RUNNING; hanya select-resume atau operasi maintenance berizin |
| COMPLETED atau CORRECTION_PENDING / FINISHED | ENDED atau tidak ada | Semua nonrunning; tanpa kendali timer/gol live |
| CANCELLED / PRE_MATCH | Tidak ada ACTIVE | Semua nonrunning; tidak dapat dipilih bermain |

Status IN_PROGRESS/READY diperbolehkan untuk segmen berikut setelah pertandingan pernah dimulai; tidak berarti timer berjalan. Timer pause/stop/reset pada kompetisi aktif membuat status PAUSED; sisa 0 tetap EXPIRED. Attempt kompetisi yang ACTIVE tetap ACTIVE selama pause/reset waktu. Guard command lebih sempit dari kombinasi yang valid: tidak semua command legal hanya karena baris state valid. Semua kombinasi lain ditolak, termasuk timer milik fase/attempt lama, warmup berjalan pada READY, goal pada postponed, atau dua timer RUNNING.

## Reset Timer, Restart Segmen dan Aba-aba (M-01/M-05)

Reset Timer = initialMs kembali, state IDLE, fase/attempt/gol tidak berubah; pada kompetisi status PAUSED. Ini koreksi waktu, bukan keputusan mengulang pertandingan. Reason+review dampak wajib dan operator tetap berhak melakukannya. Mulai lagi memerlukan arm dan satu start sadar.

Restart Segmen = reason+authorityReference+impact review; attempt lama→REPLACED, attempt baru dengan ordinal sama/attempt+1 PREPARED, timer baru IDLE, fase READY, status PAUSED jika hasStarted. Gol attempt lama tidak ikut proyeksi sementara setelah konfirmasi, tetapi event asli tetap tersimpan. Reset tidak boleh dipakai untuk diam-diam menggantikan prosedur ini.

Review tim/segmen/durasi dilakukan **sebelum** aba-aba juri. `match.arm-start` membuat StartAuthorization sekali pakai, terikat actor/sesi, matchVersion, arenaVersion, timerGeneration, attempt, target action, dan storage epoch. Tidak mengubah fase/waktu dan tidak menaikkan matchVersion sendiri. Usulan masa berlaku 60 detik diukur monotonic pada runtime yang menerbitkannya. Logout/selection berubah, command bisnis match berubah, storage degraded atau restart menginvalidasi token. Blur membatalkan kesiapan UI segera dan meminta revoke server; request start yang sudah in-flight harus diperiksa melalui ledger, bukan dianggap pasti batal. Hanya digest/review yang cocok boleh arm; kedaluwarsa meminta review ulang sebelum aba-aba.

Selama arming, UI menyiapkan metadata durable dan reservation OP untuk payload start yang terikat readinessToken; status lokal ARMED_RESERVED menunggu tindakan manusia dan tidak mengirim execute. Refresh/blur membatalkan kesiapan dan menyelesaikan reservation lama melalui cancel-or-observe. Saat aba-aba, satu klik/release atau shortcut deliberate tanpa key repeat mengirim start dengan readinessToken; tidak ada dialog tambahan. Klik ulang key sama replay, token sama/key berbeda ditolak. Guard masih diuji server. Resume kompetisi PAUSED/STOPPED/IDLE setelah reset juga review+arm sebelum aba-aba, lalu satu start/resume; restore tidak meng-arm otomatis.

## Override, Recovery dan Larangan

Hak akun operator dipertahankan menurut matriks AUTH [API](API_CONTRACT.md); tidak perlu admin untuk jeda darurat. Perubahan khusus memerlukan reason/authorityReference; [NEEDS CONFIRMATION] D-11 menetapkan pemberi izin lapangan, bukan menghapus role operator. Tidak ada endpoint set-state bebas. Override tidak melewati hasil immutable, constraint identitas, gol nonnegatif, version guard atau storage gate.

Kembali fase: freeze dan arsipkan timer fase yang ditinggalkan, simpan before/after; instance baru IDLE untuk fase bertimer yang dimasuki, tanpa menghapus attempt/gol. Jika kembali sebelum COMPETITION setelah hasStarted, status PAUSED dan semua timer tetap beku sampai tindakan terpisah. Ketika ingin bermain lagi tanpa mengulang segmen, tetap gunakan attempt ACTIVE/timer kompetisi beku yang sama dan kesiapan ulang; gunakan command resume ke COMPETITION yang di-review/arm, bukan membuat PREPARED palsu. Perubahan yang benar-benar mengulang memakai segment.restart.

Startup RUNNING→RECOVERY_REQUIRED, match yang pernah bermain→PAUSED; belum bermain tetap PREPARING, fase/attempt dipertahankan. Storage fault dalam runtime juga mengunci mutasi dan memerlukan rekonsiliasi menurut [timer](TIMER_SPEC.md). Browser refresh hanya membaca snapshot/ledger; tidak start/reset/rearm gol. Waiting darurat hanya mode siaran. Reopen tidak menempati arena, dan hasil resmi lama berlaku sampai revisi disahkan.

## Validasi dan Keputusan Terbuka

AC-02–14 tetap berlaku; AC-28–37 memperinci gol, resume, start, sync, pending, storage, histori dan akses. [NEEDS CONFIRMATION] D-01/02/04–11 untuk durasi, segmen, hasil khusus dan otoritas. Referensi: [SOP](../01-product/SOP.md), [DATA_MODEL](DATA_MODEL.md), [TIMER_SPEC](TIMER_SPEC.md), [remediasi](../03-quality/AUDIT_REMEDIATION.md).
