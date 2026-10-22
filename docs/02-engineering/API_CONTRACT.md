# Kontrak REST dan Real-time

## Tujuan, Cakupan, dan Status

Seluruh endpoint, payload, route, dan event di sini **[PROPOSED] dan belum diimplementasikan**. Cakupan: R-01–R-17 dan Q-01/04/06/08 [PRD](../01-product/PRD.md). Prefix `/api/v1`, JSON UTF-8, waktu ISO-8601 UTC, durasi integer ms, ID opaque UUID. ID pendek dalam contoh adalah label ilustrasi; request implementasi harus menggunakan UUID valid. State mengikuti [STATE_MACHINE](STATE_MACHINE.md) dan data mengikuti [DATA_MODEL](DATA_MODEL.md).

## Sesi dan Hak Akses

Login akun lokal menghasilkan cookie sesi HttpOnly, SameSite=Strict, path `/` agar handshake `/socket.io` dapat memvalidasi sesi; Secure wajib bila HTTPS dipakai. Pada baseline loopback HTTP, pengecualian Secure didokumentasikan sebagai keterbatasan lokal. Semua mutasi browser memerlukan pemeriksaan Origin dan token CSRF; login memakai sesi anonim dari bootstrap di bawah, kemudian token dirotasi untuk sesi autentikasi. Password di-hash dengan algoritme yang ditinjau; pustaka hashing/sesi belum dipilih/terpasang. Login dibatasi percobaan; bootstrap admin dilakukan saat persiapan dengan kredensial unik. Tidak ada kebutuhan internet atau provider eksternal.

OPERATOR dapat aksi operasional dan membaca data yang diperlukan; SUPER_ADMIN mewarisi aksi itu serta konfigurasi, akun, hasil resmi, audit dan operasi data. Disabled/expired session →401; role salah →403. Overlay hanya GET proyeksi publik dan socket namespace baca; tanpa mutation handler. Jangan membagikan cookie admin pada Browser Source. Semua input divalidasi ulang di server; tombol tersembunyi bukan kontrol otorisasi.

## Envelope Command, Versi, dan Duplikasi

Semua mutasi bisnis memakai header `Idempotency-Key: <UUID>` dan `X-CSRF-Token`. Body minimal memuat `expectedRuntimeId`; match command memakai `expectedMatchVersion`; seleksi/channel command memakai `expectedArenaVersion`. Operasi yang menyentuh keduanya wajib keduanya. Resource konfigurasi memakai `expectedRevision`. Login/logout dan health probe bukan command bisnis. Startup reconciliation/expiry menggunakan identitas internal deterministik.

```http
POST /api/v1/matches/m-01/commands
Idempotency-Key: 71b9e02e-d28b-4ca5-94d4-1e8978cf7264
X-CSRF-Token: <session-token>
Content-Type: application/json
```

```json
{
  "expectedRuntimeId": "run-01",
  "expectedMatchVersion": 12,
  "action": "timer.pause",
  "timerId": "t-01"
}
```

```json
{
  "commandId": "cmd-01",
  "replayed": false,
  "committedAt": "2026-10-31T02:00:00.000Z",
  "result": {"matchId": "m-01", "matchVersion": 13},
  "snapshotUrl": "/api/v1/matches/m-01"
}
```

Aturan server: validasi sesi/CSRF/role dan akses resource → cari receipt berdasarkan principal+scope+key → jika hash sama kembalikan hasil commit yang sama dengan `replayed:true` → jika hash berbeda 409 KEY_REUSED → untuk command baru periksa runtime, versi, transisi, lalu transaksi. Role dan izin terkini juga berlaku pada pembacaan receipt/replay; sesi yang dicabut tidak boleh membaca receipt hanya karena key diketahui. Deduplikasi dilakukan sebelum guard versi agar retry tidak ditolak karena commitnya sendiri. Dalam dua request bersamaan, unique constraint receipt memastikan satu commit; pemohon lain membaca receipt setelah transaksi selesai. Error validasi yang belum commit tidak menyimpan receipt sukses.

Respons replay berisi hasil command semula, bukan jaminan state saat ini; UI selalu ambil snapshot terbaru dan tidak merender version mundur. Setelah timeout gunakan ledger operasi dan prosedur cancel-or-observe di bagian OP di bawah, lalu snapshot; selama hasil belum diketahui jangan membuat key baru. Receipt bertahan sepanjang data acara. Setelah restore, runtime berbeda menolak command baru dari sesi lama; login/resync dan review manual diperlukan, bukan replay antrean dari masa setelah backup.

