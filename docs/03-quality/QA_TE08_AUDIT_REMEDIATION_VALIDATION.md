# Laporan Validasi QA — TE-08 dan Remediasi H-03 s/d M-06

Tanggal: 21 Oktober 2026  
Peran: QA / Lead Verification Engineer  
Lingkungan: Linux, Node.js 24.22.0, pnpm 12.11.2, SQLite (better-sqlite3 12.11.1), Prisma 7.10.0, Fastify 5.2.1.  
Acuan Kontrak: `specs/003-timer-engine/spec.md` (TE-08), `docs/03-quality/AUDIT_REMEDIATION.md` (H-03, H-04, H-05, H-06, M-01, M-04, M-05, M-06), `docs/03-quality/TEST_PLAN.md` (TC-29, TC-30, TC-31, TC-32, TC-33, TC-36, TC-37), dan `docs/01-product/RULEBOOK_NOTES.md` (D-11, D-14, D-15).

---

## 1. Ringkasan Eksekutif Validasi QA

Verifikasi telah dilaksanakan terhadap seluruh invarian domain dan kontrak batas sistem kontrol timer, lifecycle, durability, serta audit trail. Tidak ada fitur yang dinyatakan lulus hanya karena tombol antarmuka atau dokumen selesai dibuat. Seluruh kriteria invariant dibuktikan melalui pengujian otomatis unit, integrasi SQLite nyata, dan validasi kegagalan terkontrol.

| Item Kontrak | Deskripsi Singkat | Status | Keterangan & Rujukan Bukti |
|---|---|---|---|
| **TE-08** | Invarian engine tunduk pada activeMatchId, reset waktu vs restart attempt, startAuthorization, gate volatile ST, dan rekonsiliasi startup | **PASS** | Terbukti di `timer-engine.test.ts` dan `match-lifecycle-integration.test.ts`. |
| **H-03** | Select pertama vs select-resume; resume mempertahankan fase, attempt, skor gol, sisa waktu, dan timer non-running tanpa auto-start | **PASS** | Terbukti di `apps/server/test/match-lifecycle-integration.test.ts` (test case `select-resumes postponed match`). |
| **H-04** | Pemisahan CONNECTED vs SYNCHRONIZED, heartbeat committed revision independen outbox, stale timer projection guard | **MODUL: PASS**<br>**OBS E2E: BLOCKED** | Kontrak modul timer terverifikasi; integrasi live WebSocket OBS ditandai BLOCKED menunggu implementasi Feature 004. |
| **H-05** | Metadata pending durable sebelum eksekusi, ledger reservasi, terminal status, tombstone pembatalan vs delayed request | **PASS** | Terbukti di `apps/server/test/atomic-operation-uow.test.ts` (10 test cases UoW). |
| **H-06** | Transisi StorageHealth DEGRADED → RECOVERY_PENDING → HEALTHY; volatile gate saat DB error, probe terukur, tidak auto-resume | **PASS** | Terbukti di `apps/server/test/timer-engine.test.ts` (`QA-TC-33 / H-06`). |
| **M-01** | First segment attempt via `segment.prepare` (PREPARED → ACTIVE), timer.reset hanya mereset sisa waktu tanpa mereset fase/attempt | **PASS** | Terbukti di `apps/server/test/timer-engine.test.ts` (`QA-TC-29 / M-01`). |
| **M-04** | Recovery Objectives RO-01–04; restore database yang memuat record timer RUNNING diwajibkan rekonsiliasi tanpa auto-resume | **MEKANISME: PASS**<br>**AMBANG: BLOCKED** | Mekanisme teknis restore dan reconciler terbukti; persetujuan SLA/ambang resmi D-14/D-15 menunggu keputusan panitia. |
| **M-05** | Token start single-use (`readinessToken`), pembatalan kesiapan (disarm), invalidasi token pasca-start, penolakan start ganda | **PASS** | Terbukti di `apps/server/test/timer-engine.test.ts` (`QA-TC-30 / M-05`). |
| **M-06** | Pemisahan pengujian idempotency (key sama) dengan optimistic concurrency (20 key berbeda pada versi sama), audit traceability | **PASS** | Terbukti di `apps/server/test/timer-engine.test.ts` (`QA-TC-37 / M-06`) & `atomic-operation-uow.test.ts`. |

