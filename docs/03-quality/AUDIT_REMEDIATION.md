# Remediasi Audit Dokumentasi MRC X 2026

## Tujuan, Cakupan, dan Dasar

Menutup celah spesifikasi dari audit substantif terakhir dalam percakapan: H-01–H-07, M-01–M-06 dan L-01 (7 High, 6 Medium, 1 Low; 0 Critical). [DOCUMENTATION_AUDIT](DOCUMENTATION_AUDIT.md) tersedia dan telah dibaca, tetapi isinya adalah audit struktural awal; daftar 14 temuan menggunakan laporan final percakapan, bukan diklaim sudah ada dalam berkas itu. Sumber utama [SDD asli](../SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md) dibaca dan dipertahankan. Perubahan hanya Markdown, tanpa dependensi/migrasi/fitur aplikasi.

## Arti Status dan Batas Penutupan

- **Resolved:** celah dokumentasi telah mempunyai kontrak yang konsisten lintas sumber dan oracle sukses/gagal yang dapat diuji; review statis dan walkthrough di bawah tidak menemukan konflik pada alur terkait. Ini tidak berarti kode tersedia, tes aplikasi lulus, atau desain teknis otomatis disetujui.
- **Proposed:** mekanisme telah dispesifikasikan/testable tetapi penerimaan keputusan panitia yang menjadi bagian temuan masih terbuka. Semua desain engineering yang belum diapprove juga tetap berlabel [PROPOSED] di dokumen normatif, termasuk pada baris Resolved.
- **Blocked:** belum ada jalur spesifikasi aman yang dapat dilanjutkan. Tidak ada temuan dalam kategori ini setelah remediasi; gate resmi per keputusan tetap dapat menahan rilis/cabang penggunaan.

Hasil: **12 Resolved, 2 Proposed (M-02/M-04), 0 Blocked**. Dua temuan tersebut masih memerlukan keputusan panitia. D-01–D-15 dari register keputusan tidak dianggap ditutup. Seluruh AC-28–37/TC-28–37 adalah spesifikasi tes **NOT RUN**.

## Matriks Temuan, Requirement, dan Verifikasi

