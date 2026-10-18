# Model Data dan Integritas

## Tujuan, Cakupan, dan Status

**[PROPOSED]** Model relasional SQLite/Prisma untuk R-01/02/08/11/13–15/17 dan Q-04/05/08/09 [PRD](../01-product/PRD.md). Belum ada schema/migrasi/DB. UUID berarti identitas tidak bergantung urutan nama; version adalah nomor revisi untuk menolak penulisan berdasarkan state lama. Definisi domain ada di [CONTEXT](../../CONTEXT.md).

## Entitas dan Relasi

| Entitas | Field penting dan hubungan |
|---|---|
| EventConfig | id, nama acara, timezone `Asia/Jakarta`, lokasi data, versi schema; bukan tempat kredensial plaintext |
| User / Session | userId, username unik, passwordHash, role SUPER_ADMIN/OPERATOR, enabled; sessionHash, expiresAt, userId. Bootstrap admin satu kali, tanpa password bawaan publik |
| Category | id, code unik, label resmi, enabled; empat kategori awal mengikuti PRD |
| Group / GroupMembership | groupId, categoryId, name unik per kategori; membership teamId/groupId, unik kategori+team; pindah grup melalui aksi tercatat |
| Team | id, categoryId, code unik per kategori, name, institution opsional, archivedAt; nama sama boleh bila kode berbeda |
| Match | id, categoryId, groupId opsional, stageLabel, scheduledAt/sequence, teamAId, teamBId, status, phase, resumePhase, matchVersion, hasStarted, currentSegmentId |
| MatchParticipant | matchId, side A/B, teamId, attendance UNKNOWN/PRESENT/ABSENT, verification PENDING/READY/NOT_READY/FAILED, note; satu record per sisi |
| ArenaState | id `main`, activeMatchId nullable, arenaVersion; satu match tidak aktif di dua arena; channel main pada baseline |
| SegmentAttempt | id, matchId, kind START/ROUND/HALF, ordinal positif, attempt positif, supersedesAttemptId, status PREPARED/ACTIVE/ENDED/REPLACED, reason, actor; ordinal sama/attempt baru untuk ulangan |
| TimerConfig | id, categoryId, phaseType CALLING/WARMUP/COMPETITION/INTERMISSION, stageLabel opsional, initialMs nullable, approvedBy, sourceNote, revision; null berarti belum diputuskan |
| TimerInstance | id, matchId, segmentAttemptId nullable, type, state, initialMs snapshot, remainingAtAnchorMs, anchorWallUtc, checkpointWallUtc, runtimeId, checkpointSeq, timerGeneration; durasi salinan tidak berubah saat default diubah |
| GoalEvent | id, matchId, segmentAttemptId, side, delta +1/-1, correctsGoalId opsional, reason, actorId, commandId; hasil agregasi nonnegatif, bukan klasemen |
| ResultRevision | id, matchId, revision, status DRAFT/FINAL/SUPERSEDED, decisionText, winnerTeamId nullable, finalGoalsA/B nullable, refereeReference, authorizedBy, finalizedBy/At, previousRevisionId, reopenReason; bukti persetujuan juri berupa referensi/catatan |
| AuditEntry | id, commandId, actorId, timestampUtc, matchId opsional, action, beforeJson, afterJson, reason, authorityReference; append-only |
| CommandReceipt | principalId, routeScope, idempotencyKey, payloadHash, responseJson, committedAt; unique principal+scope+key, disimpan sepanjang umur data acara |
| OutboxEvent | eventId, broadcastRevision, matchId, type, payloadPublicJson, committedAt, dispatchedAt nullable; pengiriman minimal sekali |
| BroadcastState | channelId, mode AUTO/WAITING/EMERGENCY, broadcastRevision; proyeksi bukan sumber hasil |
| BackupManifest | backupId, createdAt, schemaVersion, appVersion, sha256, fileSize, lastCommittedCommandAt, lastCheckpointAt, verifyStatus; metadata file di media backup, bukan bukti backup jika DB hilang |