## Endpoint Sumber Daya

S=super-admin, O=operator (S juga boleh), P=publik terbatas. List memakai `cursor`/`limit` (usulan default 50, maksimal 200), filter kategori/status. Detail menerima id yang benar atau 404. Semua PATCH memeriksa revision; arsip menggantikan delete data yang sudah dipakai.

| Method / path | Role | Input / keluaran utama |
|---|---|---|
| POST `/auth/login`; POST `/auth/logout`; GET `/auth/me` | akun lokal | username/password; sesi/role/CSRF; logout mencabut sesi |
| GET `/health`; GET `/readiness` | P / O | health tanpa rahasia; readiness rinci schema/write/storage/build/recovery |
| GET `/categories`, `/groups`, `/teams`, `/matches` | O | daftar tersaring; `/matches/{id}` snapshot lengkap operator |
| POST `/categories`; PATCH `/categories/{id}` | S | code/label/enabled; code unik |
| POST `/groups`; PATCH `/groups/{id}` | S | categoryId/name; kategori tidak diganti jika dipakai |
| POST `/teams`; PATCH `/teams/{id}` | S | categoryId/code/name/institution, groupId nullable; arsip via archived=true |
| POST `/team-imports/preview` | S | teks CSV UTF-8 + expectedRevision katalog → jobId, errors per baris, diff, hash; belum mengubah tim |
| POST `/team-imports/{id}/commit` | S | previewHash + expectedRevision; atomic all-or-nothing, tanpa overwrite implisit |
| POST `/matches`; PATCH `/matches/{id}` | S | kategori/grup/tahap/Tim A/Tim B/jadwal; identitas hanya saat SCHEDULED belum bermain. `stage` (`GROUP`/`KNOCKOUT`/`FINAL`) opsional, bawaan `GROUP`. Nomor urut unik per kategori; bentrok menghasilkan 409 |
| GET `/match-schedules/group-preview` | S | `categoryId`, `stage`, `rondeCount` wajib, `groupIds` opsional; menghitung round robin tanpa menulis; melaporkan `exists` per baris |
| POST `/match-schedules/generate` | S | `categoryId`/`stage`/`rondeCount`/`expectedCatalogRevision`/`saveTieConfig`; atomik dan idempoten; melaporkan `created` dan `skipped[]` |
| POST `/match-schedules/reorder` | S | `orderedMatchIds` lengkap kategori; server menomori ulang 1..N dalam satu transaksi; daftar tidak lengkap ditolak 422 |
| POST `/match-schedules/{batchId}/rollback` | S | hapus permanen seluruh match batch; ditolak 409 bila satu match sudah dimainkan atau punya segmen/gol/revisi |
| GET `/match-schedules/batches`; GET `/match-schedules/catalog-revision` | S | riwayat batch per kategori; revisi katalog ringan untuk pengikat reorder |
| GET/PUT `/tie-configs` | S | `rondeCount` per `categoryId`+`stage`; PUT baru tanpa `expectedRevision`, ubah wajib menyertakannya |
| GET/PUT `/timer-configs/{id}` | O / S | phaseType/category/stage/initialMs/sourceNote/approvedBy; default null tak bisa start |
| GET/POST `/users`; PATCH `/users/{id}` | S | akun operator, role/enabled/password reset; password tidak dikembalikan |
| GET `/audit` | S | filter match/actor/waktu/action, pagination; hasil tersaring rahasia |
| GET `/operations/{key}` | pemilik/S | status ledger dan receipt menurut scope; 404 tidak mengizinkan aksi pengganti sebelum cancel-or-observe |
| GET `/broadcast/main` | P | snapshot publik minimal; tanpa akun/alasan/verifikasi rinci |
| POST `/broadcast/main/commands` | O | mode AUTO/WAITING/EMERGENCY, expectedArenaVersion, alasan untuk emergency |
| POST `/backups` | S | request snapshot konsisten →202 job; GET `/backups/{id}` status/manifest; GET `/backups/{id}/download` file setelah verified |
| POST `/restore-checks` | S | file backup + checksum →202 validasi pada salinan; tidak mengganti database aktif |

