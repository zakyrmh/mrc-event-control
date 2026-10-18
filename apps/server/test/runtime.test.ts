import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  assertSupportedNode,
  parseNodeMajor,
  supportedNodeMajor,
} from '../src/runtime.js'

describe('runtime compatibility guard', () => {
  it('accepts the supported Node major', () => {
    assert.doesNotThrow(() => assertSupportedNode(`${supportedNodeMajor}.0.0`))
  })

  it('rejects a different Node major with an actionable message', () => {
    assert.throws(
      () => assertSupportedNode('22.12.0'),
      /Unsupported Node\.js 22\.12\.0; expected major 24/,
    )
  })

  it('rejects malformed version strings', () => {
    assert.throws(() => parseNodeMajor('unknown'), /Invalid Node\.js version/)
  })
})