Kategori mempunyai banyak tim/grup/match; match mempunyai dua peserta, banyak percobaan segmen/timer/gol/revisi hasil/audit. ResultRevision resmi terakhir menjadi sumber hasil publik. Gol pertandingan yang sudah selesai tetap disimpan; revisi resmi dapat memperbaiki snapshot final tanpa menghapus buku gol asal.

## Constraint dan Invariant

- Tim A ≠ Tim B; kedua tim dan grup berada dalam kategori match. Validasi relasi silang melalui domain dalam transaksi; foreign key selalu aktif.
- Satu match aktif per arena; seleksi memakai compare-and-swap `arenaVersion` dalam transaksi. Satu timer RUNNING maksimal per match dan satu attempt ACTIVE. Saat fase berganti, timer lama dibekukan/ditutup dan timer fase baru disiapkan secara atomik.
- `remainingAtAnchorMs ≥ 0`; durasi integer milidetik, finite. Batas input teknis usulan 1 ms–24 jam, bukan aturan lomba; UI menerima detik utuh kecuali alat uji.
- Gol tidak boleh negatif. Correcting event mengacu event asli dan tidak boleh dibatalkan dua kali. Gol pada attempt REPLACED tidak ikut skor sementara; ulangan babak Soccer memerlukan konfirmasi dampak gol attempt itu sebelum commit.
- `winnerTeamId` hanya Tim A/B atau null berdasarkan keputusan juri, bukan inferensi otomatis. Gol final hanya untuk Soccer dan nonnegatif; perbedaan dari gol sementara memerlukan alasan, dasar juri, dan review eksplisit. Bentuk hasil khusus menunggu D-09.
- Revisi FINAL immutable. Pembukaan membuat DRAFT baru, menyimpan sebelumnya sebagai resmi yang masih berlaku sampai revisi baru FINAL; baru saat itu versi lama menjadi SUPERSEDED.
- Identitas tim/kategori/segmen pada match yang sudah dimulai dibekukan. Koreksi metadata tim tidak mengganti sejarah: simpan label tim snapshot saat pertandingan dimulai dan di hasil resmi; penggantian label historis perlu koreksi berotorisasi.
- Entity terpakai diarsipkan, bukan hard delete. Ganti Tim A/B hanya match SCHEDULED belum punya riwayat bermain, lewat perubahan jadwal super-admin.

## Batas Transaksi dan Kegagalan

Setiap mutasi bisnis menyimpan state + kenaikan match/arena version yang relevan + AuditEntry + CommandReceipt + OutboxEvent dalam satu transaksi. Request duplicate diperiksa sebelum guard version/transisi; payload berbeda untuk key yang sama ditolak. Rollback membuat semua bagian tak terlihat. Setelah commit baru respons/broadcast. Goal total dan finalisasi harus memakai state yang terkunci/versi yang berhasil dibandingkan.

Checkpoint timer internal memperbarui snapshot dengan guard `timerGeneration` dan `checkpointSeq`, tanpa menaikkan matchVersion agar operator tidak terus mengalami konflik. Pause/adjust menaikkan generation sehingga checkpoint lama tidak bisa menimpa perintah baru. Expiry merupakan mutasi internal audited dengan key deterministik `timerId:generation:expire`. Audit command manusia tidak diisi setiap tick/checkpoint.

SQLite target memakai foreign keys, WAL, transaksi singkat, dan durability `synchronous=FULL` setelah diuji adapter; konfigurasi ini rekomendasi, bukan jaminan terhadap kerusakan media. Busy timeout terbatas; jika lock/write gagal, kembalikan 503/507 tanpa sukses atau perubahan lokal UI. Health check write memakai probe terisolasi yang dihapus, bukan mutasi pertandingan. Batas ruang usulan peringatan <1 GiB atau <10%, blok mulai match baru saat <100 MiB; write yang sedang diperlukan tetap dicoba secara aman, bukan dianggap berhasil. Ambang D-14 harus diuji; log dibatasi agar tidak memenuhi disk.

## Audit, Retensi, dan Backup

