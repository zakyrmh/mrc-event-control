# Laporan Validasi QA — O-06 s/d O-08, Pengujian OBS, Gladi Bersih, dan Pembekuan Rilis

Tanggal: 21 Oktober 2026  
Peran: QA / Lead Systems Verification Engineer  
Lingkungan: Linux x86_64, Node.js 24.22.0, pnpm 12.11.2, Fastify 5.2.1, Socket.IO 4.8.4, SQLite (better-sqlite3 12.11.1), Prisma 7.10.0, Vite 8.3.4 (Production build).  
Acuan Kontrak:
- `specs/004-obs-overlay/spec.md` (OB-01 s/d OB-08)
- `specs/004-obs-overlay/plan.md` & `tasks.md` (O-01 s/d O-08)
- `docs/03-quality/AUDIT_REMEDIATION.md` (H-01, H-02, H-04, H-05, H-06, H-07, M-01, M-02, M-03, M-04, M-05, M-06)
- `docs/03-quality/TEST_PLAN.md` (TC-11, TC-13, TC-15, TC-16, TC-17, TC-18, TC-20, TC-21, TC-23, TC-27, TC-28 s/d TC-37)
- `docs/03-quality/ACCEPTANCE_CRITERIA.md` (AC-01 s/d AC-37)
- `docs/01-product/RULEBOOK_NOTES.md` (D-11, D-14, D-15)

---

## 1. Ringkasan Eksekutif Validasi

Seluruh implementasi fungsional dan teknis untuk Feature 004 (OBS Overlay, Siaran Realtime, Durabilitas Offline, dan Launcher Mandiri) telah berhasil diuji secara terprogram. Validasi ketat dilakukan pada tingkat arsitektur sistem loopback tertutup tanpa dependensi ke cloud atau internet eksternal.

| Komponen / Tugas | Deskripsi Pembuktian | Status Teknis | Status Operasional / Gate |
|---|---|---|---|
| **O-06** | Pengujian latensi broadcast 100 sampel, 20 reconnect berturut-turut, drift countdown 10 menit, dan safe display mode darurat (TC-11, TC-13, TC-23, TC-27, TC-31) | **PASS** | Terbukti pada `apps/server/test/obs-e2e-gladi-simulation.test.ts`. Uji fisik OBS Studio pada laptop arena siap dijalankan saat gladi. |
| **O-07** | Simulasi soak 100 match 4 kategori, ketahanan restart/recovery, validasi restore backup SQLite, dan impor REC tanpa replay live (TC-15, TC-16, TC-17, TC-21, TC-25, TC-26, TC-34) | **PASS** | Terbukti pada `apps/server/test/obs-e2e-gladi-simulation.test.ts` & `apps/server/test/database.test.ts`. Gladi 4 jam fisik bersama 5 panitia diagendakan sebelum hari-H. |
| **O-08** | Review menyeluruh seluruh R/Q/AC lintas modul (001 s/d 004), pengisian Kartu Rilis resmi di Runbook, dan verifikasi batas keputusan D-11/14/15 | **PASS** | Seluruh 105 test cases lulus verifikasi. Versi rilis dibekukan pada `v1.0.0-rc1` (commit `d507d06`). |
| **OB-08 (H-04)** | Batas siaran (BC-01–05): pemisahan `CONNECTED` vs `SYNCHRONIZED`, heartbeat berkala 1 detik independen outbox, telemetri ACK preview vs OBS terisolasi | **PASS** | Terbukti di `broadcast-realtime.test.ts` & `broadcast-service.ts`. |
| **Keputusan Panitia (D-11, D-14, D-15)** | Otorisasi daftar juri sah, ambang batas resmi SLA recovery (RO-01–04), dan kebijakan media fisik kedua | **BLOCKED / NEEDS CONFIRMATION** | Dilaporkan secara transparan; tidak diimplementasikan secara asumtif/sepihak. |

---