[PROPOSED] CSV: header `categoryCode,teamCode,teamName,institution,groupName`; kategori/grup harus sudah ada, kode unik per kategori; kosong/duplikat/rujukan asing menyebabkan error baris dan commit seluruh batch ditolak. Batas usulan 5 MiB/5.000 baris. Preview terikat hash isi dan revisi katalog, kedaluwarsa saat katalog berubah. Format dan batas menunggu D-15. Restore aktif sengaja melalui launcher maintenance lokal yang akan dibuat dan diuji; tidak ada endpoint restore yang menimpa DB sambil match berjalan.

Job backup/restore-check memakai status QUEUED/RUNNING/VERIFYING/COMPLETED/FAILED dan error terstruktur. Respons 202 hanya mengakui job tersimpan, bukan backup sudah valid. Receipt retry mengembalikan job yang sama; file baru boleh diunduh sebagai cadangan terverifikasi setelah COMPLETED. Kegagalan ruang/media tidak menghapus cadangan baik sebelumnya.

## Command Match dan Arena

Satu endpoint `POST /matches/{id}/commands` memakai discriminated union `action`. Tabel berikut menambah field pada envelope umum. Pilih/release memakai endpoint arena karena mengubah lock arena, bukan sekadar status UI.

| Endpoint/action | Field khusus / validasi |
|---|---|
| POST `/arenas/main/commands`: `match.select` | matchId, expectedArenaVersion, expectedMatchVersion; tidak ada match aktif belum selesai |
| endpoint arena: `match.release` | matchId, kedua versi, reason; sebelum bermain atau selesai; sesudah mulai gunakan postpone |
| `participant.record` | side A/B, attendance, verification, note; FAILED/ABSENT wajib alasan |
| `phase.advance` | targetPhase; guard eksplisit; READY→COMPETITION wajib readinessToken dari match.arm-start; target RESULT sebelum hasStarted wajib reason+authorityReference hasil khusus |
| `match.arm-start` | reviewDigest, expectedMatchVersion, expectedArenaVersion; review sebelum aba-aba, menghasilkan token sekali pakai tanpa menjalankan timer |
| `match.disarm-start` | readinessToken; revoke CAS atas token milik sesi, tidak mengubah waktu/phase; token yang sudah consumed mengembalikan hasil operasi untuk diperiksa |
| `phase.override` | targetPhase, reason, authorityReference; permission khusus, tidak arbitrary set-state |
| `timer.start/pause/resume/stop/reset` | timerId; reason untuk stop/reset; start/resume kompetisi wajib readinessToken, reset berjalan memakai confirmImpactDigest |
| `timer.adjust` | timerId, deltaMs integer bertanda, reason; hasil tidak negatif |
| `timer.set-duration` | timerId, remainingMs ≥0, reason |
| `timer.reconcile` | timerId, remainingMs, reason, authorityReference; hanya RECOVERY_REQUIRED |
| `segment.prepare` | kind, ordinal, durationConfigId; hanya READY pertama atau INTERMISSION, sesuai matriks STATE_MACHINE; timer lama tidak RUNNING |
| `segment.restart` | segmentAttemptId, reason, authorityReference, confirmImpactDigest; attempt baru, dampak gol eksplisit |
| `goal.add` | goalIntentId, side A/B, delta=1; token READY sekali pakai; guard SC di bawah |
| `goal.correct` | correctsGoalId, delta=-1, reason, authorityReference; pembatalan gol sah secara atomik; salah sisi memakai goal.reassign |
| `goal.prepare-next` | previousGoalIntentId, expectedMatchVersion, targetSegmentAttemptId bila RESULT; menyiapkan satu intent READY melalui aksi terpisah |
| `goal.reassign` | sourceGoalEventId, targetSide, reason, authorityReference; pasangan -1/+1 dalam satu transaksi, satu key dan satu audit koreksi |
| `match.pause/resume` | timerId bila ada, reason untuk gangguan; resume kompetisi wajib readinessToken; setelah override dari READY/VERIFICATION/CALLING/WARMUP, targetPhase=COMPETITION dengan attempt ACTIVE lama, hentikan timer bantu atomik; tanpa attempt ACTIVE gunakan phase.advance atas attempt PREPARED |
| `match.postpone` | reason, authorityReference, expectedArenaVersion; freeze dan release arena |
| `result.draft` | decisionText, winnerTeamId nullable (hanya Tim A/B), finalGoalsA/B nonnegatif hanya Soccer, refereeReference; selisih dari gol sementara memerlukan reason dan review |
| `result.finalize` | draftRevisionId, confirmImpactDigest; timer nonrunning; hasil dan status resmi atomik |
| `result.reopen` | S saja, reason, authorityReference, expectedArenaVersion bila match masih ditunjuk arena; release arena atomik, buat draft revisi tanpa mengaktifkan match |
| `result.refinalize` / `result.cancel-correction` | S saja, draftRevisionId, reason, confirmImpactDigest untuk publish; simpan versi lama |
| `match.cancel` | S saja, reason; hanya SCHEDULED belum bermain |

