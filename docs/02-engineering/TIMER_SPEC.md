# Spesifikasi Timer dan Rekonsiliasi Waktu

## Tujuan, Cakupan, dan Status

**[PROPOSED]** Desain untuk R-05/06/11/17 dan Q-05/07/09 [PRD](../01-product/PRD.md). Mendukung CALLING, WARMUP, COMPETITION, INTERMISSION dengan satu engine; durasi resmi tetap [NEEDS CONFIRMATION] D-01/02/10. Angka pada SDD §6 merupakan ringkasan belum terverifikasi, tidak menjadi seed resmi.

## Representasi dan Clock

Unit internal integer milidetik, display `MM:SS` dengan `ceil(remainingMs / 1000)` dan clamp nol. Simpan initialMs, remainingAtAnchorMs, checkpointWallUtc, runtimeId, generation, dan state. Wall clock UTC dipakai untuk audit dan petunjuk downtime; tampilkan jam lokal Asia/Jakarta. Monotonic clock server (misalnya `process.hrtime.bigint()`) mengukur selang waktu dalam satu runtime dan tidak dapat disambung antarproses.

Saat RUNNING pada runtime yang sama:

```text
remainingMs = max(0, remainingAtAnchorMs - (monoNowMs - monoAnchorMs))
```

`monoAnchorMs` berada di memori runtime. Pada commit start/adjust/pause, persistensikan remaining hasil kalkulasi dan timestamp UTC. Default timer disalin saat instance dibuat; mengubah default tidak mengubah timer aktif. Frontend boleh memperhalus display memakai clock monotonic browser berdasarkan snapshot dan perkiraan perjalanan jaringan, tetapi bukan memutuskan expiry/hasil.

## Perintah dan Semantik

Semua perintah butuh matchVersion, idempotency key, role yang sesuai, dan target timer yang masih berlaku. Pembatasan start/phase ada di [state machine](STATE_MACHINE.md). Alasan wajib untuk stop sebelum waktunya, reset, add/subtract, set, dan reconcile; pause/resume biasa tetap diaudit.

| Command | State asal | Efek |
|---|---|---|
| start | IDLE atau STOPPED dengan sisa >0 | RUNNING dari sisa tersimpan; guard kombinasi STATE_MACHINE; kompetisi memerlukan readinessToken |
| pause | RUNNING | Hitung sisa sekarang; PAUSED bila >0, EXPIRED bila 0; freeze dan persist |
| resume | PAUSED dengan sisa >0 | RUNNING dari sisa; kompetisi memerlukan readinessToken; status mengikuti matriks STATE_MACHINE |
| stop | RUNNING/PAUSED/IDLE | STOPPED dari sisa saat ini; 0 menjadi EXPIRED; start kemudian melanjutkan sisa, reset terpisah |
| reset | Timer fase/attempt sekarang, bukan recovery/hasil resmi | Kembalikan initialMs, IDLE; jika kompetisi status PAUSED, attempt/gol tetap; reason+impact review, start ulang harus arm |
| adjust | IDLE/RUNNING/PAUSED/STOPPED/EXPIRED | Delta bertanda; hasil negatif ditolak, nol menjadi EXPIRED. Saat RUNNING re-anchor; EXPIRED ditambah positif menjadi PAUSED, tidak auto-start |
| set-duration | State sama dengan adjust | Tetapkan sisa absolut baru, initialMs tidak berubah; state nonrunning tetap beku; EXPIRED positif menjadi PAUSED |
| expire (internal) | RUNNING, sisa efektif 0 | EXPIRED, sisa 0; audit satu kali per generation; tidak finalisasi/pindah fase |
| reconcile | RECOVERY_REQUIRED | Sisa pilihan operator ≥0 + alasan; PAUSED bila >0, EXPIRED bila 0; perlu resume terpisah |

Adjust/set pada IDLE/STOPPED/PAUSED mempertahankan state jika positif. Reset dari EXPIRED mengembalikan IDLE. Nilai finite, integer, serta rentang teknis usulan 0–24 jam; initialMs harus >0. Menambah melewati maksimum ditolak, tidak dipotong diam-diam. “Durasi Baru” pada UI berarti sisa absolut; mengubah initial/default dilakukan di konfigurasi super-admin, bukan menafsirkan ulang waktu berlalu.