---

## 2. Rincian Pengujian Test Case (TC-29 s/d TC-37)

### TC-29: Matriks Transisi & Isolasi Reset vs Restart (H-03 / M-01)
- **Invariant Sukses:**
  - `timer.reset` mengembalikan `remainingMs` ke `initialMs` dan status menjadi `IDLE`.
  - Record `SegmentAttempt` di database tetap pada status `ACTIVE` dan ordinal/attempt tidak bertambah/berubah.
  - Snapshot fase pertandingan (`COMPETITION`) dan skor pertandingan tetap utuh, tidak ter-reset ke `PRE_MATCH`.
- **Hasil:** **PASS** (Diverifikasi pada `apps/server/test/timer-engine.test.ts` baris 242–289).

### TC-30: Token Kesiapan Start Single-Use & Anti-Replay (M-05)
- **Invariant Sukses:**
  - Token kesiapan start (`readinessToken`) di-arm secara sadar sebelum aba-aba juri.
  - Satu kali eksekusi `timerService.start({ readinessToken })` berhasil mengubah status timer menjadi `RUNNING` dan mengonsumsi token.
- **Invariant Gagal (Rejection Guard):**
  - Upaya start kedua dengan token yang sama (atau token yang sudah terpakai) seketika ditolak dengan galat `INVALID_READINESS_TOKEN`.
- **Hasil:** **PASS** (Diverifikasi pada `apps/server/test/timer-engine.test.ts` baris 291–306).

### TC-31: Guard Kesegaran Sinkronisasi Siaran (H-04)
- **Scope Modul Timer:**
  - Engine menghitung proyeksi sisa waktu secara monotonic murni.
  - Proyeksi timer tidak mengizinkan lompatan mundur akibat wall-clock drift NTP.
  - Hasil: **PASS**.
- **Scope Integrasi Lintas Modul (Feature 004 - OBS Overlay Socket):**
  - Pengujian putus jalur outbox dengan heartbeat independen serta safe display broadcast: **BLOCKED / NOT RUN** (karena paket/modul `apps/server/src/obs-routes.ts` dan client browser source OBS baru masuk jadwal implementasi Feature 004).

### TC-32: Isolasi Reservasi UoW & Tombstone Pembatalan (H-05)
- **Invariant Sukses:**
  - Operasi terbagi atas dua fase: `RESERVED` lalu `SUCCEEDED` secara atomik.
  - 100 kali pengulangan dengan key/payload yang sama mengembalikan receipt yang identik tanpa efek samping ganda.
  - Pembatalan permintaan (`cancel-or-observe`) menaruh tombstone `CANCELLED` sehingga delayed request yang tiba belakangan ditolak.
- **Hasil:** **PASS** (Diverifikasi pada `apps/server/test/atomic-operation-uow.test.ts`).

### TC-33: Storage Degradation Gate & Larangan Auto-Resume (H-06)
- **Invariant Gagal saat Rusak:**
  - Saat penyimpanan berada pada status `DEGRADED`, seluruh perintah mutasi (`pause`, `start`, `adjust`, `reset`) langsung ditolak dengan galat semantik `STORAGE_DEGRADED` tanpa menyentuh disk.
- **Invariant Pemulihan:**
  - Ketika storage dinyatakan pulih (`HEALTHY`), timer yang sedang `PAUSED` tetap berada pada kondisi `PAUSED` dan `remainingMs` tidak berubah.
  - Sistem melarang keras timer melakukan auto-resume tanpa aba-aba baru dari operator/juri.
- **Hasil:** **PASS** (Diverifikasi pada `apps/server/test/timer-engine.test.ts` baris 308–334).

