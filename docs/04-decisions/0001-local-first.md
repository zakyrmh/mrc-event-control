# ADR-0001 — Operasi Lokal Tanpa Layanan Wajib Eksternal

## Tujuan, Cakupan, dan Status

Merekam batas deployment, penyimpanan, dan pemulihan R-11–R-13/R-16 [PRD](../01-product/PRD.md). **Diterima sebagai kebutuhan:** satu komputer lokal, tidak memerlukan internet. Sumber: [SDD asli §1/11 dan A.4](../SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md) serta arahan pengguna 16 Oktober 2026. **[PROPOSED] sebagai desain:** SQLite, satu proses Fastify yang melayani build web/API/socket, binding loopback dan launcher produksi. Tidak menyatakan desain telah diimplementasikan/disetujui panitia.

## Konteks

Kegiatan berlangsung cepat; operator dan OBS harus tetap berfungsi tanpa akses internet. Kehilangan koneksi siaran tidak boleh menghapus state pertandingan. Tim memerlukan deployment yang dapat dinyalakan dan dipulihkan tanpa operator menjalankan beberapa terminal pengembangan.

## Keputusan dan Alasan

Semua state resmi berada pada penyimpanan server lokal; frontend/OBS hanya membaca proyeksi. Semua aset produksi disertakan lokal. Satu server melayani hasil build frontend, REST dan Socket.IO, tanpa Vite development server. SQLite menjadi usulan database satu host; backup tersimpan juga pada media terpisah. Startup timer menunggu rekonsiliasi, tidak meneruskan waktu berdasarkan selang reboot secara otomatis.

Satu origin mengurangi konfigurasi dan beban panitia; transaksi lokal mengurangi titik gagal jaringan. Keputusan ini memenuhi kebutuhan lokal tanpa mewajibkan container, cloud, CDN, SaaS auth atau broker eksternal.

## Konsekuensi

Komputer/disk/proses menjadi titik kegagalan bersama. Diperlukan artifact offline, native module yang diuji pada OS acara, supervisor/launcher, backup konsisten, pemulihan terlatih, dan lembar manual. SQLite bukan backup sendiri; WAL perlu ditangani. Dukungan multi-arena belum disahkan dan tidak otomatis diperoleh hanya karena model menyediakan arenaId.

## Alternatif yang Dipertimbangkan

Cloud hosting ditolak sebagai dependensi wajib karena internet tidak dapat diasumsikan. Frontend dan backend terpisah dalam produksi menambah langkah startup/CORS tanpa kebutuhan yang jelas pada satu komputer. Electron/desktop bundle mungkin memudahkan distribusi tetapi menambah build/runtime dan belum menjadi keputusan. Dev server hanya untuk pengembangan; tidak memenuhi R-16.

## Validasi dan Keputusan Terbuka

Uji AC-13–17/20/25/26 dalam [acceptance](../03-quality/ACCEPTANCE_CRITERIA.md). [NEEDS CONFIRMATION] D-03/12/14/15: arena/channel/hardware/backup. Rincian [arsitektur](../02-engineering/ARCHITECTURE.md) dan [runbook](../03-quality/RUNBOOK.md). Status usulan deployment baru dapat diterima setelah review IT dan gladi, bukan karena ADR ditulis.

## Penajaman Setelah Audit Reliabilitas

**[PROPOSED]** Ledger OP melindungi hasil belum diketahui setelah refresh; StorageHealth ST membekukan klaim live ketika DB gagal meskipun proses hidup; BC memakai revision freshness independen worker outbox. Maintenance restore memastikan penulis berhenti, bukan mensyaratkan semua record backup tidak RUNNING. REC memasukkan hasil manual secara historis tanpa replay live. Alternatif melanjutkan dari clock memori atau heartbeat saja ditolak sebagai dasar data resmi karena tidak membuktikan state durable/rendered. Target RO-01–04 tetap [NEEDS CONFIRMATION] D-14/15; tidak ada janji RPO nol. Uji AC-31–34/36 dan [remediasi](../03-quality/AUDIT_REMEDIATION.md).
