# Bukti Validasi L-04 (Integrasi Match Lifecycle, Timer Engine, dan Arena)

Tanggal: 21 Oktober 2026.  
Lingkungan: Linux, Node.js 24.22.0, pnpm 12.11.2, Prisma 7.10.0, better-sqlite3 12.11.1, Fastify 5.2.1.  
Seluruh validasi dijalankan secara terisolasi pada temporary directory; tidak ada database operasional acara atau deployment produksi yang disentuh.

---

## 1. Cakupan dan Ketertelusuran

| Trace | Dokumen Acuan | Status | Bukti / Catatan |
|---|---|---|---|
| **L-04 / ML-02 / ML-03** | `spec.md`, `API_CONTRACT.md` | **PASS** | Rute `POST /api/v1/arenas/main/commands` (`match.select`, `match.release`) dan `POST /api/v1/matches/:id/commands` (`segment.prepare`, `phase.advance`, `match.pause`, `match.postpone`, `match.cancel`) terpasang dengan CAS `expectedArenaVersion` dan `expectedMatchVersion`. Dibuktikan di `apps/server/test/match-lifecycle-integration.test.ts`. |
| **TC-02 / TC-12 (Arena Lock & Invariants)** | `TEST_PLAN.md` | **PASS** | Memilih match baru saat arena sibuk menghasilkan `ARENA_BUSY` (409). Pelepasan match (`match.release`) setelah pertandingan dimulai ditolak dengan `INVALID_TRANSITION` (wajib menggunakan `postpone`). |
| **TC-03 (Pre-match & First Segment Atomicity)** | `TEST_PLAN.md`, `STATE_MACHINE.md` | **PASS** | Alur fase pre-match normal (`CALLING` → `VERIFICATION` → `WARMUP` → `READY`). Persiapan segmen di fase `READY` menghasilkan `SegmentAttempt` dengan status `PREPARED`. Transisi ke `COMPETITION` mengubah attempt pertama menjadi `ACTIVE` dan match menjadi `IN_PROGRESS` (`hasStarted: true`) secara atomik. |
| **Integrasi Timer Engine (003 E-08)** | `TIMER_SPEC.md` | **PASS** | Perintah `segment.prepare`, `match.pause`, dan `match.postpone` mengendalikan instance `TimerService` secara atomik di dalam transaksi database SQLite. |
| **Snapshot Identitas Tim** | `DATA_MODEL.md` | **PASS** | Pemilihan match ke arena membekukan snapshot nama, kode, dan institusi tim ke dalam `teamASnapshotJson` dan `teamBSnapshotJson` di SQLite. |

---

## 2. Perintah Verifikasi dan Hasil Aktual

```text
$ pnpm --filter shared test && pnpm --filter server test
- Shared Tests: 29/29 PASS
- Server Test Suites: 64/64 PASS (9 test suites)

$ pnpm run verify
- Server Typecheck: PASS
- Server Unit/Integration Tests: PASS (64 tests)
- Server Production Build: PASS
- Web Lint (oxlint): PASS (0 errors)
- Web Production Build (vite build): PASS (dist output valid)
```
