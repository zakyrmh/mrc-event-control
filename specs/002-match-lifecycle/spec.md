# 002 — Spesifikasi Lifecycle Pertandingan dan Hasil

## Tujuan, Cakupan, dan Status

Membuat operator dapat menjalankan SOP, menangani kondisi khusus, mencatat gol dan menyimpan keputusan juri. Cakupan R-02–R-04/R-06–R-08/R-10/R-13/R-15/R-18 dari [PRD](../../docs/01-product/PRD.md). **[PROPOSED]** desain rinci, implementasi belum tersedia. Backup/recovery termasuk di sini sebagai operasi data lintas fitur, bukan diasumsikan modul terpisah sudah ada.

## Definisi dan User Stories

Status match, fase, segmen, hasil sementara/resmi mengikuti [CONTEXT](../../CONTEXT.md). Operator ingin satu alur utama untuk SOP 13 langkah, sambil dapat menunda/mengoreksi atas izin. Operator Soccer ingin gol cepat dan koreksi beralasan. Super-admin ingin membuka revisi hasil resmi serta memulihkan data dengan riwayat yang tetap utuh. Juri memberi keputusan tanpa wajib login.

## Kebutuhan dan Aturan

- ML-01 (R-02): satu match aktif per arena, pilih/lepas tercatat, blok penggantian match yang sedang berlangsung.
- ML-02 (R-03/10): fase normal dan verifikasi eksplisit per peserta; tidak hadir/gagal verifikasi tidak memicu kalah/menang otomatis.
- ML-03 (R-04/15): override terbatas, alasan/dasar izin/before-after wajib; izin server tidak bisa digantikan dialog.
- ML-04 (R-06): segmen berjenis START/ROUND/HALF; ulang menjadi attempt baru, dampak gol dan timer direview, riwayat lama dipertahankan.
- ML-05 (R-07/18): gol Soccer sementara nonnegatif, tambah sekali per command, koreksi compensating event yang merujuk gol asal; penalti terpisah.
- ML-06 (R-08): finalisasi keputusan juri saat timer beku, hasil resmi immutable; reopen/refinalize oleh super-admin dengan revisi lama tetap tersedia.
- ML-07 (R-13): backup konsisten, validasi checksum/schema, restore maintenance dan pemulihan catatan manual berotorisasi.
- ML-08 (R-18): kontrol identitas/fase/gol/timer jelas, pending/rejected/success dibedakan; aksi high-impact memerlukan review snapshot terkini.

## Kasus Tepi dan Penerimaan

Pause/postpone mempertahankan fase/segmen/sisa; postponed melepas arena, resume tidak otomatis start. Salah pilih sesudah mulai tidak mengubah Tim A/B match lama. Mengulang babak tidak diam-diam membawa/menghapus gol attempt lama. Hasil resmi lama tetap berlaku saat draft koreksi dibuka. Backup tidak tersedia/rusak tidak menjadi alasan menghapus DB aktif.

Bukti: [AC-02–04/07–10/12/16–19/21/22/24](../../docs/03-quality/ACCEPTANCE_CRITERIA.md), masing-masing sisi sukses/gagal. Given hasil resmi, When operator mencoba edit gol/fase, Then ditolak dan diarahkan koreksi super-admin. Given super-admin membuka revisi berdasarkan juri, When refinalize sah, Then versi baru resmi tanpa menghilangkan versi lama.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-03–D-12/15: arena, metode LF, segmen, hasil khusus, izin, siaran dan backup. Jangan mengimplementasikan algoritme pemenang/kelolosan. [State machine](../../docs/02-engineering/STATE_MACHINE.md), [API](../../docs/02-engineering/API_CONTRACT.md), [SOP](../../docs/01-product/SOP.md), [plan](plan.md), [tasks](tasks.md).

## Penajaman Kebutuhan Setelah Audit

**[PROPOSED] ML-09 (R-02/R-07/R-08/R-13/R-18):** SC memakai satu GoalIntent lintas sisi/tab; rearm hanya aksi terpisah. goal.reassign atomik, termasuk RESULT sebelum resmi. L-04/L-05 memakai matriks fase/attempt/arena dan select-resume tanpa PRE_MATCH/reset implicit. L-08 memakai review/arm sebelum aba-aba dan OP sesudah refresh. L-09/L-10 menyediakan backup cut, restore tanpa penulis aktif, dan REC historical import: ID unik, dua timestamp, persetujuan juri, preview diff dan all-or-nothing; tidak replay sebagai live. Hasil resmi lama tetap tersimpan. L-11/L-12 memverifikasi semua kontrak, bukan menutup temuan hanya dari UI.

Ketertelusuran: H-01/H-02/H-03/H-05/H-07/M-01/M-02/M-04/M-05/M-06 → AC-28/29/30/32/34/35/36/37, dengan subkasus sukses/gagal pada [acceptance](../../docs/03-quality/ACCEPTANCE_CRITERIA.md). Definisi normatif tetap di API SC/OP/AUTH/REC, STATE_MACHINE, TIMER_SPEC ST, ARCHITECTURE BC dan RUNBOOK RO; tidak membuat aturan kategori baru. [NEEDS CONFIRMATION] D-11/D-14/15 yang relevan tetap gate pemakaian resmi, bukan alasan menghapus hak operator atau menunda fondasi independen. [Status audit](../../docs/03-quality/AUDIT_REMEDIATION.md).
