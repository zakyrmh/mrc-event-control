# 004 — Rencana Teknis Overlay dan Rilis Lokal

## Tujuan, Cakupan, dan Status

**[PROPOSED]** desain OB-01–OB-07 pada [spec](spec.md), memakai source committed server. Definisi domain/proyeksi mengikuti [CONTEXT](../../CONTEXT.md) dan [API](../../docs/02-engineering/API_CONTRACT.md); bukan sistem baru yang mengendalikan hasil secara mandiri.

## Dependensi

Memerlukan 001 F-01–F-06/T-01/T-03, 003 E-08 engine/recovery dan 002 L-12 alur/hasil/backup siap. T-02/T-04 bukan penghalang integrasi O-01–O-07, tetapi wajib pada O-08/rilis. UI overlay statis boleh dieksplorasi lebih awal, tetapi koneksi, state dan gate operasional baru sah setelah sumbernya tersedia. Socket.IO client, static plugin, router dan komponen UI yang belum terpasang ditambahkan hanya dalam implementasi, dengan versi yang diuji.

## Desain dan Data

Public projection service mengubah aggregate match/result/timer/broadcast menjadi DTO minimal; tests memastikan tidak ada actor/account/alasan/verifikasi rinci bocor. Outbox membawa event committed, bukan perubahan UI. Snapshot mencakup runtimeId/revision, nama tim snapshot, kategori, fase publik, segmen, gol berlaku/hasil resmi dan timer. Saat matchId null, state lama dibersihkan sebelum render Waiting.

Overlay menggunakan layout target 1920×1080, transparansi dan area aman sesuai UI/UX; semua font/aset dibundel. Heartbeat/render ack menyatakan sumber sebenarnya, bukan preview. Public socket tidak mempunyai command handler; rate limit telemetry agar tidak membebani penyimpanan. Preview bisa memakai renderer/proyeksi bersama namun mempunyai clientInstanceId sendiri.

Renderer menolak revision lama, memakai generation untuk timer, dan berhenti extrapolasi saat data basi. Mode darurat disimpan terpisah; disconnect lokal menampilkan pesan aman meskipun server belum bisa menerima perubahan mode. Reconnect menarik snapshot penuh dan melaporkan ack baru setelah render.

## Produksi dan Integrasi Operasi

Fastify melayani artifact web dan overlay, API dan Socket.IO pada loopback. Konfigurasikan route order supaya `/api` yang salah tetap JSON error, bukan index.html. Buat launcher rilis yang menyertakan runtime/Node yang diuji, path data/log/build, health/readiness, pencegahan instance ganda dan shutdown tertib. Jangan menjadikan pnpm install/dev atau pengunduhan package manager sebagai langkah startup hari-H. Build dan persiapan dependensi dilakukan sebelum acara.

Kartu rilis [RUNBOOK](../../docs/03-quality/RUNBOOK.md) harus diisi dengan script/path/port nyata sesudah dibuat; jangan menganggap URL rencana sudah ada. Migrasi tidak dijalankan otomatis tanpa backup/maintenance/review. Uji versi schema tidak cocok dan kegagalan port/build/native module.

## Risiko dan Validasi

Risiko: perbedaan Chromium OBS/browser biasa, nama panjang, frame hang, lag outbox, source tersembunyi, font jaringan, dev fallback produksi dan disk log penuh. Mitigasi: OBS nyata, telemetry terpisah, safe display, outbox replay+snapshot, aset lokal, log rotation, readiness dan manual hide source.

Uji TC-11/13/15/18/20/21/23/26/27; ukur 100 commit latency, 20 reconnect, 10 menit drift, 4 jam/100 match offline. Gladi lintas panitia membuktikan bukan hanya renderer tetapi juga keputusan juri, koreksi, restart dan restore dapat dioperasikan. Selesai bila seluruh AC lintas modul dibuktikan, runbook final dan keterbatasan diterima koordinator/IT.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-03/12/14/15 pada [register](../../docs/01-product/RULEBOOK_NOTES.md). [ADR lokal](../../docs/04-decisions/0001-local-first.md), [timer](../../docs/02-engineering/TIMER_SPEC.md), [test plan](../../docs/03-quality/TEST_PLAN.md), [tasks](tasks.md).

## Integrasi dan Validasi Remediasi

**[PROPOSED]** BC membedakan CONNECTED dan SYNCHRONIZED melalui committed/received/rendered revision dan freshness timer.sync; preview/OBS ack berbeda. O-02/O-04 wajib resync melalui GET snapshot independen ketika outbox berhenti namun heartbeat sehat; deadline 3 detik tidak diperpanjang heartbeat. O-06 mengukur 20 fault tiap jenis pada OBS nyata dan safe display; O-07 melatih ledger UNKNOWN, storage recovery, start tunggal dan REC tanpa replay. O-08 baru boleh rilis setelah 001 T-02/T-04, persetujuan otoritas/target operasional, serta bukti lintas modul; tidak menganggap semua ini sudah diimplementasikan.

Perubahan model/DTO/migrasi direncanakan, tidak dijalankan oleh dokumentasi. Uji TC-28/30/31/32/33/34/36 dengan fault/urutan yang sama seperti [test plan](../../docs/03-quality/TEST_PLAN.md); bukti harus membedakan snapshot committed, observasi volatile, dan hasil belum diketahui. Selesaikan penolakan/duplikasi/rollback sebelum menandai feature selesai. Sinkronisasi persetujuan dan residual risk: [remediasi](../../docs/03-quality/AUDIT_REMEDIATION.md).
