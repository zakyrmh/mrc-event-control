import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  evaluateMatchTransition,
  type MatchPhase,
  type MatchStatus,
  type UserRole,
} from '@mrc-x/shared/server'
import type { TimerService } from './timer-service.js'
import type { BroadcastService } from './broadcast-service.js'

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

async function getOrCreateArena(client: Prisma.TransactionClient | PrismaClient, arenaId: string = 'main') {
  let arena = await client.arenaState.findUnique({ where: { id: arenaId } })
  if (!arena) {
    arena = await client.arenaState.create({
      data: { id: arenaId, arenaVersion: 1 },
    })
  }
  return arena
}

async function calculateMatchScore(client: Prisma.TransactionClient | PrismaClient, matchId: string) {
  const events = await client.goalEvent.findMany({
    where: { matchId },
  })
  let goalsA = 0
  let goalsB = 0
  for (const e of events) {
    if (e.side === 'A') goalsA += e.delta
    if (e.side === 'B') goalsB += e.delta
  }
  return { goalsA: Math.max(0, goalsA), goalsB: Math.max(0, goalsB) }
}

export function registerMatchRoutes(
  server: FastifyInstance,
  client: PrismaClient,
  timerService?: TimerService,
  broadcastService?: BroadcastService,
): void {
  // --- ARENA QUERY (GET /api/v1/arenas/:arenaId) ---
  server.get(
    '/api/v1/arenas/:arenaId',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request: FastifyRequest<{ Params: { arenaId: string } }>, reply) => {
      const arenaId = request.params.arenaId || 'main'
      const arena = await getOrCreateArena(client, arenaId)
      let activeMatch = null
      if (arena.activeMatchId) {
        activeMatch = await client.match.findUnique({
          where: { id: arena.activeMatchId },
          include: {
            category: true,
            teamA: true,
            teamB: true,
            segments: { orderBy: [{ ordinal: 'asc' }, { attempt: 'asc' }] },
          },
        })
      }
      return reply.code(200).send({
        arena,
        activeMatch,
      })
    },
  )

  // --- MATCH QUERY (GET /api/v1/matches/:id) ---
  server.get(
    '/api/v1/matches/:id',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const match = await client.match.findUnique({
        where: { id: request.params.id },
        include: {
          category: true,
          teamA: true,
          teamB: true,
          segments: { orderBy: [{ ordinal: 'asc' }, { attempt: 'asc' }] },
          goals: { orderBy: { createdAt: 'asc' } },
          results: { orderBy: { revision: 'asc' } },
          goalIntents: { where: { status: 'READY' } },
        },
      })
      if (!match) {
        return errorResponse(reply, 404, 'NOT_FOUND', 'Match tidak ditemukan.', request.id)
      }
      const score = await calculateMatchScore(client, match.id)
      return reply.code(200).send({
        ...match,
        score,
      })
    },
  )

  // --- ARENA COMMANDS (match.select, match.release) ---
  server.post(
    '/api/v1/arenas/:arenaId/commands',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request: FastifyRequest<{ Params: { arenaId: string } }>, reply) => {
      const arenaId = request.params.arenaId || 'main'
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

        const arena = await getOrCreateArena(client, arenaId)
        if (arena.arenaVersion !== expectedArenaVersion) {
          return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Arena version conflict.', request.id, { currentArenaVersion: arena.arenaVersion })
        }

        if (arena.activeMatchId && arena.activeMatchId !== matchId) {
          const activeMatch = await client.match.findUnique({ where: { id: arena.activeMatchId } })
          if (activeMatch && activeMatch.status !== 'COMPLETED' && activeMatch.status !== 'CANCELLED') {
            return errorResponse(reply, 409, 'ARENA_BUSY', `Arena ${arenaId} sedang digunakan oleh pertandingan lain yang belum selesai.`, request.id)
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
            where: { id: arena.id },
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

        void broadcastService?.broadcastUpdate(arenaId)

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

        const arena = await getOrCreateArena(client, arenaId)
        if (arena.arenaVersion !== expectedArenaVersion) {
          return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Arena version conflict.', request.id)
        }
        if (arena.activeMatchId !== matchId) {
          return errorResponse(reply, 409, 'INVALID_TRANSITION', `Match tidak aktif di arena ${arenaId}.`, request.id)
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
            where: { id: arena.id },
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

        void broadcastService?.broadcastUpdate(arenaId)

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

  // --- MATCH REVIEW (Read-only, computes canonical confirmImpactDigest) ---
  server.post(
    '/api/v1/matches/:id/review',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const matchId = request.params.id
      const body = request.body as Record<string, unknown> | null
      const action = body?.action as string
      const targetId = (body?.targetId as string) ?? ''

      const match = await client.match.findUnique({
        where: { id: matchId },
        include: {
          segments: { orderBy: [{ ordinal: 'asc' }, { attempt: 'asc' }] },
          goals: true,
        },
      })
      if (!match) {
        return errorResponse(reply, 404, 'NOT_FOUND', 'Match tidak ditemukan.', request.id)
      }

      const digest = createHash('sha256')
        .update(`${match.id}:${match.matchVersion}:${action}:${targetId}`)
        .digest('hex')

      return reply.code(200).send({
        reviewDigest: digest,
        matchId: match.id,
        matchVersion: match.matchVersion,
        currentPhase: match.phase,
        currentStatus: match.status,
        action,
        targetId,
      })
    },
  )

  // --- MATCH COMMANDS ---
  server.post<{ Params: { id: string } }>(
    '/api/v1/matches/:id/commands',
    {
      config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } },
      onResponse: async (_request, reply) => {
        if (reply.statusCode === 200 && broadcastService) {
          try {
            await broadcastService.broadcastUpdate()
          } catch {
            // ignore
          }
        }
      },
    },
    async (request, reply) => {
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

      if (action === 'match.arm-start') {
        const reviewDigest = body?.reviewDigest as string | undefined
        const readinessToken = randomUUID()

        if (timerService) {
          try {
            timerService.armReadinessToken(readinessToken, match.id)
          } catch {
            // ignore if no active timer
          }
        }

        await client.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'match.arm-start',
            resourceType: 'Match',
            resourceId: match.id,
            actorId: request.authPrincipal?.userId ?? null,
            afterJson: JSON.stringify({ readinessToken, reviewDigest }),
          },
        })

        return reply.code(200).send({
          readinessToken,
          matchVersion: match.matchVersion,
        })
      }

      if (action === 'match.disarm-start') {
        const readinessToken = (body?.readinessToken as string) ?? null

        await client.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'match.disarm-start',
            resourceType: 'Match',
            resourceId: match.id,
            actorId: request.authPrincipal?.userId ?? null,
            afterJson: JSON.stringify({ readinessToken }),
          },
        })

        return reply.code(200).send({
          disarmed: true,
          matchVersion: match.matchVersion,
        })
      }

      if (action === 'warmup.start') {
        const durationMs = typeof body?.durationMs === 'number' ? body.durationMs : 60_000
        if (timerService) {
          try {
            await timerService.prepare({
              matchId: match.id,
              phaseType: 'WARMUP',
              initialMs: durationMs,
              actorId: request.authPrincipal?.userId ?? null,
            })
            await timerService.start({ matchId: match.id, actorId: request.authPrincipal?.userId ?? null })
          } catch {
            // ignore
          }
        }
        return reply.code(200).send({
          matchVersion: match.matchVersion,
          phase: match.phase,
          status: match.status,
          durationMs,
        })
      }

      if (action === 'warmup.pause') {
        if (timerService) {
          try {
            await timerService.pause(match.id)
          } catch {
            // ignore
          }
        }
        return reply.code(200).send({
          matchVersion: match.matchVersion,
          phase: match.phase,
          status: match.status,
        })
      }

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

          // SC-01: Invalidate any old READY goal intent
          await tx.goalIntent.updateMany({
            where: { matchId: match.id, status: 'READY' },
            data: { status: 'INVALIDATED' },
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

      if (action === 'phase.override') {
        const targetPhase = body?.targetPhase as MatchPhase
        const reason = body?.reason as string
        const authorityReference = body?.authorityReference as string

        if (!targetPhase || !reason || !authorityReference) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'targetPhase, reason, dan authorityReference wajib diisi untuk override.', request.id)
        }

        let isTimerRunning = false
        if (timerService) {
          try {
            const snap = await timerService.getSnapshot(match.id)
            isTimerRunning = snap.state === 'RUNNING'
          } catch {
            // no timer
          }
        }

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'phase.override', targetPhase, reason, authorityReference },
          { role, hasStarted: match.hasStarted, timerRunning: isTimerRunning },
        )

        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Override fase ditolak.', request.id)
        }

        if (timerService && isTimerRunning) {
          await timerService.pause(match.id)
        }

        const updatedMatch = await client.$transaction(async (tx) => {
          const m = await tx.match.update({
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
              action: 'phase.override',
              resourceType: 'Match',
              resourceId: match.id,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
              authorityReference,
              beforeJson: JSON.stringify({ status: match.status, phase: match.phase }),
              afterJson: JSON.stringify({ status: evalRes.targetStatus, phase: evalRes.targetPhase }),
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

      if (action === 'segment.restart') {
        const segmentAttemptId = body?.segmentAttemptId as string
        const reason = body?.reason as string
        const authorityReference = body?.authorityReference as string
        const confirmImpactDigest = body?.confirmImpactDigest as string | undefined

        if (!segmentAttemptId || !reason || !authorityReference) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'segmentAttemptId, reason, dan authorityReference wajib diisi untuk ulang segmen.', request.id)
        }

        const targetSegment = match.segments.find((s) => s.id === segmentAttemptId)
        if (!targetSegment) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Segmen yang akan diulang tidak ditemukan pada match ini.', request.id)
        }

        // Validate confirmImpactDigest if provided
        if (confirmImpactDigest) {
          const expectedDigest = createHash('sha256')
            .update(`${match.id}:${match.matchVersion}:${action}:${segmentAttemptId}`)
            .digest('hex')
          if (confirmImpactDigest !== expectedDigest) {
            return errorResponse(reply, 409, 'REVIEW_STALE', 'Review impact telah usang karena versi match telah berubah. Muat ulang review sebelum restart.', request.id)
          }
        }

        // Timer must not be running
        if (timerService) {
          try {
            const snap = await timerService.getSnapshot(match.id)
            if (snap.state === 'RUNNING') {
              return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Tidak boleh mengulang segmen saat timer masih berjalan. Jeda/hentikan timer terlebih dahulu.', request.id)
            }
          } catch {
            // no timer
          }
        }

        const nextAttempt = targetSegment.attempt + 1
        const newSegmentId = randomUUID()

        const result = await client.$transaction(async (tx) => {
          // Mark old attempt as REPLACED
          await tx.segmentAttempt.update({
            where: { id: targetSegment.id },
            data: {
              status: 'REPLACED',
              reason,
              actorId: request.authPrincipal?.userId ?? null,
            },
          })

          // Create new attempt with attempt + 1 and supersedesAttemptId
          const newSeg = await tx.segmentAttempt.create({
            data: {
              id: newSegmentId,
              matchId: match.id,
              kind: targetSegment.kind,
              ordinal: targetSegment.ordinal,
              attempt: nextAttempt,
              supersedesAttemptId: targetSegment.id,
              status: 'PREPARED',
              durationMs: targetSegment.durationMs,
            },
          })

          // SC-01: Invalidate any old READY goal intent on restart
          await tx.goalIntent.updateMany({
            where: { matchId: match.id, status: 'READY' },
            data: { status: 'INVALIDATED' },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: {
              currentSegmentId: newSegmentId,
              phase: 'READY',
              status: match.hasStarted ? 'PAUSED' : match.status,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'segment.restart',
              resourceType: 'SegmentAttempt',
              resourceId: newSegmentId,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
              authorityReference,
              beforeJson: JSON.stringify({ supersededAttemptId: targetSegment.id, ordinal: targetSegment.ordinal, attempt: targetSegment.attempt }),
              afterJson: JSON.stringify({ newAttemptId: newSegmentId, ordinal: targetSegment.ordinal, attempt: nextAttempt }),
            },
          })

          return { newSegment: newSeg, match: updatedMatch }
        })

        if (timerService) {
          await timerService.prepare({
            matchId: match.id,
            segmentAttemptId: newSegmentId,
            phaseType: 'COMPETITION',
            initialMs: targetSegment.durationMs ?? 300_000,
            actorId: request.authPrincipal?.userId ?? null,
          })
        }

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          currentSegmentId: result.newSegment.id,
          ordinal: result.newSegment.ordinal,
          attempt: result.newSegment.attempt,
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
          let activeGoalIntentId: string | null = null
          if (targetPhase === 'COMPETITION' && currentSegment && currentSegment.status === 'PREPARED') {
            await tx.segmentAttempt.update({
              where: { id: currentSegment.id },
              data: {
                status: 'ACTIVE',
                activatedAt: new Date(),
                startedAt: new Date(),
              },
            })

            // SC-01: Exactly one GoalIntent READY created on PREPARED -> ACTIVE
            await tx.goalIntent.updateMany({
              where: { matchId: match.id, status: 'READY' },
              data: { status: 'INVALIDATED' },
            })

            activeGoalIntentId = randomUUID()
            await tx.goalIntent.create({
              data: {
                id: activeGoalIntentId,
                matchId: match.id,
                segmentAttemptId: currentSegment.id,
                status: 'READY',
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
              afterJson: JSON.stringify({ phase: evalRes.targetPhase, status: evalRes.targetStatus, activeGoalIntentId }),
            },
          })

          return { updatedMatch, activeGoalIntentId }
        })

        if (targetPhase === 'COMPETITION' && timerService) {
          try {
            const readinessToken = body?.readinessToken as string | undefined
            await timerService.start({ readinessToken, actorId: request.authPrincipal?.userId ?? null, matchId: match.id })
          } catch {
            // ignore if no active timer or fake port
          }
        }

        if (targetPhase !== 'COMPETITION' && timerService) {
          try {
            await timerService.pause(match.id)
          } catch {
            // ignore
          }
        }

        return reply.code(200).send({
          matchVersion: result.updatedMatch.matchVersion,
          status: result.updatedMatch.status,
          phase: result.updatedMatch.phase,
          hasStarted: result.updatedMatch.hasStarted,
          activeGoalIntentId: result.activeGoalIntentId,
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
          await timerService.pause(match.id)
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
          await timerService.pause(match.id)
        }

        const result = await client.$transaction(async (tx) => {
          let updatedArena = arena
          const activeArena = await tx.arenaState.findFirst({ where: { activeMatchId: match.id } })
          if (activeArena) {
            updatedArena = await tx.arenaState.update({
              where: { id: activeArena.id },
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

      if (action === 'goal.add') {
        const goalIntentId = body?.goalIntentId as string
        const side = body?.side as 'A' | 'B'
        const occurredAtMs = (body?.occurredAtMs as number) ?? null

        if (!goalIntentId || (side !== 'A' && side !== 'B')) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'goalIntentId dan side (A/B) wajib diisi.', request.id)
        }

        // Timer storage gate check
        if (timerService && timerService.getStorageHealth() === 'DEGRADED') {
          return errorResponse(reply, 503, 'STORAGE_DEGRADED', 'Penyimpanan terdegradasi. Gol ditolak.', request.id)
        }

        // SC-03: guard phase and attempt
        const isCompetition = match.phase === 'COMPETITION' && currentSegment?.status === 'ACTIVE'
        const isResult = match.phase === 'RESULT'
        if (!isCompetition && !isResult) {
          return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Pencatatan gol hanya diizinkan saat fase COMPETITION (attempt ACTIVE) atau RESULT.', request.id)
        }

        if (isResult) {
          const reason = body?.reason as string
          const authorityReference = body?.authorityReference as string
          if (!reason || !authorityReference) {
            return errorResponse(reply, 422, 'INVALID_INPUT', 'Pencatatan gol susulan pada fase RESULT memerlukan reason dan authorityReference.', request.id)
          }
        }

        // Check goal intent status
        const intent = await client.goalIntent.findUnique({
          where: { id: goalIntentId },
        })
        if (!intent || intent.matchId !== match.id) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Goal intent tidak ditemukan.', request.id)
        }
        if (intent.status !== 'READY') {
          return errorResponse(reply, 409, 'GOAL_INTENT_CONSUMED', 'Goal intent telah terpakai atau tidak valid. Siapkan gol berikutnya sebelum mencatat gol.', request.id)
        }

        const goalEventId = randomUUID()
        const logicalGoalId = randomUUID()

        const result = await client.$transaction(async (tx) => {
          // Consume intent
          await tx.goalIntent.update({
            where: { id: goalIntentId },
            data: {
              status: 'CONSUMED',
              consumedAt: new Date(),
            },
          })

          // Create goal event
          const event = await tx.goalEvent.create({
            data: {
              id: goalEventId,
              matchId: match.id,
              segmentAttemptId: intent.segmentAttemptId,
              side,
              delta: 1,
              occurredAtMs,
              goalIntentId,
              logicalGoalId,
              actorId: request.authPrincipal?.userId ?? null,
            },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: { matchVersion: { increment: 1 } },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'goal.add',
              resourceType: 'GoalEvent',
              resourceId: goalEventId,
              actorId: request.authPrincipal?.userId ?? null,
              afterJson: JSON.stringify(event),
            },
          })

          const score = await calculateMatchScore(tx, match.id)

          return { match: updatedMatch, event, score }
        })

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          goalEventId: result.event.id,
          side: result.event.side,
          delta: 1,
          score: result.score,
        })
      }

      if (action === 'goal.prepare-next') {
        const previousGoalIntentId = body?.previousGoalIntentId as string
        const targetSegmentAttemptId = body?.targetSegmentAttemptId as string | undefined

        if (!previousGoalIntentId) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'previousGoalIntentId wajib diisi.', request.id)
        }

        // Idempotency check: if READY intent already exists for this match, return it
        const existingReady = await client.goalIntent.findFirst({
          where: { matchId: match.id, status: 'READY' },
        })
        if (existingReady) {
          return reply.code(200).send({
            goalIntentId: existingReady.id,
            status: existingReady.status,
            matchVersion: match.matchVersion,
          })
        }

        // Verify previous intent was consumed or invalidated
        const prev = await client.goalIntent.findUnique({
          where: { id: previousGoalIntentId },
        })
        if (!prev || prev.matchId !== match.id) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Previous goal intent tidak ditemukan.', request.id)
        }
        if (prev.status === 'READY') {
          return reply.code(200).send({
            goalIntentId: prev.id,
            status: prev.status,
            matchVersion: match.matchVersion,
          })
        }

        // Determine target segment attempt (must have been played / active)
        let segId = prev.segmentAttemptId
        if (targetSegmentAttemptId) {
          const seg = match.segments.find((s) => s.id === targetSegmentAttemptId)
          if (!seg || (!seg.activatedAt && seg.status === 'PREPARED')) {
            return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Target segment attempt tidak sah atau belum pernah dimainkan.', request.id)
          }
          segId = seg.id
        }

        const newIntentId = randomUUID()
        const newIntent = await client.$transaction(async (tx) => {
          const created = await tx.goalIntent.create({
            data: {
              id: newIntentId,
              matchId: match.id,
              segmentAttemptId: segId,
              status: 'READY',
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'goal.prepare-next',
              resourceType: 'GoalIntent',
              resourceId: newIntentId,
              actorId: request.authPrincipal?.userId ?? null,
              afterJson: JSON.stringify({ previousGoalIntentId, newGoalIntentId: newIntentId }),
            },
          })

          return created
        })

        return reply.code(200).send({
          goalIntentId: newIntent.id,
          status: newIntent.status,
          matchVersion: match.matchVersion,
        })
      }

      if (action === 'goal.correct') {
        const correctsGoalId = body?.correctsGoalId as string
        const reason = body?.reason as string
        const authorityReference = body?.authorityReference as string

        if (!correctsGoalId || !reason || !authorityReference) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'correctsGoalId, reason, dan authorityReference wajib diisi.', request.id)
        }

        const targetGoal = await client.goalEvent.findUnique({
          where: { id: correctsGoalId },
          include: { correctedBy: true },
        })
        if (!targetGoal || targetGoal.matchId !== match.id) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Goal event tidak ditemukan.', request.id)
        }
        if (targetGoal.delta !== 1) {
          return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Hanya event gol bernilai positif (+1) yang dapat dikoreksi.', request.id)
        }
        if (targetGoal.correctedBy.length > 0) {
          return errorResponse(reply, 409, 'GOAL_REVISION_CONFLICT', 'Gol ini telah dikoreksi sebelumnya.', request.id)
        }

        const correctionId = randomUUID()
        const result = await client.$transaction(async (tx) => {
          const cancelEvent = await tx.goalEvent.create({
            data: {
              id: correctionId,
              matchId: match.id,
              segmentAttemptId: targetGoal.segmentAttemptId,
              side: targetGoal.side,
              delta: -1,
              correctsGoalId: targetGoal.id,
              logicalGoalId: targetGoal.logicalGoalId,
              reason,
              actorId: request.authPrincipal?.userId ?? null,
            },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: { matchVersion: { increment: 1 } },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'goal.correct',
              resourceType: 'GoalEvent',
              resourceId: correctionId,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
              authorityReference,
              beforeJson: JSON.stringify(targetGoal),
              afterJson: JSON.stringify(cancelEvent),
            },
          })

          const score = await calculateMatchScore(tx, match.id)
          return { match: updatedMatch, cancelEvent, score }
        })

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          correctedGoalId: targetGoal.id,
          cancelEventId: result.cancelEvent.id,
          score: result.score,
        })
      }

      if (action === 'goal.reassign') {
        const sourceGoalEventId = body?.sourceGoalEventId as string
        const targetSide = body?.targetSide as 'A' | 'B'
        const reason = body?.reason as string
        const authorityReference = body?.authorityReference as string

        if (!sourceGoalEventId || (targetSide !== 'A' && targetSide !== 'B') || !reason || !authorityReference) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'sourceGoalEventId, targetSide (A/B), reason, dan authorityReference wajib diisi.', request.id)
        }

        const sourceGoal = await client.goalEvent.findUnique({
          where: { id: sourceGoalEventId },
          include: { correctedBy: true },
        })
        if (!sourceGoal || sourceGoal.matchId !== match.id) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Goal event sumber tidak ditemukan.', request.id)
        }
        if (sourceGoal.delta !== 1) {
          return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Hanya event gol bernilai positif (+1) yang dapat di-reassign.', request.id)
        }
        if (sourceGoal.correctedBy.length > 0) {
          return errorResponse(reply, 409, 'GOAL_REVISION_CONFLICT', 'Gol ini telah dikoreksi atau dibatalkan sebelumnya.', request.id)
        }
        if (sourceGoal.side === targetSide) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'targetSide harus berbeda dengan sisi gol saat ini.', request.id)
        }

        const correctionGroupId = randomUUID()
        const cancelEventId = randomUUID()
        const newGoalEventId = randomUUID()

        const result = await client.$transaction(async (tx) => {
          // -1 for old side
          const cancelEvent = await tx.goalEvent.create({
            data: {
              id: cancelEventId,
              matchId: match.id,
              segmentAttemptId: sourceGoal.segmentAttemptId,
              side: sourceGoal.side,
              delta: -1,
              correctsGoalId: sourceGoal.id,
              logicalGoalId: sourceGoal.logicalGoalId,
              correctionGroupId,
              reason,
              actorId: request.authPrincipal?.userId ?? null,
            },
          })

          // +1 for new side
          const newGoalEvent = await tx.goalEvent.create({
            data: {
              id: newGoalEventId,
              matchId: match.id,
              segmentAttemptId: sourceGoal.segmentAttemptId,
              side: targetSide,
              delta: 1,
              logicalGoalId: sourceGoal.logicalGoalId,
              correctionGroupId,
              occurredAtMs: sourceGoal.occurredAtMs,
              reason,
              actorId: request.authPrincipal?.userId ?? null,
            },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: { matchVersion: { increment: 1 } },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'goal.reassign',
              resourceType: 'GoalEvent',
              resourceId: newGoalEventId,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
              authorityReference,
              beforeJson: JSON.stringify(sourceGoal),
              afterJson: JSON.stringify({ cancelEvent, newGoalEvent, correctionGroupId }),
            },
          })

          const score = await calculateMatchScore(tx, match.id)
          return { match: updatedMatch, cancelEvent, newGoalEvent, score }
        })

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          sourceGoalId: sourceGoal.id,
          reassignedGoalId: result.newGoalEvent.id,
          newSide: targetSide,
          score: result.score,
        })
      }

      // --- RESULT COMMANDS (draft, finalize, reopen, refinalize, cancel-correction) ---
      if (action === 'result.draft') {
        const decisionText = (body?.decisionText as string) ?? null
        const winnerTeamId = (body?.winnerTeamId as string) ?? null
        const finalGoalsA = typeof body?.finalGoalsA === 'number' ? body.finalGoalsA : null
        const finalGoalsB = typeof body?.finalGoalsB === 'number' ? body.finalGoalsB : null
        // Points are decided by the jury and only recorded here; the system never computes them.
        const pointsA = typeof body?.pointsA === 'number' ? body.pointsA : null
        const pointsB = typeof body?.pointsB === 'number' ? body.pointsB : null
        const refereeReference = (body?.refereeReference as string) ?? null
        const reason = (body?.reason as string) ?? null

        if (winnerTeamId && winnerTeamId !== match.teamAId && winnerTeamId !== match.teamBId) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'winnerTeamId harus merupakan salah satu tim peserta.', request.id)
        }
        if ((finalGoalsA !== null && finalGoalsA < 0) || (finalGoalsB !== null && finalGoalsB < 0)) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'finalGoals tidak boleh bernilai negatif.', request.id)
        }
        if ((pointsA !== null && pointsA < 0) || (pointsB !== null && pointsB < 0)) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'points tidak boleh bernilai negatif.', request.id)
        }
        if (match.status === 'COMPLETED') {
          return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Match yang telah COMPLETED tidak dapat membuat draft tanpa reopen oleh super-admin.', request.id)
        }

        const existingDraft = await client.resultRevision.findFirst({
          where: { matchId: match.id, status: 'DRAFT' },
        })

        const maxRev = await client.resultRevision.aggregate({
          where: { matchId: match.id },
          _max: { revision: true },
        })
        const nextRevNum = (maxRev._max.revision ?? 0) + 1

        const revisionId = existingDraft?.id ?? randomUUID()
        const result = await client.$transaction(async (tx) => {
          let rev: any
          if (existingDraft) {
            rev = await tx.resultRevision.update({
              where: { id: existingDraft.id },
              data: {
                decisionText,
                winnerTeamId,
                finalGoalsA,
                finalGoalsB,
                pointsA,
                pointsB,
                refereeReference,
                reason,
              },
            })
          } else {
            rev = await tx.resultRevision.create({
              data: {
                id: revisionId,
                matchId: match.id,
                revision: nextRevNum,
                status: 'DRAFT',
                decisionText,
                winnerTeamId,
                finalGoalsA,
                finalGoalsB,
                pointsA,
                pointsB,
                refereeReference,
                reason,
              },
            })
          }

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: { matchVersion: { increment: 1 } },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'result.draft',
              resourceType: 'ResultRevision',
              resourceId: rev.id,
              actorId: request.authPrincipal?.userId ?? null,
              afterJson: JSON.stringify(rev),
            },
          })

          return { match: updatedMatch, revision: rev }
        })

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          resultRevisionId: result.revision.id,
          revision: result.revision.revision,
          status: result.revision.status,
          decisionText: result.revision.decisionText,
          winnerTeamId: result.revision.winnerTeamId,
          finalGoalsA: result.revision.finalGoalsA,
          finalGoalsB: result.revision.finalGoalsB,
          pointsA: result.revision.pointsA,
          pointsB: result.revision.pointsB,
        })
      }

      if (action === 'result.finalize') {
        const draftRevisionId = body?.draftRevisionId as string
        const confirmImpactDigest = body?.confirmImpactDigest as string | undefined

        if (!draftRevisionId) {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'draftRevisionId wajib diisi.', request.id)
        }

        let isTimerRunning = false
        if (timerService) {
          try {
            const snap = await timerService.getSnapshot(match.id)
            if (snap.state === 'RUNNING') {
              if (snap.remainingMs <= 0 || match.phase === 'RESULT' || match.phase === 'FINISHED') {
                await timerService.pause(match.id)
                isTimerRunning = false
              } else {
                isTimerRunning = true
              }
            }
          } catch {
            // no timer
          }
        }

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'finalize' },
          { role, hasStarted: match.hasStarted, timerRunning: isTimerRunning },
        )
        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Finalisasi ditolak.', request.id)
        }

        const draftRev = await client.resultRevision.findUnique({
          where: { id: draftRevisionId },
        })
        if (!draftRev || draftRev.matchId !== match.id || draftRev.status !== 'DRAFT') {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Draft revisi tidak ditemukan atau bukan berstatus DRAFT.', request.id)
        }

        if (confirmImpactDigest) {
          const expectedDigest = createHash('sha256')
            .update(`${match.id}:${match.matchVersion}:${action}:${draftRevisionId}`)
            .digest('hex')
          if (confirmImpactDigest !== expectedDigest) {
            return errorResponse(reply, 409, 'REVIEW_STALE', 'Review impact telah usang.', request.id)
          }
        }

        const arena = await getOrCreateArena(client)

        const result = await client.$transaction(async (tx) => {
          const finalizedRev = await tx.resultRevision.update({
            where: { id: draftRev.id },
            data: {
              status: 'FINAL',
              finalizedAt: new Date(),
              finalizedBy: request.authPrincipal?.userId ?? null,
            },
          })

          let updatedArena = arena
          const activeArena = await tx.arenaState.findFirst({ where: { activeMatchId: match.id } })
          if (activeArena) {
            updatedArena = await tx.arenaState.update({
              where: { id: activeArena.id },
              data: { activeMatchId: null, arenaVersion: { increment: 1 } },
            })
          }

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
              action: 'result.finalize',
              resourceType: 'ResultRevision',
              resourceId: finalizedRev.id,
              actorId: request.authPrincipal?.userId ?? null,
              afterJson: JSON.stringify(finalizedRev),
            },
          })

          return { match: updatedMatch, arena: updatedArena, revision: finalizedRev }
        })

        if (timerService) {
          try {
            await timerService.pause(match.id)
          } catch {
            // ignore
          }
        }

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          resultRevisionId: result.revision.id,
          status: result.match.status,
          phase: result.match.phase,
          arenaVersion: result.arena.arenaVersion,
        })
      }

      if (action === 'result.reopen') {
        const reason = body?.reason as string
        const authorityReference = body?.authorityReference as string

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'reopen', reason, authorityReference },
          { role, hasStarted: match.hasStarted },
        )
        if (!evalRes.allowed) {
          const code = evalRes.errorCode === 'FORBIDDEN' ? 403 : 409
          return errorResponse(reply, code, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Reopen ditolak.', request.id)
        }

        const latestFinal = await client.resultRevision.findFirst({
          where: { matchId: match.id, status: 'FINAL' },
          orderBy: { revision: 'desc' },
        })
        if (!latestFinal) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Tidak ada hasil resmi (FINAL) untuk di-reopen.', request.id)
        }

        const arena = await getOrCreateArena(client)
        const newDraftId = randomUUID()

        const result = await client.$transaction(async (tx) => {
          let updatedArena = arena
          const activeArena = await tx.arenaState.findFirst({ where: { activeMatchId: match.id } })
          if (activeArena) {
            updatedArena = await tx.arenaState.update({
              where: { id: activeArena.id },
              data: { activeMatchId: null, arenaVersion: { increment: 1 } },
            })
          }

          const newDraft = await tx.resultRevision.create({
            data: {
              id: newDraftId,
              matchId: match.id,
              revision: latestFinal.revision + 1,
              status: 'DRAFT',
              decisionText: latestFinal.decisionText,
              winnerTeamId: latestFinal.winnerTeamId,
              finalGoalsA: latestFinal.finalGoalsA,
              finalGoalsB: latestFinal.finalGoalsB,
              refereeReference: latestFinal.refereeReference,
              previousRevisionId: latestFinal.id,
              reason,
              authorityReference,
            },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: {
              status: evalRes.targetStatus,
              matchVersion: { increment: 1 },
            },
          })

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'result.reopen',
              resourceType: 'ResultRevision',
              resourceId: newDraftId,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
              authorityReference,
              beforeJson: JSON.stringify(latestFinal),
              afterJson: JSON.stringify(newDraft),
            },
          })

          return { match: updatedMatch, draft: newDraft, arena: updatedArena }
        })

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          status: result.match.status,
          draftRevisionId: result.draft.id,
          revision: result.draft.revision,
        })
      }

      if (action === 'result.refinalize') {
        const draftRevisionId = body?.draftRevisionId as string
        const reason = body?.reason as string
        const authorityReference = body?.authorityReference as string

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'refinalize', reason, authorityReference },
          { role, hasStarted: match.hasStarted },
        )
        if (!evalRes.allowed) {
          const code = evalRes.errorCode === 'FORBIDDEN' ? 403 : 409
          return errorResponse(reply, code, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Refinalize ditolak.', request.id)
        }

        const draftRev = await client.resultRevision.findUnique({
          where: { id: draftRevisionId },
        })
        if (!draftRev || draftRev.matchId !== match.id || draftRev.status !== 'DRAFT') {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Draft revisi tidak ditemukan.', request.id)
        }

        const result = await client.$transaction(async (tx) => {
          // Supersede any older final revision
          await tx.resultRevision.updateMany({
            where: { matchId: match.id, status: 'FINAL' },
            data: { status: 'SUPERSEDED' },
          })

          const refinalized = await tx.resultRevision.update({
            where: { id: draftRev.id },
            data: {
              status: 'FINAL',
              finalizedAt: new Date(),
              finalizedBy: request.authPrincipal?.userId ?? null,
              reason,
              authorityReference,
            },
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
              action: 'result.refinalize',
              resourceType: 'ResultRevision',
              resourceId: refinalized.id,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
              authorityReference,
              afterJson: JSON.stringify(refinalized),
            },
          })

          return { match: updatedMatch, revision: refinalized }
        })

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          resultRevisionId: result.revision.id,
          status: result.match.status,
          phase: result.match.phase,
        })
      }

      if (action === 'result.cancel-correction') {
        const draftRevisionId = body?.draftRevisionId as string
        const reason = (body?.reason as string) ?? 'Pembatalan koreksi hasil'

        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'cancel-correction' },
          { role, hasStarted: match.hasStarted },
        )
        if (!evalRes.allowed) {
          const code = evalRes.errorCode === 'FORBIDDEN' ? 403 : 409
          return errorResponse(reply, code, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Pembatalan koreksi ditolak.', request.id)
        }

        const result = await client.$transaction(async (tx) => {
          await tx.resultRevision.deleteMany({
            where: { id: draftRevisionId, matchId: match.id, status: 'DRAFT' },
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
              action: 'result.cancel-correction',
              resourceType: 'Match',
              resourceId: match.id,
              actorId: request.authPrincipal?.userId ?? null,
              reason,
            },
          })

          return updatedMatch
        })

        return reply.code(200).send({
          matchVersion: result.matchVersion,
          status: result.status,
          phase: result.phase,
        })
      }

      return errorResponse(reply, 422, 'INVALID_INPUT', 'Aksi command match tidak dikenal.', request.id)
    },
  )
}
