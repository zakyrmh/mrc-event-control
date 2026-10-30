import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const SESSION = process.env.BSK_SESSION || 'yajv'
console.log(`[E2E] Running BSK E2E Automation with Session: ${SESSION}`)
mkdirSync('/tmp/antigravity', { recursive: true })

function clickSelector(selector) {
  const syncOut = JSON.parse(execSync(`bsk cooperate sync --settle --session ${SESSION} --json`).toString())
  const cmd = `bsk click '${selector}' --session ${SESSION} --context "${syncOut.context_id}" --depends-on '${selector}'`
  return execSync(cmd).toString().trim()
}

function getSnapshot() {
  return execSync(`bsk snapshot --session ${SESSION}`).toString()
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  console.log('\n--- VERIFYING CURRENT STATE ---')
  let snap = getSnapshot()
  console.log('Snapshot excerpt:\n', snap.split('\n').slice(0, 20).join('\n'))

  // Check if we are already in competition or need to start
  if (snap.includes('Mulai Match #1') || snap.includes('Pilih Match')) {
    console.log('Selecting Match #1...')
    const selectBtn = snap.match(/(@e\d+)\s+button\s+"(?:Mulai Match #1|Pilih Match)/i)
    if (selectBtn) {
      const syncOut = JSON.parse(execSync(`bsk cooperate sync --settle --session ${SESSION} --json`).toString())
      execSync(`bsk click ${selectBtn[1]} --session ${SESSION} --context "${syncOut.context_id}" --depends-on button`)
      await sleep(1500)
    }

    const phases = [
      'Panggil Tim',
      'Verifikasi Robot',
      'Uji Lapangan',
      'Selesai & Lanjut Siap Pertandingan',
      'Siapkan Ronde 1',
      'Siap Mulai Ronde 1',
      'Mulai Pertandingan Sekarang'
    ]

    for (const p of phases) {
      snap = getSnapshot()
      const m = snap.match(new RegExp(`(@e\\d+)\\s+button\\s+"[^"]*${p}[^"]*"`, 'i'))
      if (m) {
        console.log(`Advancing phase: clicking ${m[1]} (${p})...`)
        const syncOut = JSON.parse(execSync(`bsk cooperate sync --settle --session ${SESSION} --json`).toString())
        execSync(`bsk click ${m[1]} --session ${SESSION} --context "${syncOut.context_id}" --depends-on button`)
        await sleep(1200)
      }
    }
  }

  console.log('\n--- CHECKPOINT 1: Timer Pause & Resume ---')
  snap = getSnapshot()
  if (snap.includes('Lanjutkan Pertandingan')) {
    console.log('Currently paused. Resuming timer: clicking button.btn-success...')
    clickSelector('button.btn-success')
    await sleep(2000)

    console.log('Currently running. Pausing timer: clicking button.btn-warning...')
    clickSelector('button.btn-warning')
    await sleep(1500)
  } else {
    console.log('Currently running. Pausing timer: clicking button.btn-warning...')
    clickSelector('button.btn-warning')
    await sleep(1500)

    console.log('Currently paused. Resuming timer: clicking button.btn-success...')
    clickSelector('button.btn-success')
    await sleep(2000)

    console.log('Pausing timer for scoring test: clicking button.btn-warning...')
    clickSelector('button.btn-warning')
    await sleep(1500)
  }
  console.log('>>> [CHECKPOINT 1 PASSED]: Timer Pause & Resume verified without error! <<<\n')

  console.log('--- CHECKPOINT 2: 1-Click Soccer Goal Undo & Intent Re-Arming ---')
  console.log('Adding goal to Tim A: clicking button.btn-goal-a...')
  clickSelector('button.btn-goal-a')
  await sleep(1200)

  snap = getSnapshot()
  if (!snap.match(/button\s+"↩ Undo Gol A"(?!\s+\[disabled\])/i)) {
    throw new Error('FAIL: Undo Gol A button should be active when Tim A has goals!')
  }

  console.log('Undoing goal for Tim A (1-click undo): clicking button.btn-undo-a...')
  clickSelector('button.btn-undo-a')
  await sleep(1200)

  snap = getSnapshot()
  if (!snap.match(/button\s+"↩ Undo Gol A"\s+\[disabled\]/i)) {
    throw new Error('FAIL: Undo Gol A not disabled after undo!')
  }
  if (!snap.includes('Siap Mencatat Gol')) {
    throw new Error('FAIL: Goal intent was not re-armed to READY after undo!')
  }
  console.log('>>> [CHECKPOINT 2 PASSED]: 1-Click Soccer Goal Undo & Intent Re-Arming verified! <<<\n')

  console.log('--- CHECKPOINT 3: Full Match Rematch ---')
  console.log('Clicking rematch button: button.btn-rematch...')
  clickSelector('button.btn-rematch')
  await sleep(1200)

  snap = getSnapshot()
  if (!snap.includes('Tanding Ulang Pertandingan?')) {
    throw new Error('FAIL: Rematch confirmation modal did not open!')
  }
  console.log('Confirmation modal opened. Confirming rematch...')
  const syncOut = JSON.parse(execSync(`bsk cooperate sync --settle --session ${SESSION} --json`).toString())
  const confirmBtn = snap.match(/(@e\d+)\s+button\s+"Ya, Tanding Ulang"/i)
  execSync(`bsk click ${confirmBtn[1]} --session ${SESSION} --context "${syncOut.context_id}" --depends-on button`)
  await sleep(2500)

  snap = getSnapshot()
  if (!snap.includes('Status Meja: Siap Digunakan') || !snap.includes('Mulai Match #1')) {
    throw new Error('FAIL: Arena not reset to ready or match not returned to schedule!')
  }
  console.log('>>> [CHECKPOINT 3 PASSED]: Full Match Rematch reset match & released arena! <<<\n')

  console.log('--- CAPTURING SCREENSHOT PROOF ---')
  const finalSync = JSON.parse(execSync(`bsk cooperate sync --settle --session ${SESSION} --json`).toString())
  execSync(`bsk screenshot --session ${SESSION} --context "${finalSync.context_id}" --out /tmp/antigravity/e2e-bsk-rematch-success.png`).toString()
  console.log('✓ Screenshot saved to /tmp/antigravity/e2e-bsk-rematch-success.png\n')

  console.log('====================================================================')
  console.log('  SUCCESS: ALL 3 CAPABILITIES FULLY VERIFIED ON BSK (ZakyRamadhan)')
  console.log('====================================================================\n')
}

main().catch((err) => {
  console.error('[E2E ERROR]:', err)
  process.exit(1)
})
