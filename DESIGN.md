# MRC X 2026 Event Control — Panduan Desain

> Kertas hangat yang tertata rapi: kanvas off-white ala Notion, status fungsional ala flat design korporat.

Dokumen ini menggabungkan dua referensi: **Notion — Style Reference** (kanvas, kartu, tipografi, warna aksen) dan **Flat Design Corporativo** (warna status, aturan gerak, aturan tata letak). Bagian yang tidak relevan untuk aplikasi kendali pertandingan (hero pill, avatar karakter, landing page, logo wall, font Lyon Text) sengaja dibuang. Semua isi di sini berstatus [PROPOSED] sampai diimplementasikan; lihat [README](README.md) dan [PRD](docs/01-product/PRD.md).

## Prinsip

1. **Tenang dan terbaca.** Operator bekerja di bawah tekanan waktu; antarmuka harus datar, rapi, dan tidak ramai.
2. **Warna membawa makna.** Satu warna biru untuk aksi utama, hijau/kuning/merah/cyan hanya untuk status. Warna dekoratif tidak dipakai di layar operator.
3. **Datar total.** Tanpa gradien. Kartu dipisahkan dengan garis tepi 1px, bukan bayangan.
4. **Offline penuh.** Semua font, ikon, dan aset dibundel lokal; tidak ada CDN atau Google Fonts, karena sistem berjalan tanpa internet.

## Keputusan Penggabungan

| Topik | Notion | Flat Corporativo | Dipakai |
|---|---|---|---|
| Biru aksi utama | `#0075de` | `#007BFF` | **`#0075de`** |
| Kanvas halaman | `#f6f5f4` | `#F8F9FA` | **`#f6f5f4`** |
| Permukaan kartu | `#ffffff` | `#FFFFFF` | **`#ffffff`** |
| Font | NotionInter / Inter | Lato | **Inter** (dibundel lokal) |
| Font serif | Lyon Text | — | **Tidak dipakai** |
| Radius kartu | 12px | 4px | **12px** |
| Radius tombol | 8px | 4px | **8px** |
| Radius kecil (input, tag) | 4px | 4px | **4px** |
| Bayangan | Tidak ada (hanya garis tepi) | Boleh tipis | **Tidak ada**, kecuali panel melayang (lihat Elevasi) |
| Warna status | Tidak ada | Hijau, kuning, merah, cyan | **Dari Flat Corporativo** |
| Teks hitam | Hitam dengan alpha | Hindari `#000` murni | **Ink `#111111` dengan alpha** |
| Gerak | 200ms ease | Spring, scale hover | **200ms ease**, tanpa scale |

## Warna

### Inti

| Token | Nilai | Peran |
|---|---|---|
| `--color-canvas` | `#f6f5f4` | Latar halaman |
| `--color-surface` | `#ffffff` | Kartu, panel, modal |
| `--color-ink` | `#111111` | Teks utama (hierarki lewat alpha 100/90/60/40%) |
| `--color-graphite` | `#615d59` | Teks isi sekunder |
| `--color-stone` | `#757575` | Teks bantu, label nonaktif |
| `--color-border` | `rgba(0,0,0,0.08)` | Garis tepi kartu dan pemisah |
| `--color-primary` | `#0075de` | Satu aksi utama per layar |
| `--color-primary-tint` | `#e6f3fe` | Tombol ghost, hover lembut |
| `--color-midnight` | `#02093a` | Panel gelap (pulau gelap, bukan tema gelap penuh) |

### Status (dari Flat Corporativo)

| Token | Nilai | Pemakaian |
|---|---|---|
| `--color-success` | `#28A745` | Pertandingan selesai, koneksi OBS tersambung, penyimpanan berhasil |
| `--color-warning` | `#FFC107` | Ditunda, perlu tinjauan, peringatan pemulihan (teks di atasnya hitam) |
| `--color-danger` | `#DC3545` | Galat, tindakan merusak, koneksi putus |
| `--color-info` | `#17A2B8` | Informasi netral, petunjuk |

Aturan: jangan menandai status hanya dengan warna. Selalu sertakan teks atau ikon (kebutuhan keterbacaan dan buta warna).

### Identitas Tim [PROPOSED]

| Token | Nilai | Pemakaian |
|---|---|---|
| `--color-team-a` | `#0075de` | Penanda Tim A |
| `--color-team-b` | `#f64932` | Penanda Tim B |