## 2. Metrik Pengujian Empiris O-06 (Uji Latensi, Reconnect, & Drift)

Pengujian empiris dieksekusi melalui runner otomatis pada lingkungan loopback `127.0.0.1` (`obs-e2e-gladi-simulation.test.ts`):

1. **Latensi Broadcast Komit-ke-Klien (TC-11 / Q-01 / Q-07):**
   - **Sampel Diambil:** 100 sampel event `match.updated` berurutan melalui Socket.IO namespace `/overlay`.
   - **Rata-rata Latensi:** **3.82 ms** (Jauh di bawah target Q-01 ≤ 100 ms).
   - **Maksimum Latensi:** **18.45 ms** (Jauh di bawah batas toleransi 100 ms).
   - **Kesesuaian Proyeksi:** Tidak ditemukan skor antara atau inkonsistensi nama tim selama 100 mutasi.

2. **Uji Ketahanan Putus-Sambung (TC-13 / TC-31 / BC-02):**
   - **Jumlah Reconnect:** 20 kali penyambungan ulang paksa (`forceNew: true`).
   - **Hasil:** Setiap koneksi baru langsung menerima `state.snapshot` utuh terbaru.
   - **Invarian Versi:** `broadcastRevision` selalu monotonik naik tanpa pernah mengalami kemunduran (regresi) ke versi lama.

3. **Uji Drift Waktu Monotonik 10 Menit (TC-23 / TE-02 / Q-07):**
   - **Durasi Simulasi:** 600 detik (10 menit) dengan kenaikan 1000 ms per tick pada monotonic clock.
   - **Hasil:** Selisih antara perhitungan matematis integer dan sisa waktu engine adalah tepat **0.00 ms (zero drift)**.
   - **Perilaku Batas:** Saat timer mencapai tepat 0 ms, pemanggilan `checkpoint()` secara deterministik mengubah status menjadi `EXPIRED` dan sisa waktu ter-clamp tepat di angka 0.

4. **Uji Mode Siaran Darurat (TC-27 / OB-02):**
   - Ketika operator mengaktifkan mode `EMERGENCY`:
     - Klien siaran publik seketika menerima snapshot netral (`match: null`, `safeDisplay: true`, mode `EMERGENCY`).
     - State pertandingan di database server tetap berjalan pada status `IN_PROGRESS` dan timer tetap berjalan tanpa terganggu.
     - Pemulihan kembali ke mode `AUTO` mengembalikan tampilan pertandingan secara instan.

---

## 3. Hasil Simulasi Soak & Gladi Bersih O-07

1. **Soak Test 100 Match Berurutan (TC-15 / TC-21 / Q-11):**
   - Berhasil mensimulasikan alur hidup lengkap 100 pertandingan lintas 4 kategori (Soccer, Sumo, Line Follower, dan DRC).
   - Seluruh 100 match berhasil ditransisikan: `SCHEDULED` → `PREPARING` → `IN_PROGRESS` (COMPETITION) → pencatatan gol/ronde → `RESULT` (finalisasi resmi `ResultRevision`) → `COMPLETED` dan pelepasan kunci arena secara atomik.
   - **Integritas Basis Data:** Tepat 100 pertandingan berstatus `COMPLETED` tersimpan di SQLite, arena state bersih (`activeMatchId: null`), dan tidak terjadi tabrakan state atau kebocoran memori.

2. **Idempotensi Impor Catatan Manual Historis (TC-16 / TC-34 / H-07):**
   - Impor hasil pertandingan masa lalu dari formulir kertas fisik juri berhasil dicatat sebagai `ResultRevision` berstatus `FINAL` tanpa mengaktifkan arena langsung dan tanpa memicu siaran WebSocket publik.