Audit sensitif meliputi override, durasi, reset/ulang segmen, gol/koreksi, seleksi salah, hasil/reopen, akun, default config, backup/restore. Rahasia/password/token tidak boleh masuk before/after. Kegagalan izin dicatat di log keamanan terbatas; mutasi gagal tidak mempunyai audit sukses palsu.

Backup konsisten menggunakan SQLite backup API atau penghentian penulis dan mekanisme snapshot yang teruji; jangan menyalin file `.db` aktif tanpa menangani WAL. Backup berisi DB, manifest checksum, versi schema/aplikasi, serta kebutuhan konfigurasi nonrahasia. Salin ke media berbeda dan verifikasi restore. Cadangan baru tidak mengganti cadangan baik terakhir sebelum tervalidasi. Kebijakan usulan: sebelum acara, akhir sesi, dan sebelum perubahan besar; retensi D-15 belum disahkan. Simpan CommandReceipt bersama backup agar retry lama tidak kembali menjadi aksi baru.

## Migrasi dan Pemulihan

Buat migrasi berurutan yang ditinjau; uji fresh DB dan salinan data realistis; cek constraint, audit, jumlah match, dan hasil. Sebelum migrasi produksi: maintenance, tidak ada match aktif/RUNNING, backup valid dan gladi restore. Gagal migrasi: hentikan startup dan laporkan; pulihkan backup dengan versi aplikasi kompatibel, jangan memakai reset/drop atau downgrade schema spekulatif.

Restore hanya super-admin/IT dalam maintenance: arsipkan DB sekarang, verifikasi backup terpisah, hentikan semua penulis, restore atomik, invalidasi sesi/runtime, rekonsiliasi timer. Detail langkah panitia di [RUNBOOK](../03-quality/RUNBOOK.md).

## Validasi dan Keputusan Terbuka

[AC-01/08–10/14/16–19/22/24/25](../03-quality/ACCEPTANCE_CRITERIA.md) memeriksa invariant dan failure injection. [NEEDS CONFIRMATION] D-09/15: bentuk hasil khusus, format impor, retensi audit/backup, sesi. Field final khusus tidak menjadi enum peraturan sebelum konfirmasi. Referensi: [API](API_CONTRACT.md), [timer](TIMER_SPEC.md), [arsitektur](ARCHITECTURE.md).

## Penajaman Model Setelah Audit

**[PROPOSED]** Penambahan ini mempertahankan entitas lama, dengan constraint eksplisit untuk H-01–H-07/M-01–M-04.

| Entitas/field | Constraint dan lifecycle |
|---|---|
| GoalIntent | id, matchId, segmentAttemptId, state READY/CONSUMED/INVALIDATED, previousIntentId, consumedByCommandId; unique satu READY per match dan satu logicalGoal per intent. Server membuat intent pertama hanya saat PREPARED→ACTIVE Soccer, invalidasi READY lama saat ganti/restart attempt; resume/reset waktu tidak membuat intent; rearm hanya aksi eksplisit SC API. Refresh/respons tidak membuat intent baru |
| GoalEvent tambahan | goalIntentId untuk event gol baru, logicalGoalId, correctionGroupId, sourceGoalEventId. Reassign menulis -1/+1 dalam satu transaksi; satu event positif current per lineage. Negative/replacement tidak boleh dihitung sebagai gol baru dari intent |
| OperationLedger | principalId+scope+key unik, payloadHash, targetId, expectedRuntimeId, status RESERVED/SUCCEEDED/REJECTED/CANCELLED, terminalCode, receipt, timestamps. Menggantikan CommandReceipt sebagai ledger lengkap; CommandReceipt menjadi hasil terminal sukses yang terkait satu ledger. Tombstone cancellation juga durable; tanpa reservation execute ditolak |
| StartAuthorization | tokenHash, actor/session, matchId, matchVersion, arenaVersion, timerGeneration, attemptId, storageEpoch, action, expiresAt, consumedAt; single use. Arm tidak menjalankan waktu atau menaikkan matchVersion; command bisnis terkait menginvalidasinya |
| StorageIncident | incidentId, enteredAt, persistedAt, closedAt, affectedTimerIds, lastDurableState, observedFaultState berlabel, reason, actor, recoveryEvidence. Gate fault pertama volatile karena DB dapat tidak bisa ditulis; dipersistenkan saat recovery berhasil |
| EventConfig tambahan | catalogRevision, storageEpoch; revision master berubah atomik untuk invalidasi preview; runtimeId/restore lineage terpisah dari jam monotonic |
| Master resource revisions | Category/Group/Team/User/TimerConfig mempunyai revision positif; responses/PATCH memakai expectedRevision yang sama. Perubahan keanggotaan/identitas/jadwal menaikkan catalogRevision |
| HistoricalImportBatch/Record | batchId, eventId+recordId unik, batchHash, matchId, occurredAt dari catatan, recordedAt server UTC, refereeReference, evidenceRef, actorId, supersedesRecordId opsional, beforeResultRevisionId/afterResultRevisionId; bukan live GoalEvent palsu |
| BackupManifest tambahan | backupCutCommandId/At, eventSessionId/eventSessionClosedAt nullable, verifiedAt, copiedToSecondMediaAt, storageEpoch/restoreLineage. Cut transaksi yang konsisten menentukan cakupan, bukan waktu file download selesai |

