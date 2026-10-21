import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildServer } from './app.js'
import { BroadcastService } from './broadcast-service.js'
import {
  InMemoryControlSocketRegistry,
  registerControlSockets,
} from './control-sockets.js'
import { DatabaseConnection } from './database.js'
import { assertSupportedNode } from './runtime.js'

const defaultHost = '127.0.0.1'
const defaultPort = 3000

export interface StartServerOptions {
  host?: string
  port?: number
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return defaultPort
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('PORT must be an integer between 0 and 65535')
  }

  return port
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<void> {
  assertSupportedNode()

  const host = options.host ?? process.env.HOST ?? defaultHost
  const port = options.port ?? parsePort(process.env.PORT)
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl === undefined) {
    throw new Error('DATABASE_URL is required')
  }
  const connection = new DatabaseConnection(databaseUrl)
  await connection.connect()
  const configuredOrigins = process.env.ALLOWED_ORIGINS?.split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
  const allowedOrigins = configuredOrigins?.length
    ? configuredOrigins
    : [`http://${host}:${port}`]
  const controlSockets = new InMemoryControlSocketRegistry()
  const defaultStaticRoot = fileURLToPath(new URL('../../web/dist', import.meta.url))
  const staticRoot =
    process.env.STATIC_ROOT ?? (existsSync(defaultStaticRoot) ? defaultStaticRoot : undefined)

  const broadcastService = new BroadcastService({
    client: connection.client,
    runtimeId: `runtime-${Date.now()}`,
  })

  const server = buildServer({
    auth: {
      allowedOrigins,
      client: connection.client,
      controlSockets,
      secureCookies: process.env.COOKIE_SECURE === 'true',
    },
    broadcastService,
    staticRoot,
    logger: true,
    readiness: async () => {
      try {
        await connection.client.$queryRawUnsafe('SELECT 1')
        return { ready: true, details: { database: 'connected' } }
      } catch {
        return { ready: false, reason: 'Database connection is unavailable' }
      }
    },
  })
  const io = registerControlSockets(server.server, {
    allowedOrigins,
    client: connection.client,
    registry: controlSockets,
  })
  broadcastService.attachSocketServer(io)

  server.addHook('onClose', async () => broadcastService.stopHeartbeat())
  server.addHook('onClose', async () => io.close())
  server.addHook('onClose', async () => connection.disconnect())

  try {
    await server.listen({ host, port })
  } catch (error) {
    await connection.disconnect()
    throw error
  }
}

const entrypoint = process.argv[1]
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error'
    process.stderr.write(`Server startup failed: ${message}\n`)
    process.exitCode = 1
  })
}
