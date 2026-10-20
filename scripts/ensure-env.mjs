// Menyalin template `.env.example` menjadi `.env` bila `.env` belum ada.
// Idempoten: `.env` yang sudah ada tidak pernah ditimpa.
//
// Dipakai oleh `pnpm setup` agar instalasi baru tidak berakhir dengan server
// yang gagal start karena `DATABASE_URL is required`.
import { copyFile, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../apps/server',
)
const target = resolve(serverDirectory, '.env')
const template = resolve(serverDirectory, '.env.example')

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

if (await exists(target)) {
  process.stdout.write('.env sudah ada; tidak diubah.\n')
} else if (!(await exists(template))) {
  process.stderr.write(
    `Template ${template} tidak ditemukan; .env tidak dibuat.\n`,
  )
  process.exitCode = 1
} else {
  await copyFile(template, target)
  process.stdout.write(
    `.env dibuat dari .env.example di ${target}. Sesuaikan bila perlu.\n`,
  )
}
