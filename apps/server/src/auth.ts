import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'

import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

const scrypt = promisify(scryptCallback)
export const sessionCookie = 'mrc_session'
const defaultSessionDurationMs = 8 * 60 * 60 * 1_000
const anonymousDurationMs = 10 * 60 * 1_000

export type Role = 'OPERATOR' | 'SUPER_ADMIN'

export interface SessionPrincipal {
  role: Role
  sessionId: string
  userId: string
}

interface AnonymousSession {
  csrfHash: string
  expiresAt: number
  sessionHash: string
}

export interface ControlSocketRegistry {
  revokeSession(sessionId: string): void
}

export interface AuthOptions {
  allowedOrigins: readonly string[]
  client: PrismaClient
  clock?: () => Date
  controlSockets?: ControlSocketRegistry
  secureCookies?: boolean
  sessionDurationMs?: number
}

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function token(): string {
  return randomBytes(32).toString('base64url')
}

function csrfForSession(rawSession: string): string {
  return createHash('sha256').update(`csrf:${rawSession}`).digest('base64url')
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator > 0) {
      cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim())
    }
  }
  return cookies
}

function sessionCookieHeader(value: string, secure: boolean, maxAge: number): string {
  return `${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function clearSessionCookie(secure: boolean): string {
  return sessionCookieHeader('', secure, 0)
}

function originAllowed(request: FastifyRequest, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.origin
  return typeof origin === 'string' && allowedOrigins.includes(origin)
}

function csrfMatches(request: FastifyRequest, expectedHash: string): boolean {
  const supplied = request.headers['x-csrf-token']
  return typeof supplied === 'string' && digest(supplied) === expectedHash
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error('Password must contain at least 12 characters')
  }
  const salt = randomBytes(16)
  const derived = (await scrypt(password, salt, 64)) as Buffer
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, expectedText] = encoded.split('$')
  if (algorithm !== 'scrypt' || saltText === undefined || expectedText === undefined) {
    return false
  }
  const expected = Buffer.from(expectedText, 'base64url')
  const actual = (await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length)) as Buffer
  return timingSafeEqual(actual, expected)
}

export async function bootstrapAdmin(
  client: PrismaClient,
  username: string,
  password: string,
): Promise<{ created: boolean; userId: string }> {
  if (username.trim() === '') {
    throw new Error('Bootstrap username is required')
  }
  const existingAdmin = await client.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
  if (existingAdmin !== null) {
    return { created: false, userId: existingAdmin.id }
  }
  const userId = randomUUID()
  await client.$transaction(async (transaction) => {
    const concurrentAdmin = await transaction.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
    if (concurrentAdmin !== null) {
      throw new Error('A super-admin already exists')
    }
    await transaction.user.create({
      data: {
        id: userId,
        passwordHash: await hashPassword(password),
        role: 'SUPER_ADMIN',
        username: username.trim(),
      },
    })
    await transaction.auditEntry.create({
      data: {
        action: 'user.bootstrap',
        afterJson: JSON.stringify({ role: 'SUPER_ADMIN', username: username.trim() }),
        id: randomUUID(),
        resourceId: userId,
        resourceType: 'User',
      },
    })
  })
  return { created: true, userId }
}

export function registerAuth(server: FastifyInstance, options: AuthOptions): void {
  const anonymousSessions = new Map<string, AnonymousSession>()
  const clock = options.clock ?? (() => new Date())
  const secure = options.secureCookies ?? false
  const sessionDurationMs = options.sessionDurationMs ?? defaultSessionDurationMs

  const unauthorized = (reply: FastifyReply) => reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sesi tidak valid.' } })
  const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Permintaan tidak diizinkan.' } })

  async function principal(request: FastifyRequest): Promise<SessionPrincipal | null> {
    const raw = parseCookies(request.headers.cookie).get(sessionCookie)
    if (raw === undefined) return null
    const session = await options.client.session.findUnique({
      include: { user: true },
      where: { sessionHash: digest(raw) },
    })
    if (session === null || session.revokedAt !== null || session.expiresAt <= clock() || !session.user.enabled) {
      if (session !== null) options.controlSockets?.revokeSession(session.id)
      return null
    }
    if (session.user.role !== 'OPERATOR' && session.user.role !== 'SUPER_ADMIN') return null
    return { role: session.user.role, sessionId: session.id, userId: session.userId }
  }

  server.decorateRequest('authPrincipal', null)

  server.get('/api/v1/auth/bootstrap', async (_request, reply) => {
    const now = clock().getTime()
    if (anonymousSessions.size > 50) {
      for (const [key, session] of anonymousSessions) {
        if (session.expiresAt <= now) anonymousSessions.delete(key)
      }
    }
    if (anonymousSessions.size >= 500) {
      const oldestKey = anonymousSessions.keys().next().value
      if (oldestKey !== undefined) anonymousSessions.delete(oldestKey)
    }
    const rawSession = token()
    const csrf = csrfForSession(rawSession)
    anonymousSessions.set(digest(rawSession), {
      csrfHash: digest(csrf),
      expiresAt: clock().getTime() + anonymousDurationMs,
      sessionHash: digest(rawSession),
    })
    return reply
      .header('cache-control', 'no-store')
      .header('set-cookie', sessionCookieHeader(rawSession, secure, anonymousDurationMs / 1_000))
      .send({ csrfToken: csrf, expiresAt: new Date(clock().getTime() + anonymousDurationMs).toISOString() })
  })

  server.post<{ Body: { password?: string; username?: string } }>('/api/v1/auth/login', async (request, reply) => {
    if (!originAllowed(request, options.allowedOrigins)) return forbidden(reply)
    const rawAnonymous = parseCookies(request.headers.cookie).get(sessionCookie)
    const anonymous = rawAnonymous === undefined ? undefined : anonymousSessions.get(digest(rawAnonymous))
    if (anonymous === undefined || anonymous.expiresAt <= clock().getTime() || !csrfMatches(request, anonymous.csrfHash)) {
      return forbidden(reply)
    }
    const username = request.body?.username
    const password = request.body?.password
    if (typeof username !== 'string' || typeof password !== 'string') return forbidden(reply)
    const user = await options.client.user.findUnique({ where: { username } })
    if (user === null || !user.enabled || !(await verifyPassword(password, user.passwordHash))) return unauthorized(reply)

    anonymousSessions.delete(anonymous.sessionHash)
    const rawSession = token()
    const csrf = csrfForSession(rawSession)
    const expiresAt = new Date(clock().getTime() + sessionDurationMs)
    const session = await options.client.session.create({
      data: { csrfHash: digest(csrf), expiresAt, id: randomUUID(), sessionHash: digest(rawSession), userId: user.id },
    })
    return reply
      .header('cache-control', 'no-store')
      .header('set-cookie', sessionCookieHeader(rawSession, secure, sessionDurationMs / 1_000))
      .send({ csrfToken: csrf, expiresAt: expiresAt.toISOString(), role: user.role, sessionId: session.id })
  })

  server.get('/api/v1/auth/me', async (request, reply) => {
    const authenticated = await principal(request)
    if (authenticated === null) return unauthorized(reply)
    const raw = parseCookies(request.headers.cookie).get(sessionCookie)
    const session = await options.client.session.findUniqueOrThrow({ where: { sessionHash: digest(raw ?? '') } })
    return reply.header('cache-control', 'no-store').send({
      csrfToken: csrfForSession(raw ?? ''),
      expiresAt: session.expiresAt.toISOString(),
      role: authenticated.role,
      userId: authenticated.userId,
    })
  })

  server.post('/api/v1/auth/logout', async (request, reply) => {
    if (!originAllowed(request, options.allowedOrigins)) return forbidden(reply)
    const authenticated = await principal(request)
    if (authenticated === null) return unauthorized(reply)
    const session = await options.client.session.findUniqueOrThrow({ where: { id: authenticated.sessionId } })
    if (!csrfMatches(request, session.csrfHash)) return forbidden(reply)
    await options.client.session.update({ data: { revokedAt: clock() }, where: { id: authenticated.sessionId } })
    options.controlSockets?.revokeSession(authenticated.sessionId)
    return reply.header('set-cookie', clearSessionCookie(secure)).code(204).send()
  })

  server.post<{ Body: { password?: string; role?: string; username?: string } }>(
    '/api/v1/users',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const { password, role, username } = request.body ?? {}
      if (
        typeof username !== 'string' || username.trim() === '' ||
        typeof password !== 'string' ||
        (role !== 'OPERATOR' && role !== 'SUPER_ADMIN')
      ) return reply.code(400).send({ error: { code: 'INVALID_INPUT', message: 'Data akun tidak valid.' } })
      const actor = request.authPrincipal
      if (actor === null) return unauthorized(reply)
      const userId = randomUUID()
      await options.client.$transaction([
        options.client.user.create({ data: { id: userId, passwordHash: await hashPassword(password), role, username: username.trim() } }),
        options.client.auditEntry.create({ data: {
          action: 'user.create', actorId: actor.userId,
          afterJson: JSON.stringify({ enabled: true, role, username: username.trim() }),
          id: randomUUID(), resourceId: userId, resourceType: 'User',
        } }),
      ])
      return reply.code(201).send({ enabled: true, id: userId, revision: 1, role, username: username.trim() })
    },
  )

  server.patch<{ Body: { enabled?: boolean; expectedRevision?: number; password?: string }; Params: { id: string } }>(
    '/api/v1/users/:id',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const actor = request.authPrincipal
      if (actor === null) return unauthorized(reply)
      const existing = await options.client.user.findUnique({ where: { id: request.params.id } })
      if (existing === null) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Akun tidak ditemukan.' } })
      if (request.body.expectedRevision !== existing.revision) {
        return reply.code(409).send({ error: { code: 'VERSION_CONFLICT', message: 'Revisi akun telah berubah.' } })
      }
      const passwordHash = request.body.password === undefined ? existing.passwordHash : await hashPassword(request.body.password)
      const enabled = request.body.enabled ?? existing.enabled
      const sessions = !enabled
        ? await options.client.session.findMany({ where: { revokedAt: null, userId: existing.id } })
        : []
      const now = clock()
      await options.client.$transaction(async (transaction) => {
        const updated = await transaction.user.updateMany({
          data: { enabled, passwordHash, revision: { increment: 1 } },
          where: { id: existing.id, revision: existing.revision },
        })
        if (updated.count !== 1) throw new Error('VERSION_CONFLICT')
        if (!enabled) await transaction.session.updateMany({ data: { revokedAt: now }, where: { revokedAt: null, userId: existing.id } })
        await transaction.auditEntry.create({ data: {
          action: enabled ? 'user.update' : 'user.disable', actorId: actor.userId,
          afterJson: JSON.stringify({ enabled, passwordChanged: request.body.password !== undefined }),
          beforeJson: JSON.stringify({ enabled: existing.enabled }), id: randomUUID(),
          resourceId: existing.id, resourceType: 'User',
        } })
      })
      for (const session of sessions) options.controlSockets?.revokeSession(session.id)
      return { enabled, id: existing.id, revision: existing.revision + 1, role: existing.role, username: existing.username }
    },
  )

  server.addHook('preHandler', async (request, reply) => {
    const config = request.routeOptions.config as { auth?: { roles: Role[] } }
    if (config.auth === undefined) return
    const authenticated = await principal(request)
    if (authenticated === null) return unauthorized(reply)
    if (!config.auth.roles.includes(authenticated.role)) return forbidden(reply)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (!originAllowed(request, options.allowedOrigins)) return forbidden(reply)
      const session = await options.client.session.findUniqueOrThrow({ where: { id: authenticated.sessionId } })
      if (!csrfMatches(request, session.csrfHash)) return forbidden(reply)
    }
    request.authPrincipal = authenticated
  })
}

declare module 'fastify' {
  interface FastifyRequest {
    authPrincipal: SessionPrincipal | null
  }
  interface FastifyContextConfig {
    auth?: { roles: Role[] }
  }
}
