# Bukti Validasi T-01 s/d T-04 dan Ketertelusuran Bukti Tambahan

Tanggal: 20 Oktober 2026.  
Lingkungan: Linux, Node.js 24.22.0, pnpm 12.11.2, Prisma 7.10.0, better-sqlite3 12.11.1, Fastify 5.2.1, React 19.2.8.  
Seluruh validasi dijalankan secara terisolasi pada temporary directory; tidak ada database operasional acara atau deployment produksi yang disentuh.

---

## 1. Cakupan dan Ketertelusuran

| Trace | Dokumen Acuan | Status | Bukti / Catatan |
|---|---|---|---|
| **TM-01 / AC-01 / TC-01** | `spec.md`, `API_CONTRACT.md` | **PASS** | CRUD Kategori, Grup, dan Tim; penolakan kode unik duplikat (422 `DUPLICATE_CODE`), category mismatch pada grup (422 `CATEGORY_MISMATCH`), CAS optimistic locking (409 `VERSION_CONFLICT`), dan soft-archive (`archivedAt` terisi, default tersaring pada query tim). |
| **TM-02 / AC-01 / TC-02** | `spec.md`, `API_CONTRACT.md` | **PASS** | Impor CSV preview/commit; validasi all-or-nothing (jika ada baris rusak, 0 baris ditulis dan commit ditolak 422), snapshot hash isi `previewHash`, dan deteksi basi saat katalog berubah di tengah jalan (409 `VERSION_CONFLICT`). |
| **TM-03 / TM-06 / AC-02** | `spec.md`, `API_CONTRACT.md` | **PASS** | Penjadwalan manual dengan guard Tim A ≠ Tim B (422 `SAME_TEAM_FORBIDDEN`), tim dan kategori harus selaras (422 `CATEGORY_MISMATCH`), tim terarsip dilarang dijadwalkan, koreksi jadwal sebelum bermain menaikkan `matchVersion`, dan penolakan koreksi jadwal ketika status bukan `SCHEDULED` atau pertandingan telah dimulai (422 `MATCH_ALREADY_STARTED`). |
| **TM-04 / AC-18 / TC-18** | `spec.md`, `API_CONTRACT.md` | **PASS** | RBAC server: Operator dapat membaca Kategori, Grup, Tim, dan Jadwal (200 OK), tetapi seluruh mutasi POST/PATCH ditolak (403 Forbidden). Akses tanpa sesi menghasilkan 401 Unauthorized. |
| **TM-05 / AC-19 / TC-19** | `spec.md`, `API_CONTRACT.md` | **PASS** | Seluruh mutasi master dan jadwal menghasilkan `AuditEntry` otomatis yang mencatat `actorId`, `action`, `resourceType`, `resourceId`, serta diff `beforeJson` dan `afterJson`. |
| **TM-07 / AC-32 / TC-32** | `AUDIT_REMEDIATION.md` (H-05) | **PASS** (scope modul) | Tombstone sebelum reserve menolak delayed execution; RESERVED dapat dibatalkan; SUCCEEDED hanya diobservasi; runtime lama menjadi REJECTED; receipt pulih setelah reconnect DB. |
| **AC-35 / TC-35** | `AUDIT_REMEDIATION.md` (M-02, M-03) | **PASS** (scope modul) | Anonymous bootstrap CSRF token dirotasi saat login dan sesi anonim lama dicabut; token salah/expired ditolak; socket lama dicabut saat logout/disable. |
| **AC-37 / TC-37** | `AUDIT_REMEDIATION.md` (M-06) | **PASS** (scope modul) | Idempotency 100 retry key/hash sama menghasilkan satu efek; 20 key berbeda melawan versi sama menghasilkan tepat satu SUCCEEDED dan 19 VERSION_CONFLICT terminal. |
| **L-01 (Kesiapan Handover)** | `AUDIT_REMEDIATION.md` (L-01) | **PASS** | Fondasi F-01–F-06 dan T-01/T-03 selesai; Feature 002 (Match Lifecycle) dapat dimulai tanpa terhambat oleh impor T-02. |
| **UI Resilience (T-04)** | `UI_UX_GUIDELINES.md` | **PASS** | Komponen React `AdminTeamManagement` menangani state *empty*, *loading*, *error* aman tanpa bocor stacktrace, dan *conflict*. |

---

## 2. Perintah Verifikasi dan Hasil Aktual

```text
$ pnpm --filter shared test && pnpm --filter server test
- Shared DTO Contracts: 10/10 PASS
- Server Test Suites: 48/48 PASS (5 suites: bootstrap, AUTH, SQLite, Operation UoW, Runtime guard, Team Management)

$ pnpm run verify
- Server Typecheck: PASS
- Server Unit/Integration Tests: PASS (48 tests)
- Server Production Build: PASS
- Web Lint (oxlint): PASS (0 errors)
- Web Production Build (vite build): PASS (dist output valid)
```

---

## 3. Laporan Status Keputusan Terbuka (D-11, D-14, D-15)

Sesuai ketentuan `specs/001-team-management/tasks.md` dan `AUDIT_REMEDIATION.md`:

1. **D-11 (Petugas Pengesah Lapangan)**:
   - Status: **[NEEDS CONFIRMATION]**.
   - Keterangan: Implementasi engineering telah memisahkan hak operator dari identitas pengesah (`authorityReference`), namun daftar nama resmi dan wewenang juri lapangan masih menunggu penetapan panitia pelaksana.
2. **D-14 (Target RPO/RTO dan Media Sekunder)**:
   - Status: **[NEEDS CONFIRMATION]**.
   - Keterangan: Engine backup salinan SQLite dan verifikasi version pairing telah teruji di F-04, namun target durasi backup berkala (≤30 menit) dan media fisik sekunder harus disepakati sebelum hari-H.
3. **D-15 (Format dan Batas CSV Impor)**:
   - Status: **[PROPOSED / BASELINE IMPLEMENTED]**.
   - Keterangan: Parser impor T-02 telah mengimplementasikan baseline usulan `categoryCode,teamCode,teamName,institution,groupName` dengan batas 5 MiB / 5.000 baris dan *All-or-Nothing*. Jika panitia acara menerbitkan template kolom yang berbeda sebelum rilis operasional R-01, parser perlu disesuaikan.

---

## 4. Batasan Pengujian dan Pekerjaan Lanjutan (NOT RUN)

- **E2E WebSocket Broadcast ke OBS / Overlay**: **NOT RUN** (merupakan cakupan Feature 004).
- **Match Lifecycle Timer FSM**: **NOT RUN** (merupakan cakupan Feature 002 dan Feature 003).
- **Fault Injection Fisik / OS-level ENOSPC**: **NOT RUN** (pengujian saat ini berbasis software transactional rollback).

Gate Feature 001 telah terpenuhi. Paket pekerjaan siap dilanjutkan ke **Feature 002 (Match Lifecycle)**.
