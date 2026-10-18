# 003 — Rencana Teknis Timer

## Tujuan, Cakupan, dan Status

**[PROPOSED]** Rencana TE-01–TE-07 [spec](spec.md). Clock, instance dan command mengikuti satu sumber normatif [TIMER_SPEC](../../docs/02-engineering/TIMER_SPEC.md); rincian formula tidak disalin ulang agar tidak berbeda.

## Dependensi dan Batas Modul

Memerlukan 001 F-01–F-06 untuk runtime/shared/DB/transaction/auth/test dan 002 L-01–L-03 untuk match/segmen/guard/port timer. Tidak menunggu gol/hasil/dashboard 002 selesai. Sesudah E-08, 002 L-04 dapat mengintegrasikan lifecycle penuh. 004 baru menguji rendering timer OBS nyata; tes browser overlay tiruan tidak dianggap bukti final OBS.

Pisahkan pure timer engine (state, sisa, command), injected clock (monotonic+UTC), repository/transaction, checkpoint scheduler, dan public projection. Fake clock hanya pada test; production clock tidak bergantung jam browser. State timer menjadi bagian transaksi match, bukan file storage lain yang sulit dibuat atomik.

## Data dan Aliran

Tambahkan TimerConfig/TimerInstance dan field generation/runtime/checkpoint sesuai [DATA_MODEL](../../docs/02-engineering/DATA_MODEL.md). Start/adjust mengambil sisa berdasarkan monotonic dalam command execution, membandingkan versi, commit state+audit+receipt+outbox. Scheduler serial per match atau optimistic guard menjaga race dengan command; checkpoint tanpa matchVersion memakai generation/sequence. Expiry internal mempunyai key deterministik agar hanya diaudit sekali per generation.

Startup reconciliation berjalan sebelum readiness mutasi: baca record RUNNING, set recovery, audit, naikkan generation dan terbitkan runtime baru. Match yang telah bermain menjadi PAUSED; yang belum bermain tetap PREPARING. Persist runtime baru agar snapshot tidak dianggap lanjutan clock lama. UI recovery memperlihatkan checkpoint dan perkiraan downtime, kemudian meminta nilai yang disepakati.

Default kosong diblok, konfigurasi mempunyai sumber persetujuan; jangan memasukkan angka SDD sebagai default resmi. Simpan label unit dengan jelas. Batas teknis usulan 24 jam harus diuji/dikonfirmasi, bukan disamakan batas lomba.

## Integrasi dan Risiko

REST menggunakan command/API yang sama dengan fase; phase+timer start atomic. Snapshot berisi remaining/state/generation/runtime/revision dan heartbeat. UI/OBS extrapolasi memakai monotonic browser lalu sync; stale ≥3 detik berhenti menghitung dan menampilkan pesan aman. Risiko drift, sleep, write latency, race checkpoint, overflow dan wall jump ditutup dengan injected clocks, guard generation, integer validation, transaksi singkat, resync dan rekonsiliasi.

## Strategi Validasi dan Penyelesaian

Unit fake clock: seluruh state/command/zero/boundary/overflow/wall jump. Integrasi file SQLite: pause vs checkpoint, expiry vs adjust, retry dan kill sebelum/sesudah commit. Recovery test: 20 restart, tidak auto-resume, acknowledged mutation tetap durable. E2E dashboard+overlay test untuk sync; OBS nyata menyusul 004. Ukur Q-05/07/09 dan TC-05/06/07/13/14/22–25/27 sesuai cakupan. Selesai E-08 berarti kontrak timer siap diintegrasikan 002, bukan seluruh sistem siap acara.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-01/02/10/11/14 pada [register](../../docs/01-product/RULEBOOK_NOTES.md). [001 plan](../001-team-management/plan.md), [002 plan](../002-match-lifecycle/plan.md), [tasks](tasks.md), [test plan](../../docs/03-quality/TEST_PLAN.md).

## Integrasi dan Validasi Remediasi

**[PROPOSED]** Engine tunduk pada matriks kombinasi dan activeMatchId; reset hanya waktu, restart attempt melalui lifecycle. Kompetisi start/resume memerlukan StartAuthorization; waktu mulai di server dicatat monotonic terpisah waktu input/render. E-06 mengimplementasikan ST dengan gate volatile saat DB tidak dapat ditulis, probe terukur dan rekonsiliasi tanpa restart; tidak auto-resume setelah sehat. E-07 memakai OP serta timer.sync freshness BC. Recovery timer dari backup RUNNING tidak menuntut proses lama dapat dijeda. E-08 membuktikan kontrak dengan fake lifecycle port dan SQLite nyata; integrasi lengkap berikutnya L-04, OBS nyata O-06.

Perubahan model/DTO/migrasi direncanakan, tidak dijalankan oleh dokumentasi. Uji TC-29/30/31/32/33/36/37 dengan fault/urutan yang sama seperti [test plan](../../docs/03-quality/TEST_PLAN.md); bukti harus membedakan snapshot committed, observasi volatile, dan hasil belum diketahui. Selesaikan penolakan/duplikasi/rollback sebelum menandai feature selesai. Sinkronisasi persetujuan dan residual risk: [remediasi](../../docs/03-quality/AUDIT_REMEDIATION.md).
