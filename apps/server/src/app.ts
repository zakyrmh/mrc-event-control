import { randomUUID } from 'node:crypto'

import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'
import fastifyStatic from '@fastify/static'
import type { ApiErrorEnvelope, FieldError } from '@mrc-x/shared/server'
import type { PrismaClient } from '@prisma/client'
import { registerAuth, type AuthOptions } from './auth.js'
import { registerBroadcastRoutes } from './broadcast-routes.js'
import { BroadcastService } from './broadcast-service.js'
import { registerHistoricalRoutes } from './historical-routes.js'
import { registerMatchRoutes } from './match-routes.js'
import { registerTeamRoutes } from './team-routes.js'
import type { TimerService } from './timer-service.js'

export type ReadinessResult =
  | { ready: true; details?: Record<string, string> }
  | { ready: false; reason: string; details?: Record<string, string> }

export interface BuildServerOptions {
  auth?: AuthOptions
  client?: PrismaClient
  timerService?: TimerService
  broadcastService?: BroadcastService
  logger?: FastifyServerOptions['logger']
  readiness?: () => ReadinessResult | Promise<ReadinessResult>
  staticRoot?: string
}

const defaultReadiness = (): ReadinessResult => ({
  ready: true,
  details: { runtime: 'ready' },
})

function validationFieldErrors(error: unknown): FieldError[] | undefined {
  const fastifyError = error as FastifyError

  if (!fastifyError.validation) {
    return undefined
  }

  return fastifyError.validation.map((issue) => ({
    path: issue.instancePath
      .split('/')
      .filter(Boolean)
      .map((part) => decodeURIComponent(part)),
    message: issue.message ?? 'Nilai tidak valid',
  }))
}

function isInvalidInput(error: unknown): boolean {
  const fastifyError = error as FastifyError
  return (
    fastifyError.validation !== undefined ||
    fastifyError.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
  )
}

function errorEnvelope(
  requestId: string,
  code: ApiErrorEnvelope['error']['code'],
  message: string,
  retryable: boolean,
  fieldErrors?: FieldError[],
): ApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      requestId,
      retryable,
      ...(fieldErrors === undefined ? {} : { fieldErrors }),
    },
  }
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const readiness = options.readiness ?? defaultReadiness
  const server = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID(),
  })

  server.get('/health', async () => ({ status: 'ok' }))
  server.get('/healthz', async () => ({ status: 'ok' }))

  const handleReadiness = async (_request: any, reply: any) => {
    const result = await readiness()

    if (!result.ready) {
      return reply.code(503).send({
        status: 'not_ready',
        reason: 'Kesiapan layanan belum terpenuhi.',
        details: {},
      })
    }

    return {
      status: 'ready',
      details: result.details ?? {},
    }
  }

  server.get('/readiness', handleReadiness)
  server.get('/readyz', handleReadiness)

  if (options.auth !== undefined) {
    registerAuth(server, options.auth)
  }

  const client = options.client ?? options.auth?.client
  if (client !== undefined) {
    registerTeamRoutes(server, client)
    registerMatchRoutes(server, client, options.timerService)
    registerHistoricalRoutes(server, client)

    const broadcastService =
      options.broadcastService ??
      new BroadcastService({
        client,
        timerService: options.timerService,
        runtimeId: 'server-runtime-main',
      })
    registerBroadcastRoutes(server, broadcastService)
  }

  if (options.staticRoot) {
    server.register(fastifyStatic, {
      root: options.staticRoot,
      prefix: '/',
      wildcard: false,
    })
  }

  server.setNotFoundHandler((request, reply) => {
    // API & socket paths always return JSON 404 envelope, never fallback to HTML (OB-05 / TC-20)
    if (request.url.startsWith('/api') || request.url.startsWith('/socket.io')) {
      return reply.code(404).send(
        errorEnvelope(
          request.id,
          'NOT_FOUND',
          'Endpoint tidak ditemukan.',
          false,
        ),
      )
    }

    if (options.staticRoot) {
      return reply.sendFile('index.html')
    }

    return reply.code(404).send(
      errorEnvelope(
        request.id,
        'NOT_FOUND',
        'Endpoint tidak ditemukan.',
        false,
      ),
    )
  })

  server.setErrorHandler((error, request, reply) => {
    const fieldErrors = validationFieldErrors(error)

    if (isInvalidInput(error)) {
      return reply.code(400).send(
        errorEnvelope(
          request.id,
          'INVALID_INPUT',
          'Permintaan tidak valid.',
          false,
          fieldErrors,
        ),
      )
    }

    request.log.error(
      { requestId: request.id, code: 'INTERNAL_ERROR' },
      'Unhandled request error',
    )
    return reply.code(500).send(
      errorEnvelope(
        request.id,
        'INTERNAL_ERROR',
        'Terjadi kesalahan internal. Sampaikan requestId kepada IT.',
        false,
      ),
    )
  })

  return server
}
