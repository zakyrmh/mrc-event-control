import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import Database from 'better-sqlite3'
import { io as connectSocket, type Socket } from 'socket.io-client'

import { buildServer } from '../src/app.js'
import { bootstrapAdmin, hashPassword } from '../src/auth.js'
import {
  InMemoryControlSocketRegistry,
  registerControlSockets,
} from '../src/control-sockets.js'
import { DatabaseConnection } from '../src/database.js'

const migrationUrl = new URL(
  '../prisma/migrations/20261018190000_initial_foundation/migration.sql',
  import.meta.url,
)
const origin = 'http://127.0.0.1:3000'

function cookie(response: { headers: Record<string, number | string | string[] | undefined> }): string {
  const value = response.headers['set-cookie']
  const header = Array.isArray(value) ? value[0] : String(value ?? '')
  assert.ok(header)
  return header.split(';', 1)[0] ?? ''
}

function waitForSocket(socket: Socket, event: 'connect' | 'disconnect'): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for socket ${event}`)), 2_000)
    socket.once(event, () => {
      clearTimeout(timeout)
      resolve()
    })
    socket.once('connect_error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

async function login(
  server: ReturnType<typeof buildServer>,
  username: string,
  password: string,
): Promise<{ cookie: string; csrfToken: string }> {
  const bootstrap = await server.inject({ method: 'GET', url: '/api/v1/auth/bootstrap' })
  const response = await server.inject({
    headers: { cookie: cookie(bootstrap), origin, 'x-csrf-token': bootstrap.json().csrfToken as string },
    method: 'POST',
    payload: { password, username },
    url: '/api/v1/auth/login',
  })
  assert.equal(response.statusCode, 200)
  return { cookie: cookie(response), csrfToken: response.json().csrfToken as string }
}

describe('AUTH foundation (TC-18/TC-35)', () => {
  let connection: DatabaseConnection

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-f06-'))
    const databasePath = join(directory, 'auth.db')
    const migration = await readFile(migrationUrl, 'utf8')
    const bootstrap = new Database(databasePath)
    bootstrap.exec(migration)
    bootstrap.close()
    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()
    await connection.client.user.create({
      data: {
        id: 'operator',
        passwordHash: await hashPassword('operator-password'),
        role: 'OPERATOR',
        username: 'operator',
      },
    })
  })

  after(async () => connection.disconnect())

  it('bootstraps exactly one admin without a default credential', async () => {
    const first = await bootstrapAdmin(connection.client, 'admin', 'unique-admin-password')
    const second = await bootstrapAdmin(connection.client, 'ignored', 'another-admin-password')
    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(second.userId, first.userId)
    assert.equal(await connection.client.user.count({ where: { role: 'SUPER_ADMIN' } }), 1)
  })

  it('rotates anonymous cookie and CSRF during login and rejects reuse', async () => {
    const server = buildServer({ auth: { allowedOrigins: [origin], client: connection.client } })
    const bootstrap = await server.inject({ method: 'GET', url: '/api/v1/auth/bootstrap' })
    const anonymousCookie = cookie(bootstrap)
    const anonymousCsrf = bootstrap.json().csrfToken as string
    assert.equal(bootstrap.headers['cache-control'], 'no-store')

    const login = await server.inject({
      headers: { cookie: anonymousCookie, origin, 'x-csrf-token': anonymousCsrf },
      method: 'POST',
      payload: { password: 'operator-password', username: 'operator' },
      url: '/api/v1/auth/login',
    })
    assert.equal(login.statusCode, 200)
    assert.notEqual(cookie(login), anonymousCookie)
    assert.notEqual(login.json().csrfToken, anonymousCsrf)

    const reused = await server.inject({
      headers: { cookie: anonymousCookie, origin, 'x-csrf-token': anonymousCsrf },
      method: 'POST',
      payload: { password: 'operator-password', username: 'operator' },
      url: '/api/v1/auth/login',
    })
    assert.equal(reused.statusCode, 403)
    await server.close()
  })

  it('enforces Origin, CSRF, direct role bypass, and operator emergency rights', async () => {
    const server = buildServer({ auth: { allowedOrigins: [origin], client: connection.client } })
    server.post('/test/admin', { config: { auth: { roles: ['SUPER_ADMIN'] } } }, async () => ({ ok: true }))
    server.post('/test/emergency', { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } }, async () => ({ ok: true }))
    const bootstrap = await server.inject({ method: 'GET', url: '/api/v1/auth/bootstrap' })
    const anonymousCookie = cookie(bootstrap)
    const anonymousCsrf = bootstrap.json().csrfToken as string
    const wrongOrigin = await server.inject({
      headers: { cookie: anonymousCookie, origin: 'http://evil.invalid', 'x-csrf-token': anonymousCsrf },
      method: 'POST', payload: { password: 'operator-password', username: 'operator' }, url: '/api/v1/auth/login',
    })
    assert.equal(wrongOrigin.statusCode, 403)
    const login = await server.inject({
      headers: { cookie: anonymousCookie, origin, 'x-csrf-token': anonymousCsrf },
      method: 'POST', payload: { password: 'operator-password', username: 'operator' }, url: '/api/v1/auth/login',
    })
    const operatorCookie = cookie(login)
    const csrf = login.json().csrfToken as string
    const admin = await server.inject({ headers: { cookie: operatorCookie, origin, 'x-csrf-token': csrf }, method: 'POST', url: '/test/admin' })
    const emergency = await server.inject({ headers: { cookie: operatorCookie, origin, 'x-csrf-token': csrf }, method: 'POST', url: '/test/emergency' })
    const badToken = await server.inject({ headers: { cookie: operatorCookie, origin, 'x-csrf-token': 'wrong' }, method: 'POST', url: '/test/emergency' })
    assert.equal(admin.statusCode, 403)
    assert.equal(emergency.statusCode, 200)
    assert.equal(badToken.statusCode, 403)
    await server.close()
  })

  it('denies disabled/expired sessions and revokes control sockets on logout', async () => {
    const registry = new InMemoryControlSocketRegistry()
    const server = buildServer({
      auth: {
        allowedOrigins: [origin],
        client: connection.client,
        controlSockets: registry,
      },
    })
    const io = registerControlSockets(server.server, { allowedOrigins: [origin], client: connection.client, registry })
    server.addHook('onClose', async () => io.close())
    server.get('/test/control', { config: { auth: { roles: ['OPERATOR'] } } }, async () => ({ ok: true }))
    const address = await server.listen({ host: '127.0.0.1', port: 0 })
    const bootstrap = await server.inject({ method: 'GET', url: '/api/v1/auth/bootstrap' })
    const login = await server.inject({
      headers: { cookie: cookie(bootstrap), origin, 'x-csrf-token': bootstrap.json().csrfToken as string },
      method: 'POST', payload: { password: 'operator-password', username: 'operator' }, url: '/api/v1/auth/login',
    })
    const authenticatedCookie = cookie(login)
    const csrf = login.json().csrfToken as string
    const socket = connectSocket(`${address}/control`, {
      auth: { csrfToken: csrf },
      extraHeaders: { Cookie: authenticatedCookie, Origin: origin },
      transports: ['websocket'],
    })
    await waitForSocket(socket, 'connect')
    const disconnected = waitForSocket(socket, 'disconnect')
    const logout = await server.inject({
      headers: { cookie: authenticatedCookie, origin, 'x-csrf-token': csrf }, method: 'POST', url: '/api/v1/auth/logout',
    })
    assert.equal(logout.statusCode, 204)
    await disconnected
    assert.equal(socket.connected, false)
    assert.equal((await server.inject({ headers: { cookie: authenticatedCookie }, method: 'GET', url: '/test/control' })).statusCode, 401)

    await connection.client.user.update({ data: { enabled: false }, where: { id: 'operator' } })
    const disabledBootstrap = await server.inject({ method: 'GET', url: '/api/v1/auth/bootstrap' })
    const disabledLogin = await server.inject({
      headers: { cookie: cookie(disabledBootstrap), origin, 'x-csrf-token': disabledBootstrap.json().csrfToken as string },
      method: 'POST', payload: { password: 'operator-password', username: 'operator' }, url: '/api/v1/auth/login',
    })
    assert.equal(disabledLogin.statusCode, 401)
    socket.close()
    await server.close()
  })

  it('creates and disables an operator account while revoking its real control socket', async () => {
    const registry = new InMemoryControlSocketRegistry()
    const server = buildServer({ auth: { allowedOrigins: [origin], client: connection.client, controlSockets: registry } })
    const io = registerControlSockets(server.server, { allowedOrigins: [origin], client: connection.client, registry })
    server.addHook('onClose', async () => io.close())
    const address = await server.listen({ host: '127.0.0.1', port: 0 })
    const admin = await login(server, 'admin', 'unique-admin-password')
    const created = await server.inject({
      headers: { cookie: admin.cookie, origin, 'x-csrf-token': admin.csrfToken },
      method: 'POST',
      payload: { password: 'fixture-operator-password', role: 'OPERATOR', username: 'fixture-operator' },
      url: '/api/v1/users',
    })
    assert.equal(created.statusCode, 201)
    const operator = await login(server, 'fixture-operator', 'fixture-operator-password')
    const socket = connectSocket(`${address}/control`, {
      auth: { csrfToken: operator.csrfToken },
      extraHeaders: { Cookie: operator.cookie, Origin: origin },
      transports: ['websocket'],
    })
    await waitForSocket(socket, 'connect')
    const disconnected = waitForSocket(socket, 'disconnect')

    const disabled = await server.inject({
      headers: { cookie: admin.cookie, origin, 'x-csrf-token': admin.csrfToken },
      method: 'PATCH',
      payload: { enabled: false, expectedRevision: 1 },
      url: `/api/v1/users/${created.json().id as string}`,
    })
    assert.equal(disabled.statusCode, 200)
    assert.equal(disabled.json().enabled, false)
    await disconnected
    assert.equal(socket.connected, false)
    socket.close()
    await server.close()
  })

  it('rejects bad control handshakes and disconnects a control socket at session expiry', async () => {
    await connection.client.user.update({ data: { enabled: true }, where: { id: 'operator' } })
    const registry = new InMemoryControlSocketRegistry()
    const server = buildServer({
      auth: {
        allowedOrigins: [origin],
        client: connection.client,
        controlSockets: registry,
        sessionDurationMs: 300,
      },
    })
    const io = registerControlSockets(server.server, { allowedOrigins: [origin], client: connection.client, registry })
    server.addHook('onClose', async () => io.close())
    const address = await server.listen({ host: '127.0.0.1', port: 0 })
    const operator = await login(server, 'operator', 'operator-password')
    const rejected = connectSocket(`${address}/control`, {
      auth: { csrfToken: 'wrong' },
      extraHeaders: { Cookie: operator.cookie, Origin: origin },
      reconnection: false,
      transports: ['websocket'],
    })
    await assert.rejects(waitForSocket(rejected, 'connect'), /UNAUTHORIZED/)
    rejected.close()

    const wrongOrigin = connectSocket(`${address}/control`, {
      auth: { csrfToken: operator.csrfToken },
      extraHeaders: { Cookie: operator.cookie, Origin: 'http://evil.invalid' },
      reconnection: false,
      transports: ['websocket'],
    })
    await assert.rejects(waitForSocket(wrongOrigin, 'connect'), /UNAUTHORIZED/)
    wrongOrigin.close()

    const socket = connectSocket(`${address}/control`, {
      auth: { csrfToken: operator.csrfToken },
      extraHeaders: { Cookie: operator.cookie, Origin: origin },
      reconnection: false,
      transports: ['websocket'],
    })
    await waitForSocket(socket, 'connect')
    await waitForSocket(socket, 'disconnect')
    assert.equal(socket.connected, false)
    socket.close()

    const expired = connectSocket(`${address}/control`, {
      auth: { csrfToken: operator.csrfToken },
      extraHeaders: { Cookie: operator.cookie, Origin: origin },
      reconnection: false,
      transports: ['websocket'],
    })
    await assert.rejects(waitForSocket(expired, 'connect'), /UNAUTHORIZED/)
    expired.close()
    await server.close()
  })
})
