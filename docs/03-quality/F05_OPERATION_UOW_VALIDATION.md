# F-05 — Validasi Atomic Operation Unit of Work

Tanggal eksekusi: 18 Oktober 2026. Cakupan ini hanya fondasi Feature 001;
hasilnya bukan klaim E2E lifecycle, timer, gol, OBS, auth, atau browser offline.

## Implementasi

`OperationUnitOfWork` menyediakan reservation unik
`principalId+scope+idempotencyKey`, pemeriksaan hash, execute yang mensyaratkan
reservation, replay receipt terminal, rejection terminal, dan cancel-or-observe
dengan tombstone. Penulis SQLite diantrikan melalui satu antrean process-wide,
sehingga beberapa instance service yang berbagi Prisma client tidak dapat
menjalankan transaksi dan terminalisasi ledger secara bertumpang-tindih.

Callback domain melakukan CAS di dalam transaksi yang sama dengan audit,
outbox, receipt, dan perubahan ledger menjadi `SUCCEEDED`. Error domain definitif
merollback transaksi bisnis lalu menutup reservation sebagai `REJECTED` dalam
transaksi tersendiri. Error storage/commit tidak membuat terminal receipt palsu.

Fixture memakai revision `Category` sebagai aggregate fondasi. Ini sengaja tidak
menciptakan aturan match atau mengklaim fitur 002–004 telah tersedia.

## Bukti Eksekusi

| Trace | Status | Bukti |
|---|---|---|
| F-05 / AC-19 / TC-19 | PASS (fondasi) | State, audit, receipt, outbox, dan ledger terminal commit bersama; empat titik fault merollback semuanya |
| F-05 / AC-22 / TC-22 | PASS (fondasi) | 100 retry key/hash sama menghasilkan satu effect/audit/receipt/outbox; hash berbeda menghasilkan `KEY_REUSED` |
| F-05 / AC-24 / TC-24 | PASS sebagian | 10× fault pada masing-masing titik sesudah business, audit, outbox, dan receipt di SQLite nyata: nol sukses palsu dan ledger tetap `RESERVED` |
| TM-07 / AC-32 / TC-32 | PASS (fixture server) | Tombstone sebelum reserve menolak delayed execute; RESERVED dapat dibatalkan; SUCCEEDED hanya diobservasi; runtime lama menjadi `REJECTED`; receipt pulih sesudah reconnect DB |
| M-06 / AC-37 / TC-37 | PASS (fixture fondasi) | 20 key berbeda melawan revision 1: tepat satu `SUCCEEDED`, 19 `REJECTED/VERSION_CONFLICT`, satu audit/receipt/outbox; regresi memakai 20 `OperationUnitOfWork` yang berbagi satu Prisma client dan membuktikan nol ledger `RESERVED` tersisa |

Perintah final:

```text
pnpm --filter server typecheck
PASS

pnpm --filter server build
PASS

pnpm --filter server test
PASS — 27 tests, 4 suites, 0 failed
```

Run pertama sesudah implementasi menemukan kegagalan oracle ledger pada race:
hasil pemanggil menunjukkan 19 conflict tetapi hanya satu rejection terminal.
Perbaikan awal menambahkan serialisasi per instance, tetapi QA lintas 20 instance
masih menemukan 18 ledger `RESERVED`. Remediasi memindahkan antrean ke scope
proses; regresi lintas instance membuktikan semua 19 ledger ditutup
`REJECTED/VERSION_CONFLICT`.

## Batas dan Pekerjaan Lanjutan

- AC-24 OS-level ENOSPC, filesystem read-only, dan lock dari proses eksternal:
  **NOT RUN**. Fixture saat ini menguji rollback nyata dengan exception pada
  empat batas write, bukan fault media/OS.
- OP-01 metadata durable browser dan endpoint HTTP OP-02/04/05: **NOT RUN**;
  F-05 ini menyediakan service server yang akan diikat setelah auth/routing.
- Cross-account super-admin cancel+audit: **BLOCKED** oleh F-06 AUTH.
- GoalIntent, timer pause, finalisasi, recovery storage gate, dan broadcast
  consumer: **NOT RUN** dan tetap milik paket 002–004/F-06 terkait.
- Serialisasi in-process bukan distributed lock. Arsitektur acara tetap satu
  server lokal; CAS SQLite adalah guard otoritatif terhadap stale revision.

Checklist `F-05` pada `specs/001-team-management/tasks.md` belum dicentang sampai
review independen SENTINEL melalui NEXUS selesai.
