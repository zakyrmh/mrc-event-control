# Rencana Pengujian dan Gladi Bersih

## Tujuan, Cakupan, dan Status

Menghasilkan bukti untuk seluruh [AC-01–AC-37](ACCEPTANCE_CRITERIA.md) dan kebutuhan [PRD](../01-product/PRD.md). Cakupan mencakup domain, database, kontrak API, UI, OBS, offline, kegagalan, backup, dan penggunaan panitia. Seluruh test suite masih **rencana [PROPOSED]**: Vitest/Playwright belum dipasang; root/server `test` placeholder gagal, tidak ada threshold coverage yang sudah diberlakukan.

## Lapisan dan Pelaksanaan

| Lapisan | Target / teknik | Kasus TC (nomor = AC) |
|---|---|---|
| Unit (Vitest rencana) | Pure transition guards, role policy, gol kompensasi, timer fake clock, CSV parsing, proyeksi publik | TC-01/03–10/12/18/23 |
| Integrasi | Fastify inject/server uji, SQLite file sementara + adapter produksi, transaksi/audit/receipt/outbox, schema constraints | TC-01/02/04–10/14/16/18–20/22/24 |
| Contract | Zod DTO request/respons, status error, role, urutan revision/generation, snapshot recovery | TC-05/11/13/18/22/27 |
| E2E Playwright rencana | Dua browser/tab, operator/admin, overlay browser, reload, modal, keyboard, koneksi terputus | TC-02/03/07–13/18/21/22/27 |
| OBS nyata | Browser Source OBS versi acara, ukuran output, transparansi, nama panjang, reload/disable source, render ack | TC-11/13/20/23/27 |
| Offline/deployment | Artifact produksi pada laptop acara, jaringan luar dimatikan dan cache bersih; tidak memakai Vite | TC-15/20/26 |
| Reliability | Kill proses, titik commit/response/outbox, disk/busy/write faults, clock jump dan sleep | TC-14/22–25 |
| Usability/UAT | Lima panitia lintas peran; stopwatch/rekaman, tanpa arahan saat tes | TC-03/08/12/17/21 |

TC-xx harus menjalankan **kedua subkasus sukses dan gagal** pada baris AC-xx. Trace penuh R/Q→AC→TC berada di [PRD](../01-product/PRD.md), bukan diulang sebagai daftar requirement baru. Proposal coverage: 100% edge transisi yang diizinkan dan sampel penolakan setiap pasangan ilegal; semua command sensitif mempunyai uji izin/versi/duplikasi/rollback. Persentase line coverage bukan pengganti bukti invariant; threshold numerik global belum diputuskan.

## Dataset dan Lingkungan

Gunakan DB uji terpisah, tidak DB acara. Siapkan empat kategori, grup, nama pendek/panjang/sama dengan kode berbeda, karakter Indonesia, tim arsip, satu tim absen/gagal verifikasi, match tertunda, hasil final, revisi hasil, dan data impor invalid. Durasi simulasi pendek diberi label **bukan aturan resmi**. Segmen bervariasi untuk membuktikan konfigurasi, bukan mengasumsikan jumlah resmi.

Catat OS/CPU/RAM/storage/ruang kosong, Node/pnpm/app/schema/OBS/browser, port, display/zoom, dataset/hash backup, dan status internet. Gunakan file SQLite nyata untuk fault/restart; in-memory DB saja tidak membuktikan durability. Uji native module dan build pada OS laptop acara. Pisahkan waktu monotonic server dan browser dalam pengukuran; gunakan render ack atau rekaman terkalibrasi untuk Q-01/Q-07.

## Failure Injection Wajib

