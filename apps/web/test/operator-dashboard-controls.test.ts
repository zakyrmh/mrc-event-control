import assert from 'node:assert/strict'
import test from 'node:test'

import { showsStandaloneNextRoundPreparation } from '../src/components/operator-dashboard-controls.ts'

test('intermission owns its round preparation control', () => {
  assert.equal(showsStandaloneNextRoundPreparation('INTERMISSION'), false)
})

test('ready phase can show the standalone next-round control', () => {
  assert.equal(showsStandaloneNextRoundPreparation('READY'), true)
})
