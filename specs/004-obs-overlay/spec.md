# 004 — Spesifikasi OBS Overlay dan Produksi Offline

## Tujuan, Cakupan, dan Status

Menampilkan keadaan committed pertandingan kepada penonton tanpa membebani operator mengganti teks/scene. Mencakup R-09/12/16 dan Q-01/06/07/10–12 [PRD](../../docs/01-product/PRD.md). Halaman/snapshot/telemetry **[PROPOSED]**, belum ada integrasi OBS. Produksi offline dan gladi akhir dialokasikan di fitur ini agar tidak terlewat di empat paket spesifikasi.

## Definisi dan User Stories

OBS Browser Source adalah halaman baca khusus, bukan dashboard admin. Mode tayangan berbeda dari status match. Preview menggunakan proyeksi serupa, tetapi bukan bukti OBS sebenarnya menerima/render state. Operator ingin memilih mode aman dan melihat status server/OBS; petugas OBS ingin source tunggal mengikuti fase tanpa mengganti scene; IT ingin satu launcher lokal tanpa Vite.

## Kebutuhan dan Aturan

- OB-01 (R-09): proyeksi publik sesuai kategori: LF dua tim+timer, Sumo tambah ronde, Soccer tambah gol+babak. Hasil/pemenang hanya setelah resmi.
- OB-02 (R-09): mode Waiting, Tunggu Tanding, pemanggilan, verifikasi, pemanasan, siap, pertandingan, jeda, selesai dan darurat mengikuti mapping [UI/UX](../../docs/02-engineering/UI_UX_GUIDELINES.md).
- OB-03 (R-09/Q-01/06/12): snapshot penuh saat load/reconnect, revision/runtime guard, safe display sesudah ≥3 detik heartbeat hilang, target sinkronisasi sesuai Q.
- OB-04 (R-14): publik hanya data siaran; tidak ada mutasi/auth operator/audit/alasan privat pada overlay/socket.
- OB-05 (R-12/16): seluruh asset/font lokal, build dilayani satu server produksi, API/socket tidak tertangkap SPA fallback, launcher/readiness/shutdown diuji tanpa internet.
- OB-06 (R-09/18): dashboard preview dan indikator server/preview/OBS dipisah; Waiting darurat tidak menghentikan timer atau mengubah hasil.
- OB-07 (Q-10/11): output transparan/keterbacaan/nama panjang diuji di OBS nyata, soak dan gladi lintas panitia dilakukan sebelum rilis.

## Kasus Tepi dan Penerimaan

Reconnect saat match baru dipilih tidak boleh menampilkan nama baru dengan gol lama. Event terlambat/duplikat tidak memundurkan state. Overlay offline tidak terus menghitung seolah sah; source yang hang disembunyikan petugas. Tanpa koneksi, perintah Waiting server tidak dianggap sudah berhasil. Revisi resmi sedang ditinjau tidak mengganti pemenang lama secara diam-diam.

Bukti [AC-11/13/15/18/20/21/23/26/27](../../docs/03-quality/ACCEPTANCE_CRITERIA.md). Given Browser Source baru dengan cache kosong, When internet dimatikan dan server lokal sehat, Then semua asset dan state tetap tersedia. Given mode darurat dikirim saat timer running, When commit, Then mode publik netral tetapi timer tetap berjalan dan dashboard memperingatkan.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-03/12/14: jumlah arena/keluaran, identitas visual final, hardware/output dan target pengukuran. [Arsitektur](../../docs/02-engineering/ARCHITECTURE.md), [API](../../docs/02-engineering/API_CONTRACT.md), [plan](plan.md), [tasks](tasks.md), [runbook](../../docs/03-quality/RUNBOOK.md).

## Penajaman Kebutuhan Setelah Audit

**[PROPOSED] OB-08 (R-09/Q-01/Q-12):** BC membedakan CONNECTED dan SYNCHRONIZED melalui committed/received/rendered revision dan freshness timer.sync; preview/OBS ack berbeda. O-02/O-04 wajib resync melalui GET snapshot independen ketika outbox berhenti namun heartbeat sehat; deadline 3 detik tidak diperpanjang heartbeat. O-06 mengukur 20 fault tiap jenis pada OBS nyata dan safe display; O-07 melatih ledger UNKNOWN, storage recovery, start tunggal dan REC tanpa replay. O-08 baru boleh rilis setelah 001 T-02/T-04, persetujuan otoritas/target operasional, serta bukti lintas modul; tidak menganggap semua ini sudah diimplementasikan.

Ketertelusuran: H-01/H-02/H-04/H-05/H-06/H-07/M-04/M-05 → AC-28/30/31/32/33/34/36, dengan subkasus sukses/gagal pada [acceptance](../../docs/03-quality/ACCEPTANCE_CRITERIA.md). Definisi normatif tetap di API SC/OP/AUTH/REC, STATE_MACHINE, TIMER_SPEC ST, ARCHITECTURE BC dan RUNBOOK RO; tidak membuat aturan kategori baru. [NEEDS CONFIRMATION] D-11/D-14/15 yang relevan tetap gate pemakaian resmi, bukan alasan menghapus hak operator atau menunda fondasi independen. [Status audit](../../docs/03-quality/AUDIT_REMEDIATION.md).
