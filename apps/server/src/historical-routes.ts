import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient } from '@prisma/client'

function errorResponse(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  extra?: Record<string, unknown>,
) {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      requestId,
      retryable: false,
      ...extra,
    },
  })
}

export interface HistoricalRecordInput {
  eventId: string
  recordId: string
  matchId: string
  occurredAt: string
  refereeReference: string
  authorityReference: string
  decisionText: string
  winnerTeamId?: string | null
  finalGoalsA?: number | null
  finalGoalsB?: number | null
  supersedesRecordId?: string | null
}

interface HistoricalBatchJob {
  batchId: string
  batchHash: string
  records: HistoricalRecordInput[]
  valid: boolean
  errors: Array<{ recordId: string; message: string }>
}

const batchCache = new Map<string, HistoricalBatchJob>()

export function registerHistoricalRoutes(server: FastifyInstance, client: PrismaClient): void {
  // POST /api/v1/historical-imports/preview (Super Admin only, maintenance mode)
  server.post(
    '/api/v1/historical-imports/preview',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const body = request.body as { records?: HistoricalRecordInput[] } | null
      const records = body?.records

      if (!Array.isArray(records) || records.length === 0) {
        return errorResponse(reply, 422, 'INVALID_INPUT', 'Daftar records wajib diisi dalam array non-kosong.', request.id)
      }

      const errors: Array<{ recordId: string; message: string }> = []
      const seenEventRecordPairs = new Set<string>()

      for (const rec of records) {
        if (!rec.eventId || !rec.recordId || !rec.matchId || !rec.occurredAt || !rec.refereeReference || !rec.decisionText) {
          errors.push({ recordId: rec.recordId ?? 'unknown', message: 'Field wajib tidak lengkap pada catatan historis.' })
          continue
        }

        const pairKey = `${rec.eventId}:${rec.recordId}`
        if (seenEventRecordPairs.has(pairKey)) {
          errors.push({ recordId: rec.recordId, message: 'Duplikasi eventId dan recordId dalam satu batch.' })
        }
        seenEventRecordPairs.add(pairKey)

        const match = await client.match.findUnique({ where: { id: rec.matchId } })
        if (!match) {
          errors.push({ recordId: rec.recordId, message: `Match ${rec.matchId} tidak ditemukan.` })
        }
      }

      const batchId = randomUUID()
      const batchHash = createHash('sha256').update(JSON.stringify(records)).digest('hex')
      const job: HistoricalBatchJob = {
        batchId,
        batchHash,
        records,
        valid: errors.length === 0,
        errors,
      }
      batchCache.set(batchId, job)

      return reply.code(200).send({
        batchId,
        batchHash,
        valid: job.valid,
        recordsCount: records.length,
        errors,
      })
    },
  )

  // POST /api/v1/historical-imports/:batchId/commit (All-or-Nothing commit)
  server.post(
    '/api/v1/historical-imports/:batchId/commit',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest<{ Params: { batchId: string } }>, reply) => {
      const batchId = request.params.batchId
      const body = request.body as { expectedBatchHash?: string } | null
      const expectedBatchHash = body?.expectedBatchHash

      const job = batchCache.get(batchId)
      if (!job) {
        return errorResponse(reply, 404, 'NOT_FOUND', 'Batch import tidak ditemukan atau telah kadaluarsa.', request.id)
      }
      if (!job.valid) {
        return errorResponse(reply, 409, 'INVALID_BATCH', 'Batch import memiliki error validasi dan tidak dapat di-commit.', request.id, { errors: job.errors })
      }
      if (expectedBatchHash && job.batchHash !== expectedBatchHash) {
        return errorResponse(reply, 409, 'HASH_MISMATCH', 'Hash batch tidak sesuai dengan pratinjau.', request.id)
      }

      // Check maintenance mode: no match actively running in arena
      const activeArena = await client.arenaState.findUnique({ where: { id: 'main' } })
      if (activeArena?.activeMatchId) {
        const activeMatch = await client.match.findUnique({ where: { id: activeArena.activeMatchId } })
        if (activeMatch && (activeMatch.status === 'IN_PROGRESS' || activeMatch.status === 'PREPARING')) {
          return errorResponse(reply, 409, 'MAINTENANCE_REQUIRED', 'Import historis hanya dapat dijalankan saat maintenance (tidak ada match aktif di arena).', request.id)
        }
      }

      // Execute All-or-Nothing transaction
      await client.$transaction(async (tx) => {
        for (const rec of job.records) {
          const match = await tx.match.findUniqueOrThrow({ where: { id: rec.matchId } })
          const maxRev = await tx.resultRevision.aggregate({
            where: { matchId: match.id },
            _max: { revision: true },
          })
          const nextRev = (maxRev._max.revision ?? 0) + 1

          // Supersede any older final
          await tx.resultRevision.updateMany({
            where: { matchId: match.id, status: 'FINAL' },
            data: { status: 'SUPERSEDED' },
          })

          const revId = randomUUID()
          await tx.resultRevision.create({
            data: {
              id: revId,
              matchId: match.id,
              revision: nextRev,
              status: 'FINAL',
              decisionText: rec.decisionText,
              winnerTeamId: rec.winnerTeamId ?? null,
              finalGoalsA: rec.finalGoalsA ?? null,
              finalGoalsB: rec.finalGoalsB ?? null,
              refereeReference: rec.refereeReference,
              authorityReference: rec.authorityReference,
              finalizedAt: new Date(rec.occurredAt),
              finalizedBy: request.authPrincipal?.userId ?? null,
            },
          })

          await tx.match.update({
            where: { id: match.id },
            data: {
              status: 'COMPLETED',
              phase: 'FINISHED',
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'historical.import',
              resourceType: 'ResultRevision',
              resourceId: revId,
              actorId: request.authPrincipal?.userId ?? null,
              reason: 'Import data historis formulir rekaman juri (REC)',
              authorityReference: rec.authorityReference,
              afterJson: JSON.stringify({ eventId: rec.eventId, recordId: rec.recordId, matchId: match.id, revision: nextRev }),
            },
          })
        }
      })

      batchCache.delete(batchId)

      return reply.code(200).send({
        committed: true,
        batchId,
        recordsCount: job.records.length,
      })
    },
  )
}