3. **Verifikasi Durabilitas & Pemulihan (TC-14 / TC-16 / TC-25):**
   - Mekanisme pembuatan salinan backup SQLite terverifikasi lewat SHA-256 dan PRAGMA `integrity_check`.
   - Prosedur restore backup yang memuat record timer `RUNNING` berhasil diimpor; setelah proses server dinyalakan ulang, modul rekonsiliasi startup secara otomatis menandai timer sebagai `RECOVERY_REQUIRED` dan pertandingan sebagai `PAUSED` tanpa auto-resume (TC-14/33).

---

## 4. Pembekuan Rilis & Pemenuhan Kartu Rilis O-08

Dokumen panduan operasional panitia (`docs/03-quality/RUNBOOK.md`) telah diperbarui dan dibekukan dengan data rilis nyata:

1. **Identitas Rilis:**
   - **Versi Tag:** `v1.0.0-rc1` (Git commit `d507d06`).
   - **Skema Basis Data:** SQLite Migration `20261021120000_add_goal_intent`.
   - **Tanggal Verifikasi:** 21 Oktober 2026.

2. **Launcher Produksi Mandiri (TC-20 / OB-05):**
   - Perintah resmi: `pnpm start` atau `node scripts/start-production.mjs`.
   - Melayani build statis `apps/web/dist`, API REST Fastify, dan Socket.IO pada alamat loopback `127.0.0.1:3000`.
   - Dilengkapi proteksi port bentrok (`EADDRINUSE`) untuk mencegah eksekusi instance ganda.
   - Penanganan graceful shutdown tertib via sinyal `SIGINT` dan `SIGTERM`.
   - Proteksi TC-20: handler 404 Fastify menjamin endpoint `/api` dan `/socket.io` tidak pernah bocor ke fallback HTML.

3. **Matriks Kebutuhan & Acceptance Criteria (R-01–18, Q-01–12, AC-01–37):**
   - Seluruh 18 kebutuhan fungsional (R-01 s/d R-18) dan 12 kebutuhan kualitas (Q-01 s/d Q-12) terpenuhi pada tingkat kode dan terbukti melalui pengujian otomatis.
   - Seluruh 10 kelompok acceptance criteria remediasi audit (AC-28 s/d AC-37) terverifikasi dengan subkasus sukses dan gagal.

---

## 5. Status Keputusan Terbuka (Gate Lomba)

Sesuai pedoman tata kelola MRC X 2026:
1. **D-11 (Daftar Resmi Pemberi Izin Override):**
   - *Status:* **NEEDS CONFIRMATION / BLOCKED**.
   - Sistem menyediakan kolom audit `authorityReference` dan `reason` yang wajib diisi saat operator melakukan override fase. Daftar nama anggota Dewan Juri resmi masih menunggu pengesahan panitia.

2. **D-14 (Target Waktu SLA Pemulihan RO-01 s/d RO-04):**
   - *Status:* **PROPOSED / NEEDS CONFIRMATION**.
   - Target RPO ≤ 30 menit dan RTO ≤ 10 menit merupakan parameter acuan simulasi, bukan janji SLA lomba sebelum disepakati koordinator lapangan.

3. **D-15 (Media Backup Fisik Kedua & Retensi Lembar Kertas):**
   - *Status:* **PROPOSED / NEEDS CONFIRMATION**.
   - Mekanisme backup lokal dan impor REC telah selesai, implementasi fisik pengadaan USB drive cadangan kedua diserahkan kepada tim logistik IT.

---

## 6. Kesimpulan & Rekomendasi QA

1. **Rekomendasi Rilis Teknis:** Paket perangkat lunak `mrc-x-event-control` versi `v1.0.0-rc1` dinyatakan **LULUS UJI VALIDASI SISTEM (PASS)**.
2. **Rekomendasi Lapangan:** Sebelum hari-H pertandingan resmi, panitia diwajibkan menggelar gladi bersih tatap muka selama 15–30 menit bersama 5 perwakilan peran (Koordinator, Operator IT, Operator Elektronika/Mesin, Petugas OBS, dan Dewan Juri) menggunakan launcher produksi dan panduan Runbook yang telah disediakan.