| Finding ID | Original severity | Documents modified | Requirement | Resolution | Verification criteria | Status | Remaining risk |
|---|---|---|---|---|---|---|---|
| H-01 | High | [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/02-engineering/DATA_MODEL.md](../02-engineering/DATA_MODEL.md); [docs/02-engineering/UI_UX_GUIDELINES.md](../02-engineering/UI_UX_GUIDELINES.md); [specs/002-match-lifecycle/spec.md](../../specs/002-match-lifecycle/spec.md) | R-07/R-18 | GoalIntent sekali pakai lintas sisi/tab, konsumsi atomik dan rearm hanya tombol terpisah; tidak tergantung lama pending. | AC-28: 100 pengulangan pada respons 0/20/200 ms; satu gol tanpa rearm, dua gol hanya sesudah rearm. | Resolved | Tambahan aksi rearm harus terbukti mudah dalam UAT; tidak mendeteksi dua input yang memang disengaja tetapi keputusan juri salah. |
| H-02 | High | [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/02-engineering/DATA_MODEL.md](../02-engineering/DATA_MODEL.md); [docs/02-engineering/STATE_MACHINE.md](../02-engineering/STATE_MACHINE.md); [docs/03-quality/RUNBOOK.md](RUNBOOK.md) | R-07/R-15 | goal.reassign memindahkan pemilik gol melalui -1/+1 dalam satu transaksi dan satu correctionGroup; berlaku juga RESULT sebelum resmi. | AC-28: fault antara dua event rollback penuh; retry sesudah commit satu koreksi; total tetap, tidak ada frame antara -1/+1. | Resolved | Validitas keputusan gol tetap juri; koreksi hasil resmi memakai jalur admin. |
| H-03 | High | [docs/02-engineering/STATE_MACHINE.md](../02-engineering/STATE_MACHINE.md); [docs/02-engineering/TIMER_SPEC.md](../02-engineering/TIMER_SPEC.md); [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/01-product/SOP.md](../01-product/SOP.md) | R-02/R-06/R-10 | Select pertama terpisah dari select-resume; resume mempertahankan fase/attempt/gol/sisa dan state timer nonrunning tanpa auto-start. | AC-29: 20 select-resume per fase valid; snapshot bidang pemulihan sama dan tidak ada RUNNING baru. | Resolved | Jumlah arena/segmen dan pilihan juri D-03–D-10 tetap terbuka. |
| H-04 | High | [docs/02-engineering/ARCHITECTURE.md](../02-engineering/ARCHITECTURE.md); [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/02-engineering/UI_UX_GUIDELINES.md](../02-engineering/UI_UX_GUIDELINES.md); [specs/004-obs-overlay/plan.md](../../specs/004-obs-overlay/plan.md) | R-09/Q-12 | BC memisahkan CONNECTED dari SYNCHRONIZED; heartbeat committed revision independen outbox, received/rendered revision dan timer sync wajib diperiksa. | AC-31: 20 tiap fault; mismatch 1 detik meminta snapshot, gagal 3 detik sejak terdeteksi safe display meskipun heartbeat sehat. | Resolved | OBS/OS hang total memerlukan hide source manual; ambang teknis D-14 masih usulan. |
| H-05 | High | [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/02-engineering/DATA_MODEL.md](../02-engineering/DATA_MODEL.md); [docs/02-engineering/UI_UX_GUIDELINES.md](../02-engineering/UI_UX_GUIDELINES.md); [specs/001-team-management/tasks.md](../../specs/001-team-management/tasks.md) | R-11/R-15 | Metadata pending durable sebelum execute, reservation ledger, status terminal, cancel-or-observe dan tombstone melawan delayed request; refresh bukan replay. | AC-32: 20 per titik crash/refresh; nol execute jika metadata gagal, nol efek sesudah tombstone, key baru hanya sesudah terminal dan review. | Resolved | Browser storage rusak/DB unavailable membutuhkan eskalasi dan pencatatan manual; metadata bukan backup hasil. |
| H-06 | High | [docs/02-engineering/TIMER_SPEC.md](../02-engineering/TIMER_SPEC.md); [docs/02-engineering/ARCHITECTURE.md](../02-engineering/ARCHITECTURE.md); [docs/02-engineering/DATA_MODEL.md](../02-engineering/DATA_MODEL.md); [docs/03-quality/RUNBOOK.md](RUNBOOK.md) | R-11/Q-08 | ST DEGRADED→RECOVERY_PENDING→HEALTHY; gate volatile ketika DB tidak bisa ditulis, probe/integritas, audit recovery dan reconcile wajib tanpa restart. | AC-33: 10 tiap write fault; command berikut diblok, readiness lama invalid, probe baik tidak auto-resume; receipt menentukan commit tak pasti. | Resolved | Kegagalan media tidak menjamin semua data terselamatkan; observasi volatile dapat hilang saat daya putus. |
| H-07 | High | [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/02-engineering/DATA_MODEL.md](../02-engineering/DATA_MODEL.md); [docs/03-quality/RUNBOOK.md](RUNBOOK.md); [specs/002-match-lifecycle/plan.md](../../specs/002-match-lifecycle/plan.md) | R-13/R-08/R-15 | REC impor historis terverifikasi: eventId/recordId unik, occurredAt dan recordedAt terpisah, bukti juri, preview diff dan transaksi batch all-or-nothing; tanpa replay live. | AC-34: duplikat ID/key, konflik/fault satu baris, role salah dan hasil resmi lama; satu hasil/ID, nol perubahan parsial/arena/timer live. | Resolved | Bukti lapangan tidak lengkap tetap menahan catatan itu; bentuk bukti/pengesah D-09/11/15 belum disahkan. |
| M-01 | Medium | [docs/02-engineering/STATE_MACHINE.md](../02-engineering/STATE_MACHINE.md); [docs/02-engineering/TIMER_SPEC.md](../02-engineering/TIMER_SPEC.md); [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [specs/003-timer-engine/spec.md](../../specs/003-timer-engine/spec.md) | R-03/R-05/R-06 | Attempt pertama melalui segment.prepare; PREPARED→ACTIVE atomik; matriks status/fase/attempt/timer/arena; reset waktu terpisah dari restart segmen. | AC-29/30: first start, semua guard, reset mempertahankan gol/attempt, restart membuat attempt baru dan validasi state ilegal. | Resolved | State matrix harus dijadikan oracle tes domain, bukan disalin sebagai logika UI terpisah. |
| M-02 | Medium | [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/01-product/RULEBOOK_NOTES.md](../01-product/RULEBOOK_NOTES.md); [docs/01-product/SOP.md](../01-product/SOP.md); [docs/04-decisions/0003-hybrid-match-control.md](../04-decisions/0003-hybrid-match-control.md) | R-04/R-14 | Matriks AUTH mempertahankan hak operator termasuk emergency; authorityReference terpisah dari akun. Pengalihan otomatis ke super-admin dihapus. | AC-35 menguji role/izin terpisah; pemakaian resmi aksi khusus memerlukan daftar pemberi keputusan D-11 yang disahkan. | Proposed | [NEEDS CONFIRMATION] Panitia harus menetapkan petugas sah per aksi. Engineering dapat membangun/test mekanisme; penggunaan resmi terkait belum ditutup. |
| M-03 | Medium | [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/02-engineering/DATA_MODEL.md](../02-engineering/DATA_MODEL.md); [specs/001-team-management/spec.md](../../specs/001-team-management/spec.md); [specs/001-team-management/tasks.md](../../specs/001-team-management/tasks.md) | R-14 | GET auth/bootstrap menghasilkan sesi anonim+token; login memeriksa lalu merotasi sesi/token; logout/disable/expiry mencabut socket control. | AC-35: bootstrap→login, token salah/expired/Origin salah, rotasi, role bypass dan socket lama ditolak. | Resolved | Pustaka hash/sesi dan parameter expiry/rate limit tetap perlu review implementasi; tidak mengklaim sudah aman tanpa tes. |
| M-04 | Medium | [docs/01-product/PRD.md](../01-product/PRD.md); [docs/03-quality/RUNBOOK.md](RUNBOOK.md); [docs/02-engineering/DATA_MODEL.md](../02-engineering/DATA_MODEL.md); [docs/01-product/RULEBOOK_NOTES.md](../01-product/RULEBOOK_NOTES.md) | R-13/Q-09 | RO-01–04 mendefinisikan sesi, cut backup/media kedua, RPO durasi, checkpoint, RTO sejak deklarasi sampai operator siap; restore mensyaratkan penulis berhenti, bukan record RUNNING hilang. | AC-36: catat cut/insiden/ready, stale/media hilang gagal target, backup RUNNING direstore lalu reconcile. Target ≤30 menit RPO dan ≤10 menit RTO harus disetujui/digladikan. | Proposed | [NEEDS CONFIRMATION] D-14/15 untuk ambang, PIC, media dan penerimaan kehilangan data; angka bukan jaminan. |
| M-05 | Medium | [docs/02-engineering/STATE_MACHINE.md](../02-engineering/STATE_MACHINE.md); [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md); [docs/02-engineering/UI_UX_GUIDELINES.md](../02-engineering/UI_UX_GUIDELINES.md); [docs/03-quality/RUNBOOK.md](RUNBOOK.md) | R-05/R-18 | Review/arm dan reservation start sebelum aba-aba; satu execute sadar saat aba-aba tanpa dialog baru. Token single-use terikat state/sesi/storage; blur memakai revoke/cancel, in-flight diamati. | AC-30: 100 repeat satu start, token invalid ditolak, UAT satu tindakan sesudah aba-aba dan ukur input/commit/render terpisah. | Resolved | Jeda manusia dan expiry arm perlu gladi D-14; revoke tidak dapat membatalkan start yang sudah commit. |
| M-06 | Medium | [docs/01-product/PRD.md](../01-product/PRD.md); [docs/03-quality/ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md); [docs/03-quality/TEST_PLAN.md](TEST_PLAN.md); [specs/001-team-management/tasks.md](../../specs/001-team-management/tasks.md) | Q-04/R-15 | Tes key sama/payload sama terpisah dari 20 key berbeda/versi sama; key reuse, intent reuse dan command bertentangan mempunyai hasil eksplisit. | AC-37: 100 retry→satu efek; 20 key berbeda/versi V→satu sukses+19 konflik versi pada command tanpa constraint intent yang mendahului; tidak auto-retry versi baru. | Resolved | Tes harus memakai key berbeda sungguhan; urutan guard intent vs version dibedakan pada oracle. |
| L-01 | Low | [specs/001-team-management/plan.md](../../specs/001-team-management/plan.md); [specs/001-team-management/tasks.md](../../specs/001-team-management/tasks.md); [specs/002-match-lifecycle/plan.md](../../specs/002-match-lifecycle/plan.md); [specs/004-obs-overlay/tasks.md](../../specs/004-obs-overlay/tasks.md) | R-01/R-02 | L-01 bergantung tepat F-01–F-06/T-01/T-03; impor T-02/T-04 gate O-08/rilis, bukan prasyarat fondasi lifecycle/OBS. | Inspeksi diagram/plan/tasks 001–004: T-02 blocked tidak menahan L-01, tetapi O-08 tidak lulus tanpa T-02/T-04. | Resolved | Format impor D-15 harus ditutup sebelum rilis; tidak berarti impor menjadi opsional. |

Kolom dokumen mencantumkan kontrak utama tiap temuan; seluruh specs/plans/tasks, SOP/SDD turunan, PRD, ADR, panduan agen dan glosarium ikut disinkronkan. [Acceptance](ACCEPTANCE_CRITERIA.md) dan [test plan](TEST_PLAN.md) merupakan oracle, bukan hanya keberadaan teks penutupan.

## Walkthrough Konsistensi yang Diperiksa

1. **Gol cepat:** token READY→satu gol+CONSUMED; respons 0 ms tidak rearm; click kedua/key berbeda ditolak. Rearm eksplisit→satu READY baru→gol kedua sah. Koreksi salah sisi pada RESULT memakai reassign atomik, tidak membutuhkan goal.add kedua.
2. **Command terputus:** metadata durable→reservation→execute commit, tetapi ack hilang. Refresh membaca SUCCEEDED, bukan menambah gol. Jika execute belum commit, cancel-or-observe menutup key; delayed request tidak melewati tombstone. State yang masih UNKNOWN tidak boleh diganti dengan key baru. Start yang sudah commit tidak diklaim batal karena blur.
3. **Postponed:** freeze hanya RUNNING; nonrunning IDLE/STOPPED dipertahankan. Select-resume mengembalikan fase/attempt/sisa tanpa PRE_MATCH. Attempt pertama dipersiapkan, start menjadi ACTIVE; timer reset pada ACTIVE tidak menciptakan attempt/intent baru.
4. **Aba-aba:** review/arm+reservation sebelum aba-aba, token terikat versi; satu execute setelah aba-aba. Perubahan versi/storage/session membatalkan kesiapan. Normal field readiness tidak disamakan dengan hak mengganti aturan juri.
5. **OBS tertinggal:** skor/pause committed menaikkan revision; outbox macet, heartbeat tetap mengungkap revision baru. Consumer resync lewat GET independen; render/snapshot gagal mencapai deadline→safe display. Ack preview tidak dianggap ack OBS.
6. **Storage pulih:** fault menutup gate volatile walau DB gagal menulis; probe sukses baru RECOVERY_PENDING. Waktu observasi tidak dianggap durable. Reconcile+penanganan ledger+penutupan incident mendahului HEALTHY; timer masih beku sampai arm/resume.
7. **Restore/historis:** hentikan semua penulis; restore backup boleh berisi record RUNNING, kemudian recovery. Formulir juri dimasukkan berdasarkan ID dan dua timestamp melalui batch audited; duplikat/konflik menolak batch, tidak menjalankan SOP/timer lampau atau menimpa hasil resmi diam-diam.
8. **Akses/dependensi:** operator tetap punya pause/adjust/override dan emergency; authorityReference bukan role admin. Anonymous CSRF menyelesaikan bootstrap login. T-02 tidak memblok L-01/O-01, tetapi tetap wajib untuk O-08.

Walkthrough ini memeriksa kecocokan guard dan efek tertulis; belum mensimulasikan implementasi runtime. Validator struktur/tautan/hash dan hasil final dicatat di bawah.

## Perubahan Dokumen

| Tindakan | Berkas |
|---|---|
| Diperbarui | [AGENTS.md](../../AGENTS.md) |
| Diperbarui | [CONTEXT.md](../../CONTEXT.md) |
| Diperbarui | [README.md](../../README.md) |
| Diperbarui | [docs/01-product/PRD.md](../01-product/PRD.md) |
| Diperbarui | [docs/01-product/RULEBOOK_NOTES.md](../01-product/RULEBOOK_NOTES.md) |
| Diperbarui | [docs/01-product/SDD.md](../01-product/SDD.md) |
| Diperbarui | [docs/01-product/SOP.md](../01-product/SOP.md) |
| Diperbarui | [docs/02-engineering/API_CONTRACT.md](../02-engineering/API_CONTRACT.md) |
| Diperbarui | [docs/02-engineering/ARCHITECTURE.md](../02-engineering/ARCHITECTURE.md) |
| Diperbarui | [docs/02-engineering/DATA_MODEL.md](../02-engineering/DATA_MODEL.md) |
| Diperbarui | [docs/02-engineering/STATE_MACHINE.md](../02-engineering/STATE_MACHINE.md) |
| Diperbarui | [docs/02-engineering/TIMER_SPEC.md](../02-engineering/TIMER_SPEC.md) |
| Diperbarui | [docs/02-engineering/UI_UX_GUIDELINES.md](../02-engineering/UI_UX_GUIDELINES.md) |
| Diperbarui | [docs/03-quality/ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) |
| Dibuat | [docs/03-quality/AUDIT_REMEDIATION.md](AUDIT_REMEDIATION.md) |
| Diperbarui | [docs/03-quality/DOCUMENTATION_AUDIT.md](DOCUMENTATION_AUDIT.md) |
| Diperbarui | [docs/03-quality/RUNBOOK.md](RUNBOOK.md) |
| Diperbarui | [docs/03-quality/TEST_PLAN.md](TEST_PLAN.md) |
| Diperbarui | [docs/04-decisions/0001-local-first.md](../04-decisions/0001-local-first.md) |
| Diperbarui | [docs/04-decisions/0002-tech-stack.md](../04-decisions/0002-tech-stack.md) |
| Diperbarui | [docs/04-decisions/0003-hybrid-match-control.md](../04-decisions/0003-hybrid-match-control.md) |
| Diperbarui | [specs/001-team-management/plan.md](../../specs/001-team-management/plan.md) |
| Diperbarui | [specs/001-team-management/spec.md](../../specs/001-team-management/spec.md) |
| Diperbarui | [specs/001-team-management/tasks.md](../../specs/001-team-management/tasks.md) |
| Diperbarui | [specs/002-match-lifecycle/plan.md](../../specs/002-match-lifecycle/plan.md) |
| Diperbarui | [specs/002-match-lifecycle/spec.md](../../specs/002-match-lifecycle/spec.md) |
| Diperbarui | [specs/002-match-lifecycle/tasks.md](../../specs/002-match-lifecycle/tasks.md) |
| Diperbarui | [specs/003-timer-engine/plan.md](../../specs/003-timer-engine/plan.md) |
| Diperbarui | [specs/003-timer-engine/spec.md](../../specs/003-timer-engine/spec.md) |
| Diperbarui | [specs/003-timer-engine/tasks.md](../../specs/003-timer-engine/tasks.md) |
| Diperbarui | [specs/004-obs-overlay/plan.md](../../specs/004-obs-overlay/plan.md) |
| Diperbarui | [specs/004-obs-overlay/spec.md](../../specs/004-obs-overlay/spec.md) |
| Diperbarui | [specs/004-obs-overlay/tasks.md](../../specs/004-obs-overlay/tasks.md) |

## Validasi Penutup

- Snapshot SHA-256 seluruh berkas proyek non-dependency diambil sebelum edit; seluruh perubahan 33 berkas berupa Markdown (32 diperbarui, 1 laporan baru). Tidak ada penghapusan berkas, perubahan manifest/lock/source/aset, instalasi, atau migrasi.
- SDD sumber sebelum/sesudah identik byte-for-byte menurut SHA-256: `102e0a8006eb86b3630757f5ec73a15cf4d06f0704885a88ea7fb241cf3662b0` (30.476 byte).
- 34 dokumen sumber/hasil diperiksa; 407 tautan Markdown lokal valid; nol berkas kosong, pasangan code fence/JSON contoh rusak, atau baris tabel terpotong. 3 contoh JSON valid. Tidak memasang linter eksternal.
- 14/14 ID temuan unik, 7 High/6 Medium/1 Low; status 12 Resolved/2 Proposed/0 Blocked. Seluruh High dipetakan ke oracle terukur AC-28/29/31/32/33/34.
- 18 R + 12 Q tetap menggunakan ID stabil; seluruh referensi AC pada tabel requirement menunjuk skenario tersedia. AC-01–27 dipertahankan dan diperbarui, 10 kelompok AC/TC-28–37 ditambahkan dengan subkasus sukses/gagal.
- Instruksi lama yang bertentangan dicari ulang (rearm hanya pending, koreksi dua request, postponed reset fase, delegasi hak operator ke admin, dependency impor, RPO tanpa definisi). Tinjauan matriks/efek memeriksa kasus walkthrough di atas; tidak ada konflik tersisa yang ditemukan pada scope 14 temuan.
- `git diff --check` dijalankan; perbandingan hash meliputi dokumen yang masih untracked sehingga tidak mengandalkan Git diff saja. Semua tugas implementasi tetap unchecked.
- Tes aplikasi/build/lint/OBS/UAT belum dijalankan: aplikasi dan runner terkait belum tersedia, dan tugas ini dokumentasi saja. Pemeriksaan ini membuktikan konsistensi spesifikasi, bukan keberhasilan runtime atau kesiapan hari-H.
- Error validator: 0. Hasil statis tidak menggantikan persetujuan D-11/D-14/15, review desain [PROPOSED], atau eksekusi TC setelah implementasi.

## Keputusan Panitia, Risiko Sisa, dan Kesiapan

[NEEDS CONFIRMATION] **M-02 / D-11:** sahkan identitas/jabatan pemberi keputusan lapangan per aksi khusus dan bukti referensinya. Hak operator yang telah disetujui tetap dipertahankan; super-admin tidak otomatis menggantikan juri.

[NEEDS CONFIRMATION] **M-04 / D-14/15:** sahkan target RO (backup/RPO ≤30 menit, RTO end-to-end ≤10 menit, checkpoint sehat ≤1 detik), media kedua, petugas dan hasil gladi. Angka boleh diubah melalui keputusan tercatat, bukan dianggap SLA yang sudah diterima.

D-01–D-10/D-12/D-13/D-15 lain tetap meliputi durasi/metode panggilan, pemanasan/jeda, arena/channel, aturan LF/Sumo/Soccer, hasil khusus/kelolosan, jadwal kesiapan, format impor, kebijakan akun/retensi dan bukti historis. Tidak ada rulebook primer yang baru diperoleh atau aturan kompetisi yang dibuat oleh remediasi.

Risiko sisa: latch/rearm perlu UAT pada panitia nyata; OP menambah protokol reservation/tombstone yang wajib diuji terhadap crash/race; OBS hang total tetap perlu tindakan manual; power/media failure tidak menjamin nol kehilangan; data manual tanpa bukti juri tidak boleh dipaksakan masuk; native/runtime/packaging masih belum diimplementasikan.

**Kesiapan:** dokumentasi konsisten dan cukup untuk memulai fondasi serta implementasi kontrak engineering [PROPOSED] berikut tesnya. Belum siap sebagai panduan rilis resmi tanpa penutupan keputusan yang relevan, implementasi, bukti AC/TC, launcher produksi dan gladi. Urutan pekerjaan: 001 F-01–F-06/T-01/T-03 →002 L-01–L-03 →003 →002 lanjutan →004; T-02/T-04 tetap wajib sebelum O-08. Seluruh checkbox implementasi tetap belum selesai.