| Injeksi | Titik dan jumlah | Harapan / bukti |
|---|---|---|
| Kill proses | 20 restart total: sebelum transaksi, saat transaksi, setelah commit sebelum respons, sebelum/sesudah outbox dispatch | Mutasi belum commit tak terlihat; acknowledged tetap ada; retry tepat satu; timer recovery menunggu manusia |
| Klik/retry/konkurensi | 100 request key sama; 20 command versi sama; dua tab seleksi/gol/finalisasi | Satu efek, 409 yang jelas, receipt konsisten; tidak ada arena ganda |
| OBS/socket putus | 20 reconnect, telat/duplikat/terbalik event; ganti match saat disconnected | Snapshot terkini ≤3 detik setelah sehat; data basi aman ≥3 detik; nama/skor tidak tercampur |
| Storage | 10 per jenis: ENOSPC, read-only, SQLITE_BUSY, gagal audit, gagal commit | Nol sukses palsu/partial write, UI actionable; outbox fail setelah commit tidak menghapus data |
| Timer | ±1 jam wall jump, sleep/resume, adjust dekat nol, race checkpoint-pause/reset | Monotonic valid, generation guard, expiry satu kali, rekonsiliasi bila kontinuitas hilang |
| Power interruption | VM/volume uji dengan snapshot, bukan cabut daya laptop acara | DB diperiksa, RPO aktual dicatat, tidak auto-resume; jangan mengklaim setara semua kerusakan media |
| Backup | Hilang, checksum salah, schema beda, disk target penuh, restore sambil aktif | DB asli aman; backup baik terakhir tidak hilang; prosedur manual tersedia |
| Input lapangan | Salah tim, gol, ronde, durasi, hasil; absen dan gagal verifikasi | Koreksi berizin/tercatat; tidak otomatis menang; hasil resmi dilindungi |
| Produksi | Port dipakai, build hilang, Node/native tidak cocok, font jaringan tak tersedia | Readiness gagal jelas atau operasi offline utuh; tidak diam-diam memakai dev server |

Gunakan volume sementara kecil/adapter fault hooks/VM untuk fault storage. Jangan menghabiskan disk host atau mematikan komputer produksi sebagai percobaan. Failure hooks tetap untuk lingkungan uji dan tidak mengubah aturan bisnis.

## Gladi Bersih Hari Acara

1. IT menyiapkan artifact rilis offline dan backup bersih; super-admin memverifikasi konfigurasi yang sudah disahkan juri.
2. Operator IT/Elektronika/Mesin dan petugas OBS berlatih 15 menit, lalu menjalankan SOP 13 langkah tanpa bantuan.
3. Simulasikan satu match per kategori, segmen lanjut, gol/koreksi, absen, gagal verifikasi, tunda, salah pilih, override dan reopen resmi.
4. Putuskan internet, refresh OBS/dashboard, restart aplikasi pada timer berjalan, rekonsiliasi, lalu resume sesuai aba-aba.
5. Lakukan backup dan restore pada salinan, kemudian gladi pemulihan maintenance ≤10 menit. Latih lembar manual jika backup hilang.
6. Jalankan soak 4 jam/≥100 match, ukur latensi dan selisih waktu, periksa log/DB/audit setelahnya.
7. Catat hasil dan tanda tangan IT, operator, koordinator, juri perwakilan, dan OBS. Ulangi kasus yang diperbaiki; jangan memberi PASS pada kasus terblokir.

## Entry, Exit, dan Pelaporan

Entry: implementasi modul, runner, artifact produksi dan data simulasi tersedia; keputusan peraturan yang relevan ditutup atau tes dinyatakan simulasi. Exit operasional: semua R dan AC kritis lulus, target Q diukur/disetujui, tidak ada hasil berubah tanpa audit, timer auto-resume, data hilang, akses tidak sah, atau duplicate commit; runbook dan fallback telah dilatih.

Laporan per TC: tanggal, tester, build/schema, lingkungan, ID R/Q/AC/TC, subkasus, langkah, hasil aktual, PASS/FAIL/BLOCKED/NOT RUN, bukti dan issue perbaikan. Saat ini **tidak ada klaim tes aplikasi lulus**. Perubahan dokumentasi divalidasi melalui tautan/struktur/hash, bukan menjalankan tes placeholder.

## Keputusan Terbuka dan Referensi

