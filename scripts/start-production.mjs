#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverDist = resolve(rootDir, 'apps/server/dist/index.js')
const webDist = resolve(rootDir, 'apps/web/dist')
const serverEnv = resolve(rootDir, 'apps/server/.env')

process.stdout.write('===========================================\n')
process.stdout.write('  MRC X 2026 — Offline Production Launcher \n')
process.stdout.write('===========================================\n')

// 1. Verifikasi Build Artifact
if (!existsSync(serverDist)) {
  process.stderr.write(
    'ERROR: apps/server/dist belum dibangun. Jalankan "pnpm --filter server build" terlebih dahulu.\n',
  )
  process.exit(1)
}

if (!existsSync(webDist)) {
  process.stderr.write(
    'PERINGATAN: apps/web/dist belum ada. Antarmuka web mungkin tidak dapat dilayani secara lokal.\n',
  )
}

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '127.0.0.1'

// 2. Proteksi Instance Ganda (Port Check)
const tester = createServer()
tester.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(
      `ERROR: Port ${port} di ${host} sudah digunakan oleh proses lain! Cegah instance ganda.\n`,
    )
    process.exit(1)
  }
})

tester.once('listening', () => {
  tester.close(() => {
    process.stdout.write(`Port ${port} tersedia. Memulai server produksi...\n`)

    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        `--env-file-if-exists=${serverEnv}`,
        serverDist,
      ],
      {
        cwd: resolve(rootDir, 'apps/server'),
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          STATIC_ROOT: webDist,
        },
      },
    )

    const handleShutdown = (signal) => {
      process.stdout.write(`\nMenerima ${signal}. Menghentikan server produksi dengan tertib...\n`)
      child.kill(signal)
    }

    process.on('SIGINT', () => handleShutdown('SIGINT'))
    process.on('SIGTERM', () => handleShutdown('SIGTERM'))

    child.on('exit', (code, signal) => {
      if (signal) {
        process.stdout.write(`Server berhenti karena signal ${signal}.\n`)
      } else {
        process.stdout.write(`Server keluar dengan kode ${code}.\n`)
      }
      process.exit(code ?? 0)
    })
  })
})

tester.listen(port, host)
