import type { Server as HttpServer } from 'node:http'

import type { PrismaClient } from '@prisma/client'
import { Server } from 'socket.io'

import {
  digest,
  isLocalOrPrivateOrigin,
  parseCookies,
  sessionCookie,
  type ControlSocketRegistry,
} from './auth.js'

export interface ControlSocketOptions {
  allowedOrigins: readonly string[]
  client: PrismaClient
  clock?: () => Date
  registry: InMemoryControlSocketRegistry
}

export class InMemoryControlSocketRegistry implements ControlSocketRegistry {
  readonly #connections = new Map<string, Set<() => void>>()

  register(sessionId: string, disconnect: () => void): () => void {
    const connections = this.#connections.get(sessionId) ?? new Set()
    connections.add(disconnect)
    this.#connections.set(sessionId, connections)
    return () => {
      connections.delete(disconnect)
      if (connections.size === 0) this.#connections.delete(sessionId)
    }
  }

  revokeSession(sessionId: string): void {
    const connections = this.#connections.get(sessionId)
    this.#connections.delete(sessionId)
    for (const disconnect of connections ?? []) disconnect()
  }
}

export function registerControlSockets(
  server: HttpServer,
  options: ControlSocketOptions,
): Server {
  const clock = options.clock ?? (() => new Date())
  const io = new Server(server, { serveClient: false })
  const control = io.of('/control')

  control.use(async (socket, next) => {
    const origin = socket.handshake.headers.origin
    const csrfToken = socket.handshake.auth.csrfToken
    const rawSession = parseCookies(socket.handshake.headers.cookie).get(sessionCookie)
    if (
      typeof origin !== 'string' ||
      (!options.allowedOrigins.includes('*') && !options.allowedOrigins.includes(origin) && !isLocalOrPrivateOrigin(origin)) ||
      typeof csrfToken !== 'string' ||
      rawSession === undefined
    ) {
      next(new Error('UNAUTHORIZED'))
      return
    }

    const session = await options.client.session.findUnique({
      include: { user: true },
      where: { sessionHash: digest(rawSession) },
    })
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt <= clock() ||
      !session.user.enabled ||
      digest(csrfToken) !== session.csrfHash
    ) {
      next(new Error('UNAUTHORIZED'))
      return
    }

    socket.data.sessionId = session.id
    socket.data.expiresAt = session.expiresAt.getTime()
    next()
  })

  control.on('connection', (socket) => {
    const sessionId = socket.data.sessionId as string
    const expiresAt = socket.data.expiresAt as number
    const unregister = options.registry.register(sessionId, () => socket.disconnect(true))
    const expiryTimer = setTimeout(
      () => options.registry.revokeSession(sessionId),
      Math.max(0, expiresAt - clock().getTime()),
    )
    expiryTimer.unref()
    socket.once('disconnect', () => {
      clearTimeout(expiryTimer)
      unregister()
    })
  })

  return io
}