[NEEDS CONFIRMATION] D-14/15: hardware, kapasitas, ambang Q, jadwal gladi, PIC, retensi. D-01–D-12 memblokir tes aturan resmi yang terkait. Rencana mengikuti [UI/UX](../02-engineering/UI_UX_GUIDELINES.md), [timer](../02-engineering/TIMER_SPEC.md), [API](../02-engineering/API_CONTRACT.md), dan [runbook](RUNBOOK.md).

## Kampanye Remediasi Audit — TC-28–37

**[PROPOSED]** Tambahkan sepuluh kelompok tes dengan subkasus sukses/gagal persis [AC-28–37](ACCEPTANCE_CRITERIA.md). Semua berstatus NOT RUN sampai runner/fitur tersedia. Tes dokumentasi tidak menggantikan eksekusi berikut.

| TC | Lapisan dan bukti wajib |
|---|---|
| TC-28 | Unit latch/lineage, integrasi transaksi reassign, E2E dua tab. 100 per delay 0/20/200 ms, mouse/keyboard, dua gol sengaja lewat rearm; rekaman OBS tidak mempunyai skor antara -1/+1 |
| TC-29 | Matriks status×phase×attempt×timer×arena; seluruh transisi sah dan larangan per guard, first prepare, reset vs restart, semua fase postponed. SQLite before/after dan snapshot membuktikan tidak reset fase |
| TC-30 | E2E token arm single-use/invalidasi; 100 repeat; UAT review sebelum aba-aba, satu start sesudah aba-aba. Catat tiga waktu input, commit dan render, bukan hanya selisih dua timer |
| TC-31 | Putus jalur outbox saja dengan heartbeat independen tetap berjalan, blok GET, render error, hilangkan timer.sync/OBS ack. 20 tiap fault, ukur deadline dari mismatch pertama; verifikasi preview tidak dianggap OBS |
| TC-32 | Crash/refresh pada lima titik lifecycle reservation/execute/ack, 20 tiap titik; storage browser gagal; delayed request sesudah cancel tombstone; restart/restore runtime berbeda. Nol duplicate effect/key pengganti sebelum terminal |
| TC-33 | Server tetap hidup saat 10 tiap jenis write fault; amati gate sebelum command berikut, health recovery probes, generation dan receipt. Setelah probe baik tetap butuh reconcile; tidak boleh auto-resume |
| TC-34 | Batch manual valid, duplikat recordId dengan key berbeda, koreksi resmi, timestamp asal/input berbeda, rollback seluruh batch. Pastikan nol aktivasi arena/timer/OBS live |
| TC-35 | Bootstrap anonymous CSRF→rotation, Origin/token salah, matriks role dan authorityReference; direct REST bypass UI, session expiry/disable/logout pada socket lama, emergency operator tanpa admin |
| TC-36 | Backup cut/media kedua/session closure, backup durable RUNNING, media hilang/stale, restore end-to-end sesuai RO. Catat kejadian sejak declared sampai operator siap, termasuk review juri yang diperlukan |
| TC-37 | Pisahkan idempotency (key sama) dari optimistic concurrency (20 timer.pause valid dengan key berbeda/versi sama). Dua command bertentangan diurut acak, periksa tepat satu commit dan status terminal setiap key |

UAT lama TC-21 diperluas: ukur waktu gol kedua termasuk rearm, koreksi pindah sisi pada RESULT, menunggu/cancel UNKNOWN, startup saat RECOVERY_PENDING dan membaca CONNECTED vs SYNCHRONIZED. Catat bantuan/kesalahan setiap orang; threshold cepat tidak menghapus syarat nol duplicate commit. Semua kontrol darurat harus dapat dicapai walau gol pending. Rilis ditahan bila salah satu invariant High gagal; M-02/M-04 ditandai BLOCKED untuk persetujuan operasional yang belum ada, bukan diklaim PASS.

Untuk review dokumentasi, periksa tidak ada instruksi lama minus-lalu-plus, rearm otomatis, POSTPONED→PRE_MATCH, dialog baru sesudah aba-aba, atau restore yang menuntut menjeda record pada DB rusak. Verifikasi istilah/token/version konsisten di API/model/state/UI/specs. Laporan [remediasi](AUDIT_REMEDIATION.md) menghubungkan temuan, requirement dan oracle.