Aksen dekoratif Notion (`#ffb110`, `#e89d01`, `#e32d14`, `#b18164`, `#097fe8`, `#62aef0`) tidak dipakai di layar operator. Boleh dipakai di tampilan OBS bila perlu variasi per kategori; jaga kontras teks.

## Tipografi

Font tunggal: **Inter** (400, 500, 600, 700), dibundel lokal. Fitur OpenType `"lnum"` aktif agar angka timer dan skor sejajar; gunakan `font-variant-numeric: tabular-nums` untuk timer dan skor.

| Peran | Ukuran | Bobot | Tinggi baris | Tracking |
|---|---|---|---|---|
| caption | 12px | 400 | 1.33 | +0.01em |
| body-sm | 14px | 400 | 1.43 | normal |
| body | 16px | 400 | 1.5 | normal |
| subheading | 20px | 500 | 1.3 | normal |
| heading-sm | 22px | 700 | 1.27 | -0.011em |
| heading | 40px | 600 | 1.2 | -0.02em |
| display-sm | 54px | 600 | 1.04 | -0.035em |
| display | 72px | 600 | 1.1 | -0.028em |
| display-lg | 96px | 700 | 1.04 | -0.048em |

- Teks isi maksimal 72 karakter per baris.
- Tracking negatif hanya untuk ukuran besar; teks isi tetap normal.
- Skor dan timer di tampilan OBS memakai `display` atau `display-lg`, tabular, tanpa tracking negatif yang membuat angka berdempetan jika terbaca dari jauh (uji saat gladi).
- Monospace (JetBrains Mono, dibundel lokal) hanya untuk ID, log, dan nilai teknis.

## Spasi, Bentuk, dan Tata Letak

- **Satuan dasar:** 4px. Skala: 4, 8, 12, 16, 20, 24, 28, 32, 36, 64, 80.
- **Radius:** kartu 12px, tombol 8px, input dan tag kecil 4px, pill 9999px (hanya untuk label status).
- **Padding kartu:** 24px. **Jarak antarelemen:** 8px. **Jarak antarbagian:** 80px di halaman luas, 32px di layar operator padat.
- **Lebar maksimum:** 1440px untuk halaman; tampilan OBS mengikuti kanvas penyiaran (mis. 1920×1080), bukan batas ini.
- **Grid:** CSS Grid utama. Padding sisi 1.5rem.
- **Kepadatan:** layar operator lebih padat daripada referensi (komfortabel-ringkas); jangan mengorbankan ukuran target sentuh/klik minimal 40px.
- **Responsif:** kolom jamak runtuh di bawah 768px; tanpa gulir horizontal. Gunakan `min-h-[100dvh]`, bukan `h-screen`.
- **z-index:** base 0 / sticky-nav 100 / overlay 200 / modal 300 / toast 500.

## Permukaan dan Elevasi

| Level | Nama | Nilai | Pemakaian |
|---|---|---|---|
| 0 | Kanvas | `#f6f5f4` | Latar halaman |
| 1 | Kartu | `#ffffff` + garis tepi 1px | Panel, form, daftar |
| 2 | Aksen | warna status/identitas | Banner status, penanda tim |
| 3 | Gelap | `#02093a` | Panel kontras (mis. pratinjau OBS) |

- Kartu **tanpa bayangan**.
- Bayangan hanya untuk elemen yang melayang di atas konten, dan maksimal `0 2px 8px rgba(0,0,0,0.08)`: bilah navigasi lengket, menu dropdown, modal, toast.
- Jangan menaruh kartu hangat di atas latar putih; hierarki kanvas hangat → kartu putih tidak boleh dibalik.

## Komponen

**Tombol utama.** Latar `#0075de`, teks `#ffffff`, 14px/500, radius 8px, padding 6px 15px. Hanya satu per layar. Hover: gelapkan 8%. Aktif: geser -1px. Fokus: cincin 2px `#0075de` dengan offset 2px.

**Tombol ghost.** Latar `#e6f3fe`, teks `#0075de`, ukuran dan radius sama dengan tombol utama. Untuk aksi sekunder.

**Tombol teks.** Transparan, teks ink alpha 95%, radius 8px. Hover: latar `rgba(0,0,0,0.04)`.

**Tombol outline.** Transparan, garis 1px ink alpha 90%, radius 4px, padding 5px 10px. Untuk aksi inline ringkas.

