import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { describe, it } from 'node:test'

import { apiErrorEnvelopeSchema } from '@mrc-x/shared/server'

import { buildServer } from '../src/app.js'

describe('server bootstrap', () => {
  it('serves health and readiness without opening a network port', async () => {
    const server = buildServer()

    const health = await server.inject({ method: 'GET', url: '/health' })
    const readiness = await server.inject({ method: 'GET', url: '/readiness' })

    assert.equal(health.statusCode, 200)
    assert.deepEqual(health.json(), { status: 'ok' })
    assert.equal(readiness.statusCode, 200)
    assert.deepEqual(readiness.json(), {
      status: 'ready',
      details: { runtime: 'ready' },
    })

    await server.close()
  })

  it('reports an explicit unavailable readiness result', async () => {
    const server = buildServer({
      readiness: () => ({
        ready: false,
        reason: 'password=hunter2 SELECT * FROM users internal-stack',
        details: { storage: 'SQLITE_BUSY at secret/path.ts:42' },
      }),
    })

    const response = await server.inject({ method: 'GET', url: '/readiness' })

    assert.equal(response.statusCode, 503)
    assert.deepEqual(response.json(), {
      status: 'not_ready',
      reason: 'Kesiapan layanan belum terpenuhi.',
      details: {},
    })
    assert.doesNotMatch(
      response.body,
      /hunter2|SELECT|internal-stack|SQLITE_BUSY|secret\/path/,
    )

    await server.close()
  })

  it('returns the shared error envelope for an unknown endpoint', async () => {
    const server = buildServer()

    const response = await server.inject({ method: 'GET', url: '/missing' })
    const body = apiErrorEnvelopeSchema.parse(response.json())

    assert.equal(response.statusCode, 404)
    assert.equal(body.error.code, 'NOT_FOUND')
    assert.equal(body.error.retryable, false)
    assert.ok(body.error.requestId.length > 0)

    await server.close()
  })

  it('returns a safe invalid-input envelope for malformed JSON', async () => {
    const server = buildServer()
    server.post('/input', async () => ({ accepted: true }))

    const response = await server.inject({
      method: 'POST',
      url: '/input',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    })
    const body = apiErrorEnvelopeSchema.parse(response.json())

    assert.equal(response.statusCode, 400)
    assert.equal(body.error.code, 'INVALID_INPUT')
    assert.doesNotMatch(response.body, /Unexpected|position|SyntaxError/)

    await server.close()
  })

  it('does not expose internal error details in the response', async () => {
    let logs = ''
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString()
        callback()
      },
    })
    const server = buildServer({ logger: { stream: logStream } })
    server.get('/failure', async () => {
      throw new Error('password=hunter2 SELECT * FROM users internal-stack')
    })

    const response = await server.inject({ method: 'GET', url: '/failure' })
    const body = apiErrorEnvelopeSchema.parse(response.json())

    assert.equal(response.statusCode, 500)
    assert.equal(body.error.code, 'INTERNAL_ERROR')
    assert.doesNotMatch(response.body, /hunter2|SELECT|internal-stack/)
    assert.match(logs, /Unhandled request error|INTERNAL_ERROR/)
    assert.doesNotMatch(logs, /hunter2|SELECT|internal-stack/)

    await server.close()
  })
})
