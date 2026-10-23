import type { FastifyInstance } from 'fastify'
import { broadcastModeSchema, obsTelemetryInputSchema } from '@mrc-x/shared'
import type { BroadcastService } from './broadcast-service.js'

export function registerBroadcastRoutes(
  server: FastifyInstance,
  broadcastService: BroadcastService,
): void {
  // 1. GET /api/v1/broadcast/main — Public Broadcast Snapshot (No-Store)
  server.get<{ Querystring: { arena?: string } }>('/api/v1/broadcast/main', async (request, reply) => {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate')
    const arenaId = request.query?.arena
    const snapshot = await broadcastService.projection.getPublicSnapshot(arenaId)
    return snapshot
  })

  // 2. GET /api/v1/broadcast/telemetry — Status OBS untuk Dashboard Operator
  server.get('/api/v1/broadcast/telemetry', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return broadcastService.getObsStatusSummary()
  })

  // 3. POST /api/v1/broadcast/ack — Telemetri dari OBS Browser Source / Preview
  server.post('/api/v1/broadcast/ack', async (request, reply) => {
    const parse = obsTelemetryInputSchema.safeParse(request.body)
    if (!parse.success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_INPUT',
          message: 'Data telemetri OBS tidak valid.',
        },
      })
    }

    broadcastService.recordTelemetry(parse.data)
    return reply.code(200).send({ ok: true })
  })

  // 4. POST /api/v1/broadcast/mode — Pengaturan Mode Siaran (AUTO / WAITING / EMERGENCY)
  server.post('/api/v1/broadcast/mode', async (request, reply) => {
    const body = request.body as { mode?: unknown }
    const parse = broadcastModeSchema.safeParse(body?.mode)
    if (!parse.success) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_INPUT',
          message: 'Mode siaran tidak valid. Pilihan: AUTO, WAITING, EMERGENCY.',
        },
      })
    }

    const snapshot = await broadcastService.setBroadcastMode(parse.data)
    return reply.code(200).send({
      mode: snapshot.mode,
      broadcastRevision: snapshot.broadcastRevision,
    })
  })
}