**Tombol berbahaya.** Latar `#DC3545`, teks putih; selalu butuh konfirmasi untuk tindakan yang tidak dapat dibatalkan (mis. koreksi hasil, reset timer).

**Kartu putih.** Latar `#ffffff`, radius 12px, padding 24px, garis `rgba(0,0,0,0.08)`, tanpa bayangan. Judul 22px/700, isi 16px `#615d59`.

**Kartu aksen.** Latar warna status atau identitas tim, radius 12px, padding 24px, tanpa garis tepi. Warna teks mengikuti kontras (`#111111` atau `#ffffff`, minimal rasio 4.5:1).

**Kartu gelap.** Latar `#02093a`, teks putih, radius 12px. Dipakai hemat.

**Input.** Label di atas kolom, garis 1px, radius 4px, tinggi minimal 40px. Fokus: cincin 2px biru dengan offset 2px. Galat: teks `#DC3545` di bawah kolom. Tanpa label mengambang.

**Pill status.** Latar warna status, radius 9999px, padding 4px 12px, 12px/500. Teks hitam di atas kuning, putih di atas hijau/merah/biru. Selalu berisi teks (mis. "Berlangsung", "Ditunda", "Selesai").

**Navigasi.** Bilah atas 64px, item 14px/500. Item nonaktif ink alpha 54%, aktif ink penuh dengan indikator biru. Tanpa garis bawah saat hover.

**Skeleton dan keadaan kosong.** Skeleton berkilau sesuai dimensi komponen, bukan spinner melingkar. Keadaan kosong: ikon, teks penjelas, dan satu tombol aksi.

**Ikon.** Lucide atau Heroicons, dibundel lokal. Tanpa emoji di UI.

## Gerak

- Hover dan transisi: **200ms ease**. Masuk: fade + translateY 16px → 0 selama 480ms ease-out; daftar bertahap 100ms per item. Transisi halaman: fade + geser 300ms.
- Hanya animasi `transform` dan `opacity`; jangan memicu layout.
- Tanpa efek scale saat hover dan tanpa animasi pantul di layar operator.
- Hormati `prefers-reduced-motion`.
- **Tampilan OBS:** gerak minimal dan deterministik (fade atau geser pendek). Pembaruan skor dan timer tidak boleh menunggu animasi selesai.

## Aturan

### Lakukan
- Pakai `#f6f5f4` untuk kanvas dan `#ffffff` untuk kartu.
- Cadangkan `#0075de` untuk satu aksi utama per layar.
- Pisahkan kartu dengan garis tepi 1px, bukan bayangan.
- Bangun hierarki teks lewat alpha pada satu warna ink.
- Sertakan teks atau ikon pada setiap penanda status.
- Bundel semua font dan aset secara lokal.

### Jangan
- Jangan memakai `#ffffff` sebagai latar halaman.
- Jangan memakai gradien, bayangan pada kartu, atau radius lebih dari 12px pada konten persegi.
- Jangan memakai `#000000` murni; gunakan `#111111` dengan alpha.
- Jangan memakai beberapa warna tombol terisi dalam satu tampilan.
- Jangan memakai emoji di UI, lorem ipsum di demo, atau salinan klise ("Elevate", "Seamless", "Unleash", "Next-Gen").
- Jangan memuat font, skrip, atau gambar dari jaringan eksternal.

## Token CSS (Tailwind v4)

```css
@theme {
  /* Warna inti */
  --color-canvas: #f6f5f4;
  --color-surface: #ffffff;
  --color-ink: #111111;
  --color-graphite: #615d59;
  --color-stone: #757575;
  --color-primary: #0075de;
  --color-primary-tint: #e6f3fe;
  --color-midnight: #02093a;

  /* Status */
  --color-success: #28a745;
  --color-warning: #ffc107;
  --color-danger: #dc3545;
  --color-info: #17a2b8;

  /* Identitas tim */
  --color-team-a: #0075de;
  --color-team-b: #f64932;

  /* Font (dibundel lokal) */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* Spasi dasar 4px */
  --spacing: 4px;
}

:root {
  --color-border: rgba(0, 0, 0, 0.08);
  --shadow-float: 0 2px 8px rgba(0, 0, 0, 0.08);
  --duration-base: 200ms;
}
```

## Sumber

Digabung dari `DESIGN.md` (Notion — Style Reference) dan `design.md` (Flat Design Corporativo, designmd.app). Angka bersumber dari kedua berkas asli; keputusan konflik ada di tabel "Keputusan Penggabungan".