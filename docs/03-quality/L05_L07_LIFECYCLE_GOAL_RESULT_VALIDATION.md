# Bukti Validasi L-05 s/d L-07 (Override Segmen, GoalIntent & Hasil Resmi)

Tanggal: 21 Oktober 2026.  
Lingkungan: Linux, Node.js 24.22.0, pnpm 12.11.2, Prisma 7.10.0, better-sqlite3 12.11.1, Fastify 5.2.1.  
Seluruh validasi dijalankan secara terisolasi pada temporary directory; tidak ada database operasional acara atau deployment produksi yang disentuh.

---

## 1. Cakupan dan Ketertelusuran

| Trace | Dokumen Acuan | Status | Bukti / Catatan |
|---|---|---|---|
| **L-05 / ML-03 / ML-04 / AC-04 / AC-07** | `spec.md`, `API_CONTRACT.md` | **PASS** | Rute `POST /api/v1/matches/:id/review` menghasilkan `confirmImpactDigest` kanonis. Perintah `phase.override` menolak override tanpa alasan/rujukan juri (422) dan timer aktif (409). `segment.restart` mengganti attempt lama (`status: REPLACED`) dan membuat attempt baru (`status: PREPARED`, `attempt: attempt + 1`). |
| **L-06 / SC-01 s/d SC-04 / TC-08 / TC-22** | `API_CONTRACT.md` (§SC), `DATA_MODEL.md` | **PASS** | Migrasi SQLite `20261021120000_add_goal_intent` menambahkan model `GoalIntent` serta atribut `logicalGoalId` & `correctionGroupId` pada `GoalEvent`. Transisi `PREPARED -> ACTIVE` membuat tepat satu `GoalIntent` status `READY`. Perintah `goal.add` mengonsumsi token secara atomik; submission ulang dengan token yang sama ditolak (409 `GOAL_INTENT_CONSUMED`). `goal.prepare-next` melakukan re-arm eksplisit token baru. `goal.correct` menambahkan delta -1. `goal.reassign` membatalkan sisi lama (-1) dan menambah sisi baru (+1) dalam satu transaksi linier. |
| **L-07 / TC-09 / TC-10 / TC-19** | `STATE_MACHINE.md`, `API_CONTRACT.md` | **PASS** | `result.draft` mencatat revisi draf hasil. `result.finalize` memfinalisasi draf menjadi `FINAL`, menyelesaikan match (`COMPLETED`), dan melepas kunci arena; finalisasi ditolak jika timer masih berjalan. Operator dilarang melakukan `result.reopen` (403 `FORBIDDEN`). Super-admin berhasil melakukan reopen menjadi `CORRECTION_PENDING` dan `result.refinalize` mengarsip revisi lama sebagai `SUPERSEDED`. |

---

## 2. Perintah Verifikasi dan Hasil Aktual

```text
$ pnpm --filter shared test && pnpm --filter server test
- Shared Tests: 29/29 PASS
- Server Test Suites: 77/77 PASS (13 suites)

$ pnpm run verify
- Server Typecheck: PASS
- Server Unit/Integration Tests: PASS (77 tests)
- Server Production Build: PASS
- Web Lint (oxlint): PASS (0 errors)
- Web Production Build (vite build): PASS (dist output valid)
```