`phase.advance` yang memulai CALLING/WARMUP/COMPETITION memulai timer secara atomik; timer.start tidak dipakai untuk melewati fase/menyiapkan segmen diam-diam. Reset/restart/finalisasi memakai ringkasan yang dihitung dari snapshot: `confirmImpactDigest` adalah hash kanonis server atas target+version+dampak, dikirim snapshot/review endpoint `POST /matches/{id}/review` (read-only). Jika state berubah, digest/versi ditolak dan dialog perlu dibuka ulang. Review tidak mengubah state.

Contoh gol: `{ "expectedRuntimeId":"run-01", "expectedMatchVersion":20, "action":"goal.add", "goalIntentId":"intent-contoh", "side":"A", "delta":1 }`. Contoh adjust menambah `timerId`, `deltaMs:10000`, dan `reason:"Penyesuaian sesuai aba-aba juri"`; angka ini contoh input, bukan durasi resmi. Command role/phase tidak sah tetap ditolak walaupun UI mengirim digest.

## Error dan Retry

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Data berubah di perangkat lain. Muat ulang keadaan terbaru sebelum melanjutkan.",
    "requestId": "req-01",
    "currentMatchVersion": 14,
    "retryable": false
  }
}
```

| HTTP | Code / tindakan klien |
|---|---|
| 400/422 | INVALID_INPUT / DURATION_UNCONFIRMED; 400 untuk JSON rusak, 422 untuk field/domain input; sorot field/guard dan jelaskan perbaikan |
| 401/403 | SESSION_REQUIRED / FORBIDDEN; minta login/izin; jangan ulang otomatis |
| 404 | NOT_FOUND; periksa target terbaru |
| 409 | VERSION_CONFLICT, INVALID_TRANSITION, ARENA_BUSY, RESULT_LOCKED, KEY_REUSED, RUNTIME_CHANGED, REVIEW_STALE; resync dan review; tanpa blind retry |
| 413 | IMPORT_TOO_LARGE; tidak ada data berubah |
| 503/507 | STORAGE_UNAVAILABLE / STORAGE_FULL; batalkan mutasi, tampilkan tindakan recovery dan jangan mengirim aksi pengganti otomatis |
| 500 | INTERNAL_ERROR; requestId untuk IT, hasil mungkin perlu diperiksa lewat receipt/snapshot bila koneksi gagal |

Tidak mengirim stack trace/SQL/password ke pengguna. Retry reservation/read-status memakai key yang sama dan backoff terbatas. UI tidak mengulang execute UNKNOWN secara otomatis; gunakan OP cancel-or-observe. Retry execute yang diuji langsung terhadap API tetap idempotent, bukan alasan UI membuat key baru. Pending command browser tidak disimpan sebagai antrean offline yang dieksekusi tanpa review.

## Socket.IO dan Sinkronisasi

Namespace rencana `/control` dengan sesi operator, pemeriksaan Origin dan CSRF token handshake; `/overlay` hanya baca dan tidak memperoleh privilege mutasi walaupun browser mengirim cookie origin yang sama. Subscribe diotorisasi; logout/disable/expiry mencabut langganan control dan menutup socket terkait, overlay tetap baca publik; overlay hanya channel main. Setiap reconnect menerima `state.snapshot`; tidak bergantung history event lengkap. REST tetap jalur semua command; socket bukan alternatif bypass permission.

| Event server → client | Isi / aturan |
|---|---|
| `state.snapshot` | runtimeId, broadcastRevision, arenaVersion, projection; control juga matchVersion/detail; replace atomik |
| `match.updated` | snapshot committed, eventId; proyeksi publik tersaring; dikirim dari outbox |
| `broadcast.updated` | mode dan snapshot baru; matchId null membersihkan identitas lama |
| `timer.sync` | timerId, timerGeneration, syncSeq, state, remainingMs, serverNowUtc; per 1 detik saat aktif |
| `connection.heartbeat` | runtimeId, serverNowUtc, committedBroadcastRevision, storageHealth; langsung dari state committed otoritatif, tidak bergantung worker outbox; bukan bukti OBS render |
| `system.degraded` | kode storage/recovery, pesan netral publik; detail hanya control |

Client overlay → server `overlay.rendered`: channel, runtimeId, revision, timerGeneration, syncSeq, renderedAt, clientInstanceId, clientRole; hanya telemetry, tidak memutasi match. Status dashboard membedakan server tersambung, preview tersambung, serta OBS terakhir mengakui revision (bisa tidak diketahui). p95 commit-ke-render diukur dengan telemetry pada komputer sama atau rekaman berstempel; clock browser dikalibrasi, bukan asal mengurangkan timestamp berlainan.

Runtime yang dipercaya hanya ditetapkan oleh handshake/snapshot penuh dari server saat ini. Event dengan runtimeId berbeda memicu resync, tidak langsung mengganti runtime/cache; worker tidak boleh melabeli payload lama sebagai snapshot runtime baru. Setelah restart, outbox yang tertinggal boleh memicu snapshot terkini alih-alih memutar state lama. Urutan dalam runtime mengandalkan revision; tick juga diperiksa generation dan syncSeq yang meningkat per timer/runtime, agar tick terlambat tidak memundurkan waktu. Jika gap/OBS baru/refresh, ambil snapshot lengkap. Data stale ≥3 detik menghasilkan safe display, target resync ≤3 detik setelah server sehat. Uji di [AC-11/13/18/22/24/27](../03-quality/ACCEPTANCE_CRITERIA.md).

## Keputusan Terbuka

[NEEDS CONFIRMATION] D-09/11/15 untuk hasil khusus, izin override, sesi/retensi dan impor. Desain endpoint/hash/review/telemetry ini [PROPOSED], tidak mengasumsikan library/plugin baru sudah terpasang. Referensi operasi: [RUNBOOK](../03-quality/RUNBOOK.md).

## Kontrak Remediasi SC — Gol, Koreksi dan Gesture (H-01/H-02)

**[PROPOSED]** SC-01–SC-05 adalah kontrak engineering untuk R-07/R-15/R-18; bukan aturan kapan gol sah. Juri tetap menentukan gol.

- **SC-01:** Hanya transisi PREPARED→ACTIVE attempt Soccer yang membuat satu GoalIntent READY, dibagikan semua tab. Timer resume/start setelah reset pada attempt ACTIVE tidak membuat intent baru. Saat segment.prepare berikut/restart/finalisasi, intent READY attempt lama diinvalidasi dalam transaksi yang sama; saat RESULT, intent yang masih berlaku boleh dipakai sesuai SC-03. `goal.add` mengonsumsi intent, menulis GoalEvent + audit + receipt + outbox, menaikkan matchVersion dalam satu transaksi. Unique constraint membatasi satu gol per intent. Retry key sama mengembalikan receipt; key berbeda dengan intent terpakai dan expected version terkini →409 GOAL_INTENT_CONSUMED tanpa gol baru. Sisi berbeda pada token sama juga ditolak.
- **SC-02:** Setelah konsumsi, tombol +1 tetap tidak siap meskipun respons sudah diterima. Hanya tombol terpisah “Siapkan gol berikutnya” yang meminta `goal.prepare-next`; tidak ada rearm berbasis timeout, respons, refresh, keydown repeat, atau dblclick. Rearm memerlukan previousGoalIntentId yang telah CONSUMED/INVALIDATED dan version terkini; maksimal satu READY per match. Jika READY sudah ada, rearm duplikat tidak membuat token lain. Saat pending/UNKNOWN, rearm diblok. Dua gol disengaja = input pertama, rearm eksplisit, input kedua; kedua tim memakai intent yang sama sehingga perpindahan sisi tidak melewati latch.
- **SC-03:** Gol baru boleh dicatat pada match aktif COMPETITION dengan attempt ACTIVE dan timer RUNNING/PAUSED/STOPPED/EXPIRED, bukan recovery. Saat RESULT, input gol terlambat menurut juri memakai attempt terakhir yang benar-benar pernah ACTIVE (activatedAt terisi), ACTIVE/ENDED, timer beku, alasan dan authorityReference wajib. `goal.prepare-next` mengikuti guard yang sama, mengikat GoalIntent pada targetSegmentAttemptId yang pernah dimainkan; tidak boleh membuat gol pada attempt yang hanya PREPARED lalu ditutup. Jika belum pernah bermain, hanya pencatatan hasil khusus menurut juri, bukan gol live. Ini memberi jalur pencatatan keputusan juri, bukan otomatis mengesahkan gol sesudah waktu habis.
- **SC-04:** `goal.reassign` merujuk event positif terbaru dalam lineage gol yang belum dibatalkan, targetSide berbeda, match/attempt benar dan tidak REPLACED. Dalam satu transaksi tulis event negatif sisi lama dan positif sisi baru dengan correctionGroupId/logicalGoalId sama, audit before/after, receipt, outbox dan versi baru. Tidak mengonsumsi GoalIntent baru. Tidak ada snapshot antara -1 dan +1. Sukses mempertahankan total gol kedua tim. Koreksi ulang menargetkan event positif terbaru; pointer lama →409 GOAL_REVISION_CONFLICT.
- **SC-05:** Pembatalan/reassign dapat menargetkan attempt ACTIVE/ENDED yang masih berlaku pada match aktif sebelum finalisasi, termasuk fase RESULT. Tidak boleh mengubah hasil COMPLETED/CORRECTION_PENDING, attempt REPLACED, atau match yang tidak aktif; gunakan koreksi hasil resmi atau rekonsiliasi historis yang terpisah. Kesalahan field →422; konflik key/versi/intent →409, tanpa replay otomatis sebagai gol baru.

## Kontrak Remediasi OP — Ledger Pending dan Refresh (H-05)

**[PROPOSED]** OP-01–OP-06 berlaku pada mutasi kritis gol/koreksi, fase/seleksi, timer, finalisasi/revisi, dan impor historis. Ledger tidak dipakai untuk login atau bootstrap.

1. **OP-01:** Sebelum request execute, UI menyimpan metadata operasi secara durable pada browser: key, principalId, scope/route, targetId, payloadHash, expectedRuntimeId, dan localStatus. Gunakan penyimpanan lokal transaksional yang diuji; jika penyimpanan metadata gagal, blok execute dan beri pesan. Jangan simpan password/session/CSRF atau payload alasan sensitif di browser. Metadata bukan antrean replay offline.
2. **OP-02:** UI mengirim `PUT /operations/{key}?scope=...` untuk RESERVED, dengan hash payload kanonis, target dan runtime yang akan dieksekusi. Server menyimpan reservation unik principal+scope+key sebelum execute diterima. Duplicate reservation hash sama mengembalikan record sama; beda hash →409. Reservation adalah metadata kontrol, tidak mengubah match. Status: RESERVED, SUCCEEDED, REJECTED, CANCELLED. Payload kanonis memakai JSON dengan urutan key deterministik, representasi integer normal dan string Unicode sesuai input tervalidasi; mencakup method/path/action, target, expected versions/runtime dan semua field command; tidak mencakup token/header autentikasi atau field transport.
3. **OP-03:** Endpoint command biasa menjadi execute atas reservation itu. Check receipt terminal sebelum version guard; validasi role/CSRF tetap dilakukan. Transaksi membandingkan RESERVED dan hash, memvalidasi runtime/versi, lalu menyimpan state+audit+outbox+receipt dan status SUCCEEDED bersama. Penolakan definitif domain/versi menjadi REJECTED dengan kode dalam transaksi ledger terpisah tanpa perubahan bisnis. Storage failure tidak boleh memberi status terminal palsu. Jika proses mati saat transaksi, RESERVED tetap dapat diperiksa/cancel setelah rollback.
4. **OP-04:** Refresh/login ulang memuat metadata milik principal yang sama lalu GET ledger dan snapshot. SUCCEEDED →tampilkan hasil tersimpan; REJECTED/CANCELLED →jelaskan tanpa efek; RESERVED/404/koneksi gagal →UNKNOWN, jangan replay atau membuat key pengganti. Raw 404 bukan bukti request terlambat tidak akan datang.
5. **OP-05:** Untuk mengakhiri UNKNOWN setelah server sehat, pengguna menjalankan `POST /operations/{key}/cancel?scope=...` dengan runtime terkini. Cancel-or-observe diserialisasi dengan execute: jika SUCCEEDED kembalikan receipt; jika RESERVED ubah CANCELLED; jika tidak ada, buat tombstone CANCELLED untuk key tersebut. Delayed reservation/execute terhadap tombstone selalu ditolak. Jika execute sedang transaksi, cancel menunggu hasil lock secara terbatas atau mengembalikan belum diketahui, bukan sukses palsu. Hanya setelah terminal receipt/status diperoleh dan snapshot ditinjau boleh ada operasi pengganti dengan key baru. S dapat memeriksa/cancel operasi akun lain melalui ownerPrincipalId eksplisit yang diotorisasi dan diaudit; operator hanya miliknya sendiri. Target cek pertama ≤3 detik sesudah server sehat; setelah 30 detik belum terminal, eskalasi IT/pencatatan manual, bukan menggandakan input.
6. **OP-06:** Semua reservation/tombstone/receipt bertahan sepanjang data acara dan ikut backup. Setelah restart, receipt SUCCEEDED masih dapat dibaca; RESERVED runtime lama tidak dapat dieksekusi ulang. Setelah restore, metadata browser dibekukan, login/resync/review manual diwajibkan; key yang hilang dari backup tidak menjadi izin replay. Status terminal lama tidak boleh dipakai untuk merender version mundur.

Mutasi master nonkritis tetap memakai receipt atomik; aturan retry tidak mengizinkan mengubah key untuk melewati konflik. Ledger sendiri menyimpan status/audit kontrol tanpa menerbitkan perubahan skor palsu.

## Kontrak Akses AUTH — Hak Aplikasi dan Otoritas Lapangan (M-02/M-03)

**[PROPOSED]** mekanisme sesi; hak operator berikut mempertahankan keputusan pengguna/SDD §3/5. O=operator; S=super-admin. Tidak ada pengurangan hak operator karena D-11 belum selesai.

| Aksi | O | S | Dasar lapangan / pengaman tambahan |
|---|---|---|---|
| Pilih/lepas match, catat kehadiran/verifikasi, pindah fase normal | Ya | Ya | Laporan petugas; guard state tetap wajib |
| Start/pause/resume/stop timer, adjust/set/reset | Ya | Ya | Aba-aba juri; perubahan khusus beralasan dan authorityReference |
| Override fase, tunda, ulang start/ronde/babak | Ya | Ya | Alasan dan authorityReference untuk perubahan alur; bukan izin mengabaikan keselamatan |
| Jeda darurat / Waiting darurat | Ya | Ya | Tidak perlu menunggu admin; alasan insiden singkat saat jeda darurat; Waiting tidak menjeda timer |
| Gol/reassign/cancel gol sebelum resmi | Ya | Ya | Keputusan juri; koreksi/RESULT membutuhkan alasan dan referensi |
| Finalisasi awal | Ya | Ya | Keputusan juri, review dan timer beku |
| Data kategori/tim/grup/jadwal/default timer/akun/audit penuh | Tidak | Ya | Revision guard; data terpakai tidak dihapus |
| Reopen/refinalize hasil resmi, backup/restore, impor historis | Tidak | Ya | Persetujuan juri untuk hasil; maintenance dan backup untuk restore |

`authorityReference={authorityId, authorityRole, personName, decisionRef, decidedAt}` mencatat pemberi keputusan lapangan; bukan login, token hak aplikasi, atau pemberian role admin kepada juri. Identitas actor aplikasi diambil server dari sesi. [NEEDS CONFIRMATION] D-11 menentukan nama/jabatan petugas yang sah untuk setiap perubahan khusus. Sebelum daftar disahkan, cabang yang membutuhkan otoritas tersebut tidak boleh dipakai resmi; kemampuan akun operator tetap tersedia untuk implementasi/simulasi. Jeda darurat operator tetap tersedia untuk melindungi keselamatan, dengan audit; melanjutkan memerlukan keputusan lapangan. Super-admin tidak otomatis menjadi pengganti pemberi keputusan juri.

Bootstrap CSRF: `GET /auth/bootstrap` pada origin lokal yang diizinkan membuat cookie sesi anonim HttpOnly/SameSite=Strict, token CSRF terikat sesi dan expiresAt; respons `Cache-Control: no-store`, tanpa kredensial/default password. `POST /auth/login` memeriksa Origin dan token anonim; setelah kredensial sah, rotasi sessionId+CSRF dan invalidasi sesi anonim. `GET /auth/me` mengembalikan token sesi autentikasi kepada origin sendiri. Token salah/expired →403 tanpa login; UI bootstrap ulang secara sadar. Logout memerlukan CSRF, menghapus sesi dan langganan control. Disabled/expired user tidak bisa memakai REST maupun socket lama. CORS tidak membuka kredensial ke origin lain. Hashing password dan rate limit tetap tugas implementasi teruji.

## Kontrak REC — Storage dan Rekonsiliasi Historis (H-06/H-07)

StorageHealth dan maintenance gate mengikuti [TIMER_SPEC](TIMER_SPEC.md); ketika bukan HEALTHY, hanya baca/health, pemeriksaan hasil operasi yang dapat dipercaya, autentikasi yang aman jika storage memungkinkan, serta prosedur IT diperbolehkan. Semua mutasi bisnis baru →503 STORAGE_DEGRADED; kegagalan write tidak dipaksa menjadi REJECTED durable. `system.degraded` dapat dikirim sebagai peringatan volatile; tidak mengaku transaksi tersimpan.

[PROPOSED] `POST /historical-imports/preview` dan `/historical-imports/{batchId}/commit`, S saja dalam maintenance, memakai ledger OP, hash batch dan expected catalog/match revisions. Payload tiap catatan: eventId, recordId UUID dari formulir yang dipertahankan saat diketik ulang, matchId, occurredAt, recordedAt (server), refereeReference/authorityReference, kategori/Tim A/B, decisionText, hasil/gol final jika relevan, evidenceRef, expectedPreviousResultRevisionId nullable. Unique eventId+recordId dan satu target match per batch mencegah duplikasi. Salah isi memakai revisi/supersedesRecordId, bukan recordId baru untuk menyembunyikan duplikat.

Preview menunjukkan catatan yang sudah ada, konflik dengan hasil DB, match yang hilang, serta selisih sesudah titik backup. Commit batch all-or-nothing: identitas/sumber juri sah, target tidak aktif di arena, tidak ada penulis pertandingan, hasil lama yang berbeda dibuka sebagai revisi berotorisasi, hasil baru/audit/receipt/import record tersimpan atomik. Tidak menjalankan fase, attempt atau timer historis sebagai live; record RUNNING lama terlebih dahulu dibekukan/reconcile lalu match dilepas/ditunda lewat maintenance terkontrol. Tidak menyiarkan replay historis. Hasil resmi yang sudah ada tidak ditimpa tanpa expectedPreviousResultRevisionId+alasan; konflik satu baris membatalkan seluruh batch. Keluar maintenance memerlukan review operator/juri dan readiness baru.

Start authorization: arm/disarm adalah metadata kontrol audited, bukan perubahan timer; start/resume tetap memakai ledger OP. Saat arming, sesudah token diterima UI menyimpan metadata dan me-reserve payload start sebelum menampilkan ARMED_RESERVED. Pada aba-aba hanya execute yang dikirim, tanpa reserve/modal tambahan. Blur/expiry menghapus kesiapan lokal, mengirim match.disarm-start dan cancel-or-observe reservation; keberhasilan revoke/cancel dipastikan server. Jika start sudah commit, tampilkan hasilnya dan minta operator menjeda sesuai juri, jangan menyatakan waktu tidak pernah berjalan.

Urutan guard command baru: autentikasi/role dan storage gate →reservation/hash →runtime dan expected versions →guard phase/attempt/intent/review →transaksi dengan pemeriksaan ulang guard yang relevan. Receipt terminal tetap dicari sebelum runtime/version guard setelah akses diotorisasi. Karena itu key berbeda dengan versi basi mendapat VERSION_CONFLICT; uji INTENT_CONSUMED memakai versi terkini agar tidak tersamar konflik versi. Pembacaan receipt sukses boleh saat degraded bila data durable terbaca, tanpa menerima mutasi baru.

[PROPOSED] AuthorityRegistry menyimpan daftar petugas/pemberian kewenangan lapangan: authorityId, role/personName, allowedSpecialActions, validFrom/Until, approvedMeetingRef, approvedAt dan revision. GET `/authorities` dapat dibaca operator; POST/PATCH `/authorities/{id}` hanya S dengan referensi keputusan panitia, bukan pemberian role akun. Aksi khusus adjust/set/reset/override/postpone/restart/finalisasi tanpa bermain memeriksa kecocokan authorityReference dengan daftar yang disahkan. Jika D-11 belum ditutup, data simulasi berlabel boleh untuk tes; pemakaian resmi aksi khusus ditahan dengan AUTHORITY_UNCONFIRMED, hak akun operator tidak dihapus. Jeda darurat tetap tidak memerlukan daftar ini. Rujukan gol/hasil normal tetap keputusan juri; tidak membuat akun aplikasi untuk wasit.
