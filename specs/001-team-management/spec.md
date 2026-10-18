# 001 — Spesifikasi Data Tim, Grup, dan Fondasi Akses

## Tujuan, Cakupan, dan Status

Menyediakan data peserta/jadwal yang benar sebelum operator memilih match. Mencakup R-01/02/14 dan fondasi R-15 pada [PRD](../../docs/01-product/PRD.md). Seluruh fitur belum diimplementasikan; detail kontrak **[PROPOSED]**. Fondasi runtime, sesi, database, audit dan idempotency dikerjakan di paket ini agar fitur berikutnya tidak menganggapnya sudah ada.

## Definisi dan User Stories

Tim mempunyai kode unik per kategori, nama tampilan dan institusi opsional; grup adalah penempatan yang ditetapkan panitia, bukan hasil algoritme. Super-admin ingin mendaftarkan/mengimpor tim sesuai grup, memeriksa pratinjau kesalahan, dan menyiapkan pasangan/jadwal manual. Operator ingin membaca daftar yang dapat dipercaya tanpa dapat mengubah data master. Super-admin ingin membuat/menonaktifkan akun operator lokal.

## Kebutuhan Fungsional dan Aturan

- TM-01 (R-01): tambah/ubah/arsip kategori, grup dan tim; validasi keanggotaan kategori, kode unik, nama wajib. Data terpakai diarsipkan dengan riwayat.
- TM-02 (R-01): impor CSV melalui preview berisi diff/error baris dan konfirmasi; commit all-or-nothing, tidak menimpa data lama hanya karena nama sama. Preview bukan penulisan.
- TM-03 (R-02): siapkan jadwal manual dengan kategori, tahap/grup, Tim A/B, waktu/urutan. Tim A ≠ B dan keduanya satu kategori. Penghitungan kelolosan tidak termasuk.
- TM-04 (R-14): bootstrap super-admin terkontrol, akun operator lokal, sesi/CSRF/role server, logout dan penonaktifan. Tidak ada password umum dalam dokumentasi/aset.
- TM-05 (R-15): perubahan master/akun/jadwal diaudit; gunakan receipt/versi untuk mencegah duplikasi dan edit bersamaan.
- TM-06: ketika match sudah dimulai, snapshot identitas historis tidak berubah karena nama tim master dikoreksi. Pembetulan jadwal hanya sebelum match bermain melalui super-admin.

## Kasus Tepi dan Penerimaan

Nama tim sama dengan kode berbeda tetap dapat dibedakan. CSV invalid/duplikat/terlalu besar/preview basi ditolak tanpa sebagian tim masuk. Kategori/grup terarsip tidak dapat menerima jadwal baru. Operator yang memanggil API admin langsung tetap ditolak. Dua tab mengubah kode sama menghasilkan satu perubahan sah atau konflik, bukan overwrite.

Bukti wajib: [AC-01/02/18/19/22](../../docs/03-quality/ACCEPTANCE_CRITERIA.md), masing-masing sukses dan gagal. Given CSV valid dan super-admin, When preview lalu commit, Then semua baris tersimpan sekali. Given satu baris tidak valid atau catalog revision berubah, When commit, Then tidak ada perubahan parsial dan alasan ditampilkan.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-04/08/15: grup/format jadwal resmi, format/batas impor, kebijakan akun/retensi. CSV dan batas sementara mengikuti [API](../../docs/02-engineering/API_CONTRACT.md), bukan format resmi yang telah disahkan. Lihat [plan](plan.md), [tasks](tasks.md), [model data](../../docs/02-engineering/DATA_MODEL.md), [register keputusan](../../docs/01-product/RULEBOOK_NOTES.md).

## Penajaman Kebutuhan Setelah Audit

**[PROPOSED] TM-07 (R-11/R-14/R-15):** Fondasi OP menyediakan reservation, terminal receipt dan tombstone teruji sebelum lifecycle. AUTH menyediakan bootstrap anonim, rotasi sesi/CSRF, permission matrix operator/admin, dan keputusan lapangan sebagai authorityReference terpisah. F-05/F-06 membuktikan TC-32/35/37 di fixture; E2E gol/siaran penuh menyusul 002/004. Master resource/catalog revisions mengikat preview dan transaksi. Impor T-02 menunggu D-15 dan tetap gate rilis, tidak menjadi dependensi L-01.

Ketertelusuran: H-05/M-02/M-03/M-06/L-01 → AC-32/35/37, dengan subkasus sukses/gagal pada [acceptance](../../docs/03-quality/ACCEPTANCE_CRITERIA.md). Definisi normatif tetap di API SC/OP/AUTH/REC, STATE_MACHINE, TIMER_SPEC ST, ARCHITECTURE BC dan RUNBOOK RO; tidak membuat aturan kategori baru. [NEEDS CONFIRMATION] D-11/D-14/15 yang relevan tetap gate pemakaian resmi, bukan alasan menghapus hak operator atau menunda fondasi independen. [Status audit](../../docs/03-quality/AUDIT_REMEDIATION.md).
