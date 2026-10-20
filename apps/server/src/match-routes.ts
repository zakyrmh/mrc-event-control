import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  evaluateMatchTransition,
  type MatchPhase,
  type MatchStatus,
  type UserRole,
} from '@mrc-x/shared/server'
import type { TimerService } from './timer-service.js'

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

async function getOrCreateArena(client: Prisma.TransactionClient | PrismaClient) {
  let arena = await client.arenaState.findUnique({ where: { id: 'main' } })
  if (!arena) {
    arena = await client.arenaState.create({
      data: { id: 'main', arenaVersion: 1 },
    })
  }
  return arena
}

export function registerMatchRoutes(
  server: FastifyInstance,
  client: PrismaClient,
  timerService?: TimerService,
): void {
  // --- ARENA COMMANDS (match.select, match.release) ---
  server.post(
    '/api/v1/arenas/main/commands',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const body = request.body as Record<string, unknown> | null
      const action = body?.action
      const role = (request.authPrincipal?.role ?? 'OPERATOR') as UserRole

      if (action === 'match.select') {
        const matchId = body?.matchId as string
        const expectedArenaVersion = body?.expectedArenaVersion as number
        const expectedMatchVersion = body?.expectedMatchVersion as number

        if (!matchId || typeof expectedArenaVersion !== 'number' || typeof expectedMatchVersion !== 'number') {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'Parameter matchId, expectedArenaVersion, dan expectedMatchVersion wajib diisi.', request.id)
        }

        const arena = await getOrCreateArena(client)
        if (arena.arenaVersion !== expectedArenaVersion) {
          return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Arena version conflict.', request.id, { currentArenaVersion: arena.arenaVersion })
        }

        if (arena.activeMatchId && arena.activeMatchId !== matchId) {
          const activeMatch = await client.match.findUnique({ where: { id: arena.activeMatchId } })
          if (activeMatch && activeMatch.status !== 'COMPLETED' && activeMatch.status !== 'CANCELLED') {
            return errorResponse(reply, 409, 'ARENA_BUSY', 'Arena utama sedang digunakan oleh pertandingan lain yang belum selesai.', request.id)
          }
        }

        const match = await client.match.findUnique({
          where: { id: matchId },
          include: { teamA: true, teamB: true },
        })
        if (!match) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Match tidak ditemukan.', request.id)
        }
        if (match.matchVersion !== expectedMatchVersion) {
          return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Match version conflict.', request.id, { currentMatchVersion: match.matchVersion })
        }

        const transitionCmd = match.status === 'POSTPONED' ? { type: 'select-resume' as const } : { type: 'select' as const }
        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          transitionCmd,
          { role, hasStarted: match.hasStarted },
        )

        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Transisi tidak sah.', request.id)
        }

        // Freeze team identity snapshot if not already frozen
        const teamASnapshot = match.teamASnapshotJson ?? JSON.stringify({ id: match.teamA.id, code: match.teamA.code, name: match.teamA.name, institution: match.teamA.institution })
        const teamBSnapshot = match.teamBSnapshotJson ?? JSON.stringify({ id: match.teamB.id, code: match.teamB.code, name: match.teamB.name, institution: match.teamB.institution })

        const result = await client.$transaction(async (tx) => {
          const updatedArena = await tx.arenaState.update({
            where: { id: 'main' },
            data: { activeMatchId: match.id, arenaVersion: { increment: 1 } },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: {
              status: evalRes.targetStatus,
              phase: evalRes.targetPhase,
              teamASnapshotJson: teamASnapshot,
              teamBSnapshotJson: teamBSnapshot,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'arena.match.select',
              resourceType: 'ArenaState',
              resourceId: 'main',
              actorId: request.authPrincipal?.userId ?? null,
              afterJson: JSON.stringify({ matchId: match.id, arenaVersion: updatedArena.arenaVersion, matchVersion: updatedMatch.matchVersion }),
            },
          })

          return { arena: updatedArena, match: updatedMatch }
        })

        return reply.code(200).send({
          arenaVersion: result.arena.arenaVersion,
          matchVersion: result.match.matchVersion,
          status: result.match.status,
          phase: result.match.phase,
          activeMatchId: result.match.id,
        })
      }

      if (action === 'match.release') {
        const matchId = body?.matchId as string
        const expectedArenaVersion = body?.expectedArenaVersion as number
        const expectedMatchVersion = body?.expectedMatchVersion as number
        const reason = (body?.reason as string) ?? 'Pelepasan match dari arena'

        if (!matchId || typeof expectedArenaVersion !== 'number' || typeof expectedMatchVersion !== 'number') {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'Parameter tidak lengkap.', request.id)
        }

        const arena = await getOrCreateArena(client)
        if (arena.arenaVersion !== expectedArenaVersion) {
          return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Arena version conflict.', request.id)
        }
        if (arena.activeMatchId !== matchId) {
          return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Match tidak aktif di arena utama.', request.id)
        }

        const match = await client.match.findUnique({ where: { id: matchId } })
        if (!match) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Match tidak ditemukan.', request.id)
        }
        if (match.matchVersion !== expectedMatchVersion) {
          return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Match version conflict.', request.id)
        }

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'release' },
          { role, hasStarted: match.hasStarted },
        )

        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Match tidak dapat dilepas.', request.id)
        }

        const result = await client.$transaction(async (tx) => {
          const updatedArena = await tx.arenaState.update({
            where: { id: 'main' },
            data: { activeMatchId: null, arenaVersion: { increment: 1 } },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: {
              status: evalRes.targetStatus,
              phase: evalRes.targetPhase,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'arena.match.release',
              resourceType: 'ArenaState',
              resourceId: 'main',
              actorId: request.authPrincipal?.userId ?? null,
              reason,
              afterJson: JSON.stringify({ matchId: match.id, arenaVersion: updatedArena.arenaVersion, matchVersion: updatedMatch.matchVersion }),
            },
          })

          return { arena: updatedArena, match: updatedMatch }
        })

        return reply.code(200).send({
          arenaVersion: result.arena.arenaVersion,
          matchVersion: result.match.matchVersion,
          status: result.match.status,
          phase: result.match.phase,
          activeMatchId: null,
        })
      }

      return errorResponse(reply, 422, 'INVALID_INPUT', 'Perintah arena tidak dikenal.', request.id)
    },
  )

  // --- MATCH COMMANDS ---
  server.post(
    '/api/v1/matches/:id/commands',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const matchId = request.params.id
      const body = request.body as Record<string, unknown> | null
      const action = body?.action as string
      const expectedMatchVersion = body?.expectedMatchVersion as number
      const role = (request.authPrincipal?.role ?? 'OPERATOR') as UserRole

      if (typeof expectedMatchVersion !== 'number') {
        return errorResponse(reply, 422, 'INVALID_INPUT', 'expectedMatchVersion wajib diisi.', request.id)
      }

      const match = await client.match.findUnique({
        where: { id: matchId },
        include: { segments: { orderBy: [{ ordinal: 'asc' }, { attempt: 'asc' }] } },
      })
      if (!match) {
        return errorResponse(reply, 404, 'NOT_FOUND', 'Match tidak ditemukan.', request.id)
      }
      if (match.matchVersion !== expectedMatchVersion) {
        return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Match version conflict.', request.id, { currentMatchVersion: match.matchVersion })
      }

      const currentSegment = match.segments[match.segments.length - 1]

      if (action === 'segment.prepare') {
        const kind = (body?.kind as 'START' | 'ROUND' | 'HALF') ?? 'ROUND'
        const ordinal = (body?.ordinal as number) ?? 1
        const durationMs = (body?.durationMs as number) ?? 300_000

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'segment.prepare' },
          { role, hasStarted: match.hasStarted },
        )
        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Persiapan segmen ditolak.', request.id)
        }

        const segmentId = randomUUID()
        const result = await client.$transaction(async (tx) => {
          const seg = await tx.segmentAttempt.create({
            data: {
              id: segmentId,
              matchId: match.id,
              kind,
              ordinal,
              attempt: 1,
              status: 'PREPARED',
              durationMs,
            },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: {
              currentSegmentId: segmentId,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'segment.prepare',
              resourceType: 'SegmentAttempt',
              resourceId: segmentId,
              actorId: request.authPrincipal?.userId ?? null,
              afterJson: JSON.stringify(seg),
            },
          })

          return { segment: seg, match: updatedMatch }
        })

        if (timerService) {
          await timerService.prepare({
            matchId: match.id,
            segmentAttemptId: segmentId,
            phaseType: 'COMPETITION',
            initialMs: durationMs,
            actorId: request.authPrincipal?.userId ?? null,
          })
        }

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          currentSegmentId: result.segment.id,
          status: result.match.status,
          phase: result.match.phase,
        })
      }

      if (action === 'phase.advance') {
        const targetPhase = body?.targetPhase as MatchPhase
        if (!targetPhase) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'targetPhase wajib diisi.', request.id)
        }

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'phase.advance', targetPhase },
          {
            role,
            hasStarted: match.hasStarted,
            currentSegmentStatus: (currentSegment?.status as any) ?? null,
            reason: body?.reason as string,
            authorityReference: body?.authorityReference as string,
          },
        )
        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Transisi fase tidak sah.', request.id)
        }

        // When advancing to COMPETITION, first attempt PREPARED -> ACTIVE atomically!
        const result = await client.$transaction(async (tx) => {
          if (targetPhase === 'COMPETITION' && currentSegment && currentSegment.status === 'PREPARED') {
            await tx.segmentAttempt.update({
              where: { id: currentSegment.id },
              data: {
                status: 'ACTIVE',
                activatedAt: new Date(),
                startedAt: new Date(),
              },
            })
          }

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: {
              status: evalRes.targetStatus,
              phase: evalRes.targetPhase,
              hasStarted: targetPhase === 'COMPETITION' ? true : match.hasStarted,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'phase.advance',
              resourceType: 'Match',
              resourceId: match.id,
              actorId: request.authPrincipal?.userId ?? null,
              afterJson: JSON.stringify({ phase: evalRes.targetPhase, status: evalRes.targetStatus }),
            },
          })

          return updatedMatch
        })

        return reply.code(200).send({
          matchVersion: result.matchVersion,
          status: result.status,
          phase: result.phase,
          hasStarted: result.hasStarted,
        })
      }

      if (action === 'match.pause') {
        const reason = (body?.reason as string) ?? 'Jeda pertandingan'
        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'pause' },
          { role, hasStarted: match.hasStarted },
        )
        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Jeda tidak dapat dilakukan.', request.id)
        }

        if (timerService) {
          await timerService.pause()
        }

        const updatedMatch = await client.$transaction(async (tx) => {
          const m = await tx.match.update({
            where: { id: match.id },
            data: {
              status: evalRes.targetStatus,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'match.pause',
              resourceType: 'Match',
              resourceId: match.id,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
            },
          })
          return m
        })

        return reply.code(200).send({
          matchVersion: updatedMatch.matchVersion,
          status: updatedMatch.status,
          phase: updatedMatch.phase,
        })
      }

      if (action === 'match.postpone') {
        const expectedArenaVersion = body?.expectedArenaVersion as number
        const reason = (body?.reason as string) ?? 'Penundaan pertandingan'
        const authorityReference = body?.authorityReference as string

        const arena = await getOrCreateArena(client)
        if (typeof expectedArenaVersion === 'number' && arena.arenaVersion !== expectedArenaVersion) {
          return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Arena version conflict.', request.id)
        }

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'postpone' },
          { role, hasStarted: match.hasStarted, reason, authorityReference },
        )
        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Postpone ditolak.', request.id)
        }

        if (timerService) {
          await timerService.pause()
        }

        const result = await client.$transaction(async (tx) => {
          let updatedArena = arena
          if (arena.activeMatchId === match.id) {
            updatedArena = await tx.arenaState.update({
              where: { id: 'main' },
              data: { activeMatchId: null, arenaVersion: { increment: 1 } },
            })
          }

          const m = await tx.match.update({
            where: { id: match.id },
            data: {
              status: evalRes.targetStatus,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'match.postpone',
              resourceType: 'Match',
              resourceId: match.id,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
              authorityReference,
            },
          })

          return { match: m, arena: updatedArena }
        })

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          arenaVersion: result.arena.arenaVersion,
          status: result.match.status,
          phase: result.match.phase,
        })
      }

      if (action === 'match.cancel') {
        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'cancel' },
          { role, hasStarted: match.hasStarted },
        )
        if (!evalRes.allowed) {
          const status = evalRes.errorCode === 'FORBIDDEN' ? 403 : 409
          return errorResponse(reply, status, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Pembatalan ditolak.', request.id)
        }

        const updatedMatch = await client.$transaction(async (tx) => {
          const m = await tx.match.update({
            where: { id: match.id },
            data: {
              status: evalRes.targetStatus,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'match.cancel',
              resourceType: 'Match',
              resourceId: match.id,
              actorId: request.authPrincipal?.userId ?? null,
              reason: body?.reason as string,
            },
          })
          return m
        })

        return reply.code(200).send({
          matchVersion: updatedMatch.matchVersion,
          status: updatedMatch.status,
          phase: updatedMatch.phase,
        })
      }

      return errorResponse(reply, 422, 'INVALID_INPUT', 'Aksi command match tidak dikenal.', request.id)
    },
  )
}
