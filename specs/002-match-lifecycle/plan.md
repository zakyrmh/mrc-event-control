# 002 — Rencana Teknis Lifecycle

## Tujuan, Cakupan, dan Status

**[PROPOSED]** desain ML-01–ML-08 dari [spec](spec.md). Pisahkan lifecycle domain awal dari integrasi timer agar tidak timbul dependensi melingkar. Definisi resmi ada di [CONTEXT](../../CONTEXT.md); enum teknik mengikuti [STATE_MACHINE](../../docs/02-engineering/STATE_MACHINE.md).

## Dependensi

L-01–L-03 membutuhkan 001 F-01–F-06 dan T-01/T-03. Ketiganya menghasilkan aggregate match/arena, transition guards, serta kontrak segmen/timer yang dapat dipakai 003. L-04 dan seterusnya baru dikerjakan setelah 003 E-08 lulus. Overlay produksi 004 menunggu hasil akhir lifecycle. UI dapat dirancang paralel secara konseptual tetapi tidak dinyatakan operasional sebelum timer/commit tersedia.

## Desain, Data, dan Integrasi

Aggregate match mempunyai matchVersion dan snapshot identitas; ArenaState mempunyai arenaVersion. Guard role/transisi/izin disatukan pada service command, bukan diulang terpisah antara REST/socket/UI. Write melalui unit-of-work 001; command yang memilih/menunda memeriksa versi arena+match dalam transaksi sama.

Tambah MatchParticipant, SegmentAttempt, GoalEvent, ResultRevision dan BroadcastState pada migrasi yang ditinjau. Mesin transisi menerima port timer untuk freeze/start/prepare yang diikat implementasi 003; tes awal guard memakai fake port, bukan mengklaim engine sudah ada. Sesudah E-08, integrasi harus membuktikan fase/timer/audit/receipt/outbox atomic di SQLite nyata.

Gol dijumlah dari event attempt yang berlaku; koreksi event asli sekali, hasil tidak negatif. Finalisasi menghasilkan snapshot hasil immutable, bukan menghitung pemenang dari gol. Reopen membuat draft baru terhubung revisi resmi lama. Kontrol UI mengikuti [UI/UX](../../docs/02-engineering/UI_UX_GUIDELINES.md); compare version dan impact digest menjaga modal stale.

Backup menggunakan mekanisme SQLite konsisten yang diuji bersama Prisma/adapter, file manifest dan checksum. Restore dilakukan launcher maintenance lokal setelah seluruh penulis berhenti, data sekarang diarsip, backup diuji pada salinan dan versi kompatibel. Login/runtime diinvalidasi setelah restore; rekonsiliasi timer mengacu 003. Tidak ada merge DB tanpa prosedur tersendiri.

## Risiko dan Mitigasi

| Risiko | Mitigasi |
|---|---|
| Guard fase berbeda di UI/server | Satu kontrak dan tes matriks edge; server otoritatif |
| Klik cepat/dua operator | GoalIntent sekali pakai + rearm eksplisit, ledger pending durable, match/arena version dan cancel-or-observe; disabled pending hanya feedback tambahan |
| Ulang segmen menghilangkan gol diam-diam | Attempt immutable lama, ringkasan dampak dan alasan |
| Koreksi resmi menulis sejarah | Revisi terpisah; hasil lama berlaku sampai refinalisasi |
| Restore merusak data terbaru | Maintenance, arsip sekarang, checksum/schema, review RPO, catatan juri |
| Aturan belum final | Blok cabang yang bergantung D; jangan memasang enum WO/DQ/jumlah ronde sebagai resmi |

## Strategi Validasi dan Penyelesaian

Unit transisi/role/goal/result, integrasi transaksi/fault, E2E dua tab, UAT salah pilih/gol/reset/hasil, serta gladi backup/restore. Bukti TC-02–04/07–10/12/16–19/21/22/24; pengujian timer/restart di 003 dijalankan ulang pada integrasi lifecycle bila ada risiko baru. Selesai bila ML terpenuhi, hasil/audit konsisten dan runbook cocok dengan rilis.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-03–D-12/15 pada [register](../../docs/01-product/RULEBOOK_NOTES.md). [001 plan](../001-team-management/plan.md), [003 plan](../003-timer-engine/plan.md), [data](../../docs/02-engineering/DATA_MODEL.md), [tasks](tasks.md).

## Integrasi dan Validasi Remediasi

**[PROPOSED]** SC memakai satu GoalIntent lintas sisi/tab; rearm hanya aksi terpisah. goal.reassign atomik, termasuk RESULT sebelum resmi. L-04/L-05 memakai matriks fase/attempt/arena dan select-resume tanpa PRE_MATCH/reset implicit. L-08 memakai review/arm sebelum aba-aba dan OP sesudah refresh. L-09/L-10 menyediakan backup cut, restore tanpa penulis aktif, dan REC historical import: ID unik, dua timestamp, persetujuan juri, preview diff dan all-or-nothing; tidak replay sebagai live. Hasil resmi lama tetap tersimpan. L-11/L-12 memverifikasi semua kontrak, bukan menutup temuan hanya dari UI.

Perubahan model/DTO/migrasi direncanakan, tidak dijalankan oleh dokumentasi. Uji TC-28/29/30/32/34/35/36/37 dengan fault/urutan yang sama seperti [test plan](../../docs/03-quality/TEST_PLAN.md); bukti harus membedakan snapshot committed, observasi volatile, dan hasil belum diketahui. Selesaikan penolakan/duplikasi/rollback sebelum menandai feature selesai. Sinkronisasi persetujuan dan residual risk: [remediasi](../../docs/03-quality/AUDIT_REMEDIATION.md).
