# ADR-0003 — Kendali Pertandingan Hybrid

## Tujuan, Cakupan, dan Status

Merekam pola kendali R-03–R-08/R-10/R-15/R-18 [PRD](../01-product/PRD.md). **Diterima sebagai keputusan panitia/pengguna:** Hybrid, berdasarkan [SDD asli §5](../SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md) dan penegasan pengguna 16 Oktober 2026. **[PROPOSED]** enum, guard, permission aksi, receipt dan mekanisme dialog adalah desain implementasi, belum tersedia.

## Konteks

SOP memberi urutan yang mudah dilatih, tetapi kondisi lapangan dapat menuntut jeda, ulang segmen, penyesuaian waktu atau penundaan. Operator tidak boleh dipaksa memalsukan hasil demi melewati UI. Sebaliknya, tombol ubah state bebas berisiko merusak sejarah dan hasil resmi.

## Keputusan dan Alasan

Alur normal menunjukkan satu aksi utama menuju fase yang diharapkan. Tindakan penting tetap disengaja; expiry timer tidak memindahkan fase atau menetapkan pemenang. Override berada dalam menu terpisah, membutuhkan izin, alasan dan audit before/after. Guard server tetap menjaga invariant, termasuk dua tim yang benar, satu match aktif, gol nonnegatif dan hasil resmi immutable.

Operator menginput hasil berdasarkan juri, bukan digantikan algoritme. Super-admin membuka revisi resmi dengan dasar keputusan; versi lama tetap tersimpan. Waiting darurat mengamankan siaran saja, bukan menunda pertandingan diam-diam.

## Konsekuensi

Diperlukan state machine eksplisit, validasi role/transisi, dialog dampak, kontrol duplicate request, revision conflict, serta pelatihan panitia. Ulangan segmen menjadi attempt baru sehingga data lama tidak hilang. Membuka hasil tidak menyalakan timer; draft revisi tidak menggantikan hasil resmi sampai disahkan.

D-11 belum menetapkan pemberi izin lapangan. Hak akun operator untuk timer/override tetap berlaku seperti keputusan pengguna; authorityReference merekam izin lapangan secara terpisah. Cabang resmi yang memerlukan daftar otoritas belum disahkan menunggu panitia, bukan otomatis dialihkan ke super-admin. Jeda darurat operator tidak menunggu admin.

## Alternatif yang Dipertimbangkan

Alur kaku menolak kondisi nyata dan mendorong pencatatan di luar sistem. Alur sepenuhnya bebas membuat perilaku sulit ditebak dan sulit diaudit. Otomatisasi pemenang, akhir match saat 00:00, atau kalah saat tidak hadir tidak disetujui dan berisiko bertentangan putusan juri.

## Validasi dan Keputusan Terbuka

Uji AC-03/04/06–10/12/19/21/22 pada [acceptance](../03-quality/ACCEPTANCE_CRITERIA.md). [NEEDS CONFIRMATION] D-04–D-11 untuk aturan segmen/hasil/izin; implementasi tidak boleh menyelesaikannya dengan tebakan. Rincian: [SOP](../01-product/SOP.md), [state machine](../02-engineering/STATE_MACHINE.md), [UI/UX](../02-engineering/UI_UX_GUIDELINES.md).

## Penajaman Setelah H-01/H-02/H-03/M-01/M-02/M-05

**[PROPOSED]** Pilih ulang postponed memulihkan state lama; attempt pertama disiapkan eksplisit dan menjadi ACTIVE atomik saat start. Review/arm dilakukan sebelum aba-aba, satu aksi start sesudahnya. Reset waktu mempertahankan gol/attempt; ulang segmen memakai attempt baru. Gol memakai intent single-use dan rearm terpisah; koreksi sisi atomik agar workflow Hybrid tidak meninggalkan skor setengah dikoreksi. Konsekuensi: tambahan aksi rearm harus dibuktikan mudah dalam UAT, bukan diasumsikan aman/cepat. Alternatif menonaktifkan tombol hanya saat pending ditinggalkan karena respons lokal cepat dapat meloloskan double-click. [API SC/AUTH](../02-engineering/API_CONTRACT.md), [AC-28–30/35](../03-quality/ACCEPTANCE_CRITERIA.md), dan [status remediasi](../03-quality/AUDIT_REMEDIATION.md) menjadi rujukan.
