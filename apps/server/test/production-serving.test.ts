import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { buildServer } from '../src/app.js'

describe('Production Static Serving & Routing Safety (004 O-05 / TC-20 / OB-05)', () => {
  let staticDir: string
  let server: ReturnType<typeof buildServer>

  before(async () => {
    staticDir = await mkdtemp(join(tmpdir(), 'mrc-x-static-'))
    await writeFile(
      join(staticDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>MRC X Control</title></head><body><div id="root"></div></body></html>',
    )
    await mkdir(join(staticDir, 'assets'), { recursive: true })
    await writeFile(
      join(staticDir, 'assets', 'style.css'),
      'body { background: #f6f5f4; }',
    )

    server = buildServer({
      staticRoot: staticDir,
      readiness: () => ({ ready: true, details: { test: 'ok' } }),
    })
    await server.ready()
  })

  after(async () => {
    await server.close()
  })

  it('serves index.html for root path /', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/',
    })
    assert.equal(res.statusCode, 200)
    assert.ok(res.headers['content-type']?.includes('text/html'))
    assert.ok(res.body.includes('<title>MRC X Control</title>'))
  })

  it('serves index.html as SPA fallback for non-API client routes like /overlay', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/overlay',
    })
    assert.equal(res.statusCode, 200)
    assert.ok(res.headers['content-type']?.includes('text/html'))
    assert.ok(res.body.includes('<title>MRC X Control</title>'))
  })

  it('serves static assets directly with correct content types', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/assets/style.css',
    })
    assert.equal(res.statusCode, 200)
    assert.ok(res.headers['content-type']?.includes('text/css'))
    assert.ok(res.body.includes('#f6f5f4'))
  })

  it('NEVER falls back to HTML for missing /api routes and returns strict JSON error envelope (TC-20)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/non-existent-action',
    })
    assert.equal(res.statusCode, 404)
    assert.ok(res.headers['content-type']?.includes('application/json'))

    const body = JSON.parse(res.body)
    assert.equal(body.error.code, 'NOT_FOUND')
    assert.equal(body.error.message, 'Endpoint tidak ditemukan.')
    assert.equal(res.body.includes('<!DOCTYPE html>'), false)
  })

  it('NEVER falls back to HTML for missing /socket.io paths (TC-20)', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/socket.io/invalid',
    })
    assert.equal(res.statusCode, 404)
    assert.ok(res.headers['content-type']?.includes('application/json'))
    assert.equal(res.body.includes('<!DOCTYPE html>'), false)
  })

  it('serves health and readiness checks without HTML interference', async () => {
    const health = await server.inject({ method: 'GET', url: '/healthz' })
    assert.equal(health.statusCode, 200)
    assert.equal(JSON.parse(health.body).status, 'ok')

    const ready = await server.inject({ method: 'GET', url: '/readyz' })
    assert.equal(ready.statusCode, 200)
    assert.equal(JSON.parse(ready.body).status, 'ready')
  })
})
