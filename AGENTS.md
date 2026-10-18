# Repository Guidelines

## Konteks dan Urutan Baca

MRC X 2026 mengendalikan pertandingan Tim A vs Tim B dan OBS secara lokal. Juri memberi keputusan; operator memasukkan hasil. Baca [istilah](CONTEXT.md), [PRD](docs/01-product/PRD.md), [SDD turunan](docs/01-product/SDD.md), lalu `spec.md`, `plan.md`, dan `tasks.md` fitur terkait sebelum implementasi. Periksa [SDD asli](docs/SDD_MRC_X_2026_Sistem_Kontrol_Pertandingan.md) untuk sumber historis; pertahankan isinya.

## Peta Teknis

`apps/web` berisi template React/Vite; `apps/server` baru manifest. `packages/shared` ditujukan untuk kontrak bersama. Baca [arsitektur](docs/02-engineering/ARCHITECTURE.md), [model data](docs/02-engineering/DATA_MODEL.md), serta kontrak state/timer/API saat menyentuh modul terkait. Panduan panitia ada di [runbook](docs/03-quality/RUNBOOK.md).

Gunakan pnpm 12.11.2, ES modules, TypeScript, indentasi dua spasi, string JavaScript berpetik tunggal, tanpa semicolon, PascalCase untuk komponen, camelCase untuk fungsi. Pertahankan CSS di dekat komponennya dan aset di `src/assets` atau `public`. Targetkan TypeScript strict; konfigurasi sekarang belum mengaktifkannya eksplisit. Dependensi terpasang dan usulan dibedakan dalam [ADR stack](docs/04-decisions/0002-tech-stack.md); jangan menganggap library usulan tersedia.

## Integritas dan Migrasi

Server menjadi otoritas; validasi transisi dan hak akses di server. Commit state, audit, idempotency, dan outbox secara atomik sebelum broadcast. Lindungi hasil resmi, intent gol sekali pakai, ledger pending, serta konflik versi. Setelah restart/storage fault, timer menunggu rekonsiliasi. Saat mengubah kontrol gol, start, siaran atau recovery, baca kontrak SC/OP/AUTH/REC pada API, BC pada arsitektur dan ST pada timer beserta [remediasi](docs/03-quality/AUDIT_REMEDIATION.md); implementasi harus membuktikan AC-28–37.

Sebelum migrasi: cadangkan database secara konsisten, uji restore pada salinan, tinjau SQL dan kompatibilitas versi. Terapkan hanya saat maintenance tanpa match aktif; restore recovery memastikan penulis berhenti dan merekonsiliasi record RUNNING lama sesudah restore. Hindari reset/drop database acara; simpan pasangan versi aplikasi dan database untuk pemulihan.

## Asumsi dan Dokumentasi

Hentikan bagian pekerjaan yang bergantung pada kontradiksi belum terselesaikan, laporkan sumber dan dampaknya, serta lanjutkan bagian independen. Catat di [register keputusan](docs/01-product/RULEBOOK_NOTES.md). Jangan menciptakan aturan resmi, durasi baku, pemenang otomatis, atau dukungan multi-arena. Gunakan [NEEDS CONFIRMATION] untuk keputusan panitia dan [PROPOSED] untuk desain belum disetujui. Perbarui requirement, kontrak, spesifikasi, dan tes terkait bersama perubahan; pertahankan ID stabil.

## Validasi dan Definition of Done

Frontend: `pnpm --filter web build` dan `pnpm --filter web lint`. Root/server test masih placeholder gagal; dokumentasikan keterbatasannya. Saat runner tersedia, jalankan tes relevan menurut [test plan](docs/03-quality/TEST_PLAN.md), termasuk penolakan, duplikasi, restart, dan offline untuk perubahan kritis. Dokumentasi: periksa tautan, sumber, dan konsistensi istilah.

Selesai bila acceptance terkait terbukti, audit/recovery diuji, dokumen diperbarui, dan kegagalan/keterbatasan dilaporkan. Gunakan commit `feat:`, `fix:`, atau `chore:` sesuai perubahan. PR menyertakan ID kebutuhan, hasil validasi, issue terkait, dan screenshot untuk UI.
