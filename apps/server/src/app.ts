import { randomUUID } from 'node:crypto'

import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'
import type { ApiErrorEnvelope, FieldError } from '@mrc-x/shared/server'

export type ReadinessResult =
  | { ready: true; details?: Record<string, string> }
  | { ready: false; reason: string; details?: Record<string, string> }

export interface BuildServerOptions {
  logger?: FastifyServerOptions['logger']
  readiness?: () => ReadinessResult | Promise<ReadinessResult>
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

  server.get('/readiness', async (_request, reply) => {
    const result = await readiness()

    if (!result.ready) {
      return reply.code(503).send({
        status: 'not_ready',
        reason: result.reason,
        details: result.details ?? {},
      })
    }

    return {
      status: 'ready',
      details: result.details ?? {},
    }
  })

  server.setNotFoundHandler((request, reply) => {
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

    request.log.error({ err: error }, 'Unhandled request error')
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