Menghentikan timer tidak otomatis menutup attempt atau match. Pada expiry, operator menerima tanda visual dan suara opsional lokal; alarm bukan keputusan juri. Dua perintah yang datang cepat tidak bisa menimpa pause/adjust baru dengan state lama.

## Persistensi dan Gangguan

- Commit setiap command secara atomik dengan audit/receipt/outbox; persistensi dahulu, baru respons dan OBS.
- Checkpoint RUNNING target setiap ≤1 detik; simpan sisa hasil monotonic, generation/sequence, dan UTC. Ini target kehilangan informasi waktu, bukan jaminan saat disk/OS bermasalah.
- Flush checkpoint pada shutdown terkontrol; tetap perlakukan restart berikutnya sebagai perlu rekonsiliasi jika record terakhir RUNNING. Shutdown bukan otorisasi melanjutkan pertandingan.
- Gagal checkpoint/write: masuk DEGRADED menurut protokol storage di bawah, bekukan proyeksi yang dipercaya, blok mutasi baru dan beri peringatan. Waktu observasi memori dan checkpoint durable ditampilkan berbeda; tidak ada respons sukses palsu.
- Pergantian wall clock/NTP selama runtime tidak memengaruhi countdown. Sleep/resume OS perlu dideteksi lewat selisih wall/monotonic/heartbeat; jika kontinuitas tak dapat dipercaya, bekukan dan minta rekonsiliasi, jangan menerka pertandingan terus berlangsung.

## Restart dan Power Loss

1. Startup memeriksa schema/integritas penyimpanan sebelum menerima command.
2. Semua timer terakhir RUNNING diubah ke RECOVERY_REQUIRED dalam transaksi audited, generation dinaikkan; `runtimeId` baru. Match yang sudah bermain menjadi PAUSED, fase/attempt tetap.
3. Tampilkan sisa checkpoint, waktu simpan, dan perkiraan downtime dari wall clock dengan label **perkiraan**. Jangan otomatis mengurangkan downtime; wall clock bisa salah.
4. Operator membandingkan catatan arena/juri dan memilih sisa yang sah, mengisi alasan/rujukan keputusan. Reconcile menghasilkan PAUSED/EXPIRED dan OBS tersinkron.
5. Jalankan resume sebagai tindakan terpisah hanya setelah aba-aba. Timer IDLE/PAUSED/STOPPED/EXPIRED tidak berubah menjadi RUNNING akibat startup.

Power loss dapat menghilangkan data yang belum durable atau merusak media. Klaim nol kehilangan untuk process kill hanya berlaku untuk commit yang telah diakui dan dibuktikan pengujian; tidak digeneralisasi menjadi jaminan listrik padam. Catatan manual dan backup tetap diperlukan.

## Sinkronisasi Dashboard dan OBS

Snapshot menyertakan state, remainingMs saat dikirim, serverNowUtc, runtimeId, matchVersion, timerGeneration, syncSeq, dan broadcastRevision. Heartbeat/snapshot target 1 detik; ukur RTT, koreksi display berkala tanpa mengirim mutasi dari browser. Q-07 menguji selisih p95 ≤250 ms pada satu komputer. Snapshot penuh/handshake runtime baru mengganti semua cache; event biasa dengan runtime berbeda memicu fetch snapshot otoritatif, bukan pergantian cache langsung. Revision lama atau syncSeq lama pada generation/runtime sama diabaikan. Putus ≥3 detik atau revision tertinggal gagal resync 3 detik: safe display sesuai protokol BC pada ARCHITECTURE; heartbeat sehat tidak mengizinkan extrapolasi atas state basi.

## Uji dan Keputusan Terbuka

[AC-05/06/13/14/23–25/27](../03-quality/ACCEPTANCE_CRITERIA.md) meliputi clock jump, sleep, zero, retry, checkpoint race, restart, dan disk fault. [NEEDS CONFIRMATION] D-01/02/10/11/14: durasi, otoritas penyesuaian, dan target checkpoint. Referensi: [model data](DATA_MODEL.md), [API](API_CONTRACT.md), [runbook](../03-quality/RUNBOOK.md).

## StorageHealth dan Rekonsiliasi Tanpa Restart — ST (H-06)

**[PROPOSED]** ST-01–ST-05; storage gate terpisah dari status match dan koneksi. Target teknis belum menjadi janji performa.

