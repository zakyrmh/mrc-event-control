import { pathToFileURL } from 'node:url'

import { buildServer } from './app.js'
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

  const server = buildServer({ logger: true })
  const host = options.host ?? process.env.HOST ?? defaultHost
  const port = options.port ?? parsePort(process.env.PORT)

  await server.listen({ host, port })
}

const entrypoint = process.argv[1]
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error'
    process.stderr.write(`Server startup failed: ${message}\n`)
    process.exitCode = 1
  })
}