Receipt/ledger tidak menyimpan password/token plaintext; reservation hanya hash dan metadata. Actor aplikasi diambil dari sesi, authorityReference menyatakan keputusan lapangan yang berbeda. Backup membawa ledger/tombstone, hasil/audit dan manifest; sesi yang ikut snapshot diinvalidasi saat restore. Historical batch commit atomik mencakup semua hasil/revisi/audit/import records/receipt; konflik atau kegagalan satu baris membuat seluruh batch rollback. Hasil resmi lama hanya direvisi dengan alasan, referensi juri dan expectedPreviousResultRevisionId; recordId yang sudah commit tidak dapat menghasilkan hasil kedua saat diketik ulang.

Attempt PREPARED dibuat oleh segment.prepare pada READY pertama/INTERMISSION, menjadi ACTIVE bersamaan timer start, ENDED saat segmen ditutup, REPLACED saat ulang. Reset timer tidak mengubah attempt/gol. Semua mutasi match mengikuti matriks gabungan [STATE_MACHINE](STATE_MACHINE.md), bukan enum timer saja. Jangan hard delete metadata ledger/tombstone selama data acara masih dapat dioperasikan atau direstore.

Tujuan recovery, session checkpoint dan physical quiescence didefinisikan pada [RUNBOOK](../03-quality/RUNBOOK.md); AC-28–37 memverifikasi model baru. Ini spesifikasi schema, bukan migrasi yang telah dilakukan.

AuthorityRegistry (authorityId, role/personName, allowedSpecialActions, validFrom/Until, approvedMeetingRef, approvedAt, revision) menyimpan daftar keputusan lapangan yang disahkan, bukan hak akses akun. EventSession (eventSessionId, label, matchIds/relasi, responsiblePerson, openedAt, closedAt, closingBackupId) adalah blok kegiatan untuk checkpoint backup; berbeda dari Session autentikasi. Penutupan EventSession baru sah jika closingBackupId terverifikasi memuat seluruh commit sesi; cadangan berkala dapat berlangsung sebelum sesi ditutup. D-11/D-15 tetap memerlukan pengesahan panitia.

SegmentAttempt mempunyai activatedAt nullable: terisi hanya ketika PREPARED→ACTIVE, bukan saat ditutup tanpa bermain. GoalIntent diikat pada segmentAttemptId; RESULT late-goal memakai attempt terakhir dengan activatedAt terisi. Intent lama INVALIDATED dapat menjadi previousIntentId untuk rearm berotorisasi pada RESULT; ini tetap aksi eksplisit, bukan rearm dari respons. Hasil tanpa pertandingan dicatat sebagai ResultRevision, bukan gol/attempt live buatan.