| Mode | Masuk/keluar dan perilaku |
|---|---|
| HEALTHY | Transaksi/checkpoint berhasil; mutasi normal mengikuti role/versi |
| DEGRADED | Satu checkpoint, audit, commit, probe atau write gagal →gate volatile segera ditutup sebelum command berikut. Naikkan storageEpoch volatile, invalidasi semua readinessToken. Simpan di memori snapshot durable terakhir dan observasi monotonic saat fault, dengan label belum tersimpan. Blok mutasi bisnis, termasuk gol/start/finalisasi/prepare-next; pengamatan ini bukan audit sukses durable. Timer memori tidak dipakai sebagai fakta siaran; system.degraded dan overlay safe display segera saat notifikasi diterima |
| RECOVERY_PENDING | IT meminta pemeriksaan setelah penyebab ditangani: 3 write+read probes berurutan berjarak 1 detik, integritas DB dan ruang bebas di atas batas teknis tervalidasi. Setelah itu transaksi recovery menulis incidentId, before/after, timer RUNNING terakhir→RECOVERY_REQUIRED, generation baru dan storageEpoch durable. Gagal salah satu →DEGRADED; tidak membuka mutasi normal |
| HEALTHY kembali | Semua timer terdampak telah direconcile berdasarkan juri (PAUSED/EXPIRED), ledger UNKNOWN ditangani cancel-or-observe, readiness storage dicek ulang dan IT menutup incident secara audited. Timer tidak auto-start; operator perlu arm/resume terpisah |

**ST-01:** Gate volatile melindungi proses ketika DB sendiri tidak dapat menyimpan status DEGRADED. Dalam fault write, response bisnis tidak mengaku sukses/rollback pasti jika outcome commit belum diketahui; ledger diperiksa setelah storage sehat. Transaksi yang terlanjur commit tetap sah dan ditemukan sebagai SUCCEEDED.

**ST-02:** Saat DEGRADED hanya baca snapshot durable terlabel, health/status, dan autentikasi/read receipt yang aman bila tersedia; DB tidak dapat dibaca →laporkan unavailable, jangan menebak receipt. Emergency pause UI saat storage rusak berarti instruksi jeda lapangan dan observasi volatile, bukan klaim timer telah dijeda persisten. Petugas OBS dapat hide source tanpa backend.

**ST-03:** RECOVERY_PENDING mengizinkan hanya autentikasi, operasi cancel-or-observe, timer.reconcile, pemeriksaan/penutupan incident oleh S/IT, dan tindakan maintenance berotorisasi. Gate ini dapat melayani layar Recovery walaupun readiness mutasi normal false. Target timer reconcile hanya instance terdampak; rujukan waktu: checkpoint durable, observasi fault yang belum terverifikasi, catatan juri. Jangan otomatis mengurangi selang fault/downtime.

**ST-04:** Restart saat DEGRADED tidak menghapus kewajiban: readiness startup memeriksa storage dan seluruh timer durable RUNNING menjadi RECOVERY_REQUIRED. Sesudah restart tidak ada asumsi bahwa waktu observasi volatile masih tersedia. Checkpoint/proses lama tidak boleh menimpa generation recovery.

**ST-05:** Uji 10 fault masing-masing checkpoint/SQLITE_BUSY/ENOSPC/audit/commit. Nol mutasi normal diterima setelah gate ditutup, nol safe-display yang tetap mengklaim timer valid, tidak ada resume otomatis setelah probe lulus. Ukur interval injeksi→gate dan injeksi→notifikasi; target gate sebelum command bisnis berikut, public safe display ≤3 detik bila loop UI masih hidup. Proses/browser hang tetap memerlukan petugas manual. AC-33 menjadi oracle.

## Start dan Recovery Ledger

Sesuai [state machine](STATE_MACHINE.md), reset waktu mempertahankan attempt/gol; restart segmen membuat attempt baru. Review/arm kompetisi dilakukan sebelum aba-aba, kemudian satu aksi start/resume. Seluruh start authorization invalid saat generation, matchVersion, arena, sesi atau storageEpoch berubah. Hilang respons pause/adjust memakai OP [API](API_CONTRACT.md), tidak diselesaikan dengan reset atau klik baru. Snapshot recovery yang mengandung record RUNNING lama tidak berarti proses timer sedang hidup; restore dilakukan setelah penulis berhenti, kemudian reconcile.