### TC-36: Durability Backup & Rekonsiliasi Restore RUNNING (M-04)
- **Invariant Sukses:**
  - Backup database SQLite diverifikasi integritasnya melalui hash SHA-256 dan PRAGMA integrity_check.
  - Restore backup yang mengandung record timer berstatus `RUNNING` berhasil diimpor; setelah restart, `TimerService.startupReconcile()` secara otomatis mengubah record tersebut menjadi `RECOVERY_REQUIRED` dan menandai pertandingan sebagai `PAUSED`.
- **Hasil Mekanisme:** **PASS** (Diverifikasi pada `apps/server/test/database.test.ts` dan `apps/server/test/timer-engine.test.ts`).
- **Ambang Batas Operasional (SLA):** **NOT RUN / BLOCKED** (Target RO-01–04 RPO ≤30 mnt dan RTO ≤10 mnt belum digladikan di arena).

### TC-37: Concurrency CAS & Jejak Audit Monotonik (M-06)
- **Invariant Sukses:**
  - Perubahan durasi timer melalui `adjust` mencatat `auditEntry` dengan id unik, timestamp UTC teratur, delta millisecond, serta alasan operasional.
  - Mutasi timer terlindungi oleh nomor generasi (`timerGeneration`) dan `checkpointSeq` yang naik secara monotonik.
- **Hasil:** **PASS** (Diverifikasi pada `apps/server/test/timer-engine.test.ts` baris 336–351).

---

## 3. Laporan Status Persetujuan Terbuka Panitia (D-11, D-14, D-15)

Sesuai instruksi dan pedoman tata kelola proyek:
1. **D-11 (Otorisasi Override Lapangan & Daftar Petugas Pemberi Izin):**
   - *Status saat ini:* **NEEDS CONFIRMATION / BLOCKED**.
   - *Keterangan:* Hak operator arena untuk jeda darurat dan penyesuaian lapangan tetap aktif secara teknis dengan field `authorityReference`. Namun, daftar nama/jabatan resmi pemberi izin (dewan juri/koordinator) belum ditetapkan oleh panitia MRC X 2026.
   - *Tindakan QA:* Tugas implementasi yang mengasumsikan validasi hardcoded terhadap nama juri resmi **tidak dikerjakan**.

2. **D-14 (Ambang Batas Pemulihan RO-01 s/d RO-04):**
   - *Status saat ini:* **PROPOSED / NEEDS CONFIRMATION**.
   - *Keterangan:* Target RPO ≤ 30 menit, RTO ≤ 10 menit, dan interval checkpoint ≤ 1 detik merupakan parameter usulan teknik, bukan SLA kontrak lomba yang disahkan.
   - *Tindakan QA:* Mekanisme pencatatan checkpoint dan restore SQLite telah diverifikasi, namun angka batas waktu pemulihan tidak diklaim sebagai jaminan performa mutlak.

3. **D-15 (Kebijakan Media Cadangan Kedua & Retensi Berkas):**
   - *Status saat ini:* **PROPOSED / NEEDS CONFIRMATION**.
   - *Keterangan:* Kebijakan media eksternal kedua (USB flash drive terlabel) dan retensi fisik lembar formulir manual juri belum disahkan secara formal.
   - *Tindakan QA:* Sistem mendukung backup file path dinamis dan verifikasi checksum SHA-256; otomatisasi duplikasi ke flash drive kedua ditahan hingga persetujuan operasional tersedia.

---

## 4. Kesimpulan Akhir QA

Seluruh persyaratan invarian TE-08 beserta kontrak remediasi H-03, H-05, H-06, M-01, M-05, dan M-06 dinyatakan **PASS**. Ketergantungan siaran OBS live (H-04 / TC-31) dinyatakan **BLOCKED** secara terisolasi menunggu Feature 004, dan parameter operasional D-11/D-14/D-15 dilaporkan secara transparan sebagai **NEEDS CONFIRMATION**.
