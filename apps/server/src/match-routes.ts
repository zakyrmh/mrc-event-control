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

async function autoSyncGroupWinnerToBracket(client: PrismaClient, categoryId: string) {
  try {
    const category = await client.category.findUnique({
      where: { id: categoryId },
      include: { groups: true },
    })
    if (!category) return
    const catCode = category.code.toLowerCase()

    const matches = await client.match.findMany({
      where: { categoryId, stage: 'GROUP' },
      include: {
        teamA: true,
        teamB: true,
        results: { where: { status: 'FINAL' } },
      },
    })

    const groupWinners = new Map<string, any>()
    for (const grp of category.groups) {
      const grpMatches = matches.filter((m) => m.groupId === grp.id)
      if (grpMatches.length === 0 || !grpMatches.every((m) => m.status === 'COMPLETED')) continue

      const teamStats = new Map<string, { team: any; points: number; diff: number }>()
      for (const m of grpMatches) {
        if (!teamStats.has(m.teamAId)) teamStats.set(m.teamAId, { team: m.teamA, points: 0, diff: 0 })
        if (!teamStats.has(m.teamBId)) teamStats.set(m.teamBId, { team: m.teamB, points: 0, diff: 0 })

        const res = m.results[0]
        if (res) {
          const pA = res.pointsA ?? res.finalGoalsA ?? 0
          const pB = res.pointsB ?? res.finalGoalsB ?? 0
          const statA = teamStats.get(m.teamAId)!
          const statB = teamStats.get(m.teamBId)!
          statA.diff += (pA - pB)
          statB.diff += (pB - pA)
          const winId = res.winnerTeamId || (pA > pB ? m.teamAId : pB > pA ? m.teamBId : null)
          if (winId === m.teamAId) statA.points += 3
          else if (winId === m.teamBId) statB.points += 3
          else if (pA === pB) {
            statA.points += 1
            statB.points += 1
          }
        }
      }

      const sorted = Array.from(teamStats.values()).sort((a, b) => b.points - a.points || b.diff - a.diff)
      if (sorted[0]?.team) {
        const letter = grp.name.replace(/^(GROUP|GRUP)\s*/i, '').trim().toUpperCase()
        groupWinners.set(letter, sorted[0].team)
      }
    }

    type SlotPair = { slot: string; label: string; sideA: string; sideB: string }
    let slotPairs: SlotPair[] = []
    if (catCode.includes('junior')) {
      slotPairs = [
        { slot: 'QF1', label: 'Perempat Final 1', sideA: 'A', sideB: 'B' },
        { slot: 'QF2', label: 'Perempat Final 2', sideA: 'C', sideB: 'D' },
        { slot: 'QF3', label: 'Perempat Final 3', sideA: 'E', sideB: 'F' },
        { slot: 'QF4', label: 'Perempat Final 4', sideA: 'G', sideB: 'H' },
      ]
    } else if (catCode.includes('soccer') || catCode.includes('sumo')) {
      slotPairs = [
        { slot: 'R1_AB', label: 'Babak 1 (Match 1)', sideA: 'A', sideB: 'B' },
        { slot: 'R1_CD', label: 'Babak 1 (Match 2)', sideA: 'C', sideB: 'D' },
        { slot: 'R1_EF', label: 'Babak 1 (Match 3)', sideA: 'E', sideB: 'F' },
        { slot: 'R1_GH', label: 'Babak 1 (Match 4)', sideA: 'G', sideB: 'H' },
        { slot: 'R1_IJ', label: 'Babak 1 (Match 5)', sideA: 'I', sideB: 'J' },
      ]
    } else {
      slotPairs = [
        { slot: 'R1_1', label: 'Babak Awal (Match 1)', sideA: 'A', sideB: 'B' },
        { slot: 'R1_2', label: 'Babak Awal (Match 2)', sideA: 'C', sideB: 'D' },
        { slot: 'R1_3', label: 'Babak Awal (Match 3)', sideA: 'E', sideB: 'F' },
        { slot: 'R1_4', label: 'Babak Awal (Match 4)', sideA: 'G', sideB: 'H' },
        { slot: 'R1_5', label: 'Babak Awal (Match 5)', sideA: 'I', sideB: 'J' },
        { slot: 'R1_6A', label: 'Match 6A (K vs L)', sideA: 'K', sideB: 'L' },
        { slot: 'R1_6B', label: 'Match 6B (K vs M)', sideA: 'K', sideB: 'M' },
        { slot: 'R1_6C', label: 'Match 6C (L vs M)', sideA: 'L', sideB: 'M' },
      ]
    }

    const existingKnockoutMatches = await client.match.findMany({
      where: { categoryId, stage: 'KNOCKOUT' },
    })
    const maxSeq = await client.match.aggregate({
      where: { categoryId },
      _max: { sequence: true },
    })
    let nextSeq = (maxSeq._max.sequence ?? 0) + 1

    for (const pair of slotPairs) {
      const teamA = groupWinners.get(pair.sideA)
      const teamB = groupWinners.get(pair.sideB)
      const existing = existingKnockoutMatches.find((m) => m.bracketSlot === pair.slot)

      if (existing) {
        if (!existing.hasStarted && existing.status === 'SCHEDULED') {
          const updateData: Record<string, any> = {}
          if (teamA && teamA.id !== existing.teamAId && teamA.id !== existing.teamBId) {
            updateData.teamAId = teamA.id
          }
          if (teamB && teamB.id !== existing.teamBId && teamB.id !== existing.teamAId) {
            updateData.teamBId = teamB.id
          }
          if (Object.keys(updateData).length > 0) {
            updateData.matchVersion = { increment: 1 }
            await client.match.update({
              where: { id: existing.id },
              data: updateData,
            })
          }
        }
      } else if (teamA && teamB && teamA.id !== teamB.id) {
        await client.match.create({
          data: {
            id: randomUUID(),
            categoryId,
            stage: 'KNOCKOUT',
            stageLabel: pair.label,
            bracketSlot: pair.slot,
            sequence: nextSeq++,
            teamAId: teamA.id,
            teamBId: teamB.id,
            status: 'SCHEDULED',
            matchVersion: 1,
            hasStarted: false,
          },
        })
      }
    }
  } catch {
    // Abaikan error agar tidak memutus respons operator
  }
}

async function autoSyncKnockoutProgression(client: PrismaClient, categoryId: string) {
  try {
    const category = await client.category.findUnique({ where: { id: categoryId } })
    if (!category) return
    const catCode = category.code.toLowerCase()
    const isSumo = catCode.includes('sumo')
    const isSoccer = catCode.includes('soccer')
    const isJunior = catCode.includes('junior')

    const knockoutMatches = await client.match.findMany({
      where: { categoryId, stage: 'KNOCKOUT' },
      include: {
        teamA: true,
        teamB: true,
        results: { where: { status: 'FINAL' }, orderBy: { revision: 'desc' } },
      },
    })

    const getWinner = (slotId: string) => {
      const m = knockoutMatches.find((km) => km.bracketSlot === slotId)
      if (!m || m.status !== 'COMPLETED' || m.results.length === 0) return null
      const res = m.results[0]
      if (!res) return null
      const pA = res.pointsA ?? res.finalGoalsA ?? 0
      const pB = res.pointsB ?? res.finalGoalsB ?? 0
      const winId = res.winnerTeamId || (pA > pB ? m.teamAId : pB > pA ? m.teamBId : null)
      if (!winId) return null
      return winId === m.teamAId ? m.teamA : m.teamB
    }

    const maxSeq = await client.match.aggregate({
      where: { categoryId },
      _max: { sequence: true },
    })
    let nextSeq = (maxSeq._max.sequence ?? 0) + 1

    const ensureMatch = async (slotId: string, stageLabel: string, teamAId: string, teamBId: string) => {
      if (teamAId === teamBId) return
      const existing = knockoutMatches.find((m) => m.bracketSlot === slotId)
      if (existing) {
        if (!existing.hasStarted && existing.status === 'SCHEDULED') {
          if (existing.teamAId !== teamAId || existing.teamBId !== teamBId) {
            await client.match.update({
              where: { id: existing.id },
              data: {
                teamAId,
                teamBId,
                stageLabel,
                matchVersion: { increment: 1 },
              },
            })
          }
        }
      } else {
        await client.match.create({
          data: {
            id: randomUUID(),
            categoryId,
            stage: 'KNOCKOUT',
            stageLabel,
            bracketSlot: slotId,
            sequence: nextSeq++,
            teamAId,
            teamBId,
            status: 'SCHEDULED',
            matchVersion: 1,
            hasStarted: false,
          },
        })
      }
    }

    // --- 1. LF JUNIOR (8 Tim: QF1..4 -> SF1, SF2 -> FINAL & BRONZE) ---
    if (isJunior) {
      const winQF1 = getWinner('QF1')
      const winQF2 = getWinner('QF2')
      if (winQF1 && winQF2) {
        await ensureMatch('SF1', 'Semi Final 1', winQF1.id, winQF2.id)
      }
      const winQF3 = getWinner('QF3')
      const winQF4 = getWinner('QF4')
      if (winQF3 && winQF4) {
        await ensureMatch('SF2', 'Semi Final 2', winQF3.id, winQF4.id)
      }
      const winSF1 = getWinner('SF1')
      const winSF2 = getWinner('SF2')
      if (winSF1 && winSF2) {
        await ensureMatch('FINAL', 'Grand Final', winSF1.id, winSF2.id)
      }
      const mSF1 = knockoutMatches.find((km) => km.bracketSlot === 'SF1' && km.status === 'COMPLETED')
      const mSF2 = knockoutMatches.find((km) => km.bracketSlot === 'SF2' && km.status === 'COMPLETED')
      if (mSF1 && mSF2 && winSF1 && winSF2) {
        const loseSF1Id = winSF1.id === mSF1.teamAId ? mSF1.teamBId : mSF1.teamAId
        const loseSF2Id = winSF2.id === mSF2.teamAId ? mSF2.teamBId : mSF2.teamAId
        if (loseSF1Id && loseSF2Id && loseSF1Id !== loseSF2Id) {
          await ensureMatch('BRONZE', 'Perebutan Juara 3', loseSF1Id, loseSF2Id)
        }
      }
      return
    }

    // --- 2. LF UMUM (R1_1..5, R1_6A..C -> QF1..3 -> FINAL 1..3 Segitiga) ---
    if (!isSumo && !isSoccer) {
      const winR1_1 = getWinner('R1_1')
      const winR1_2 = getWinner('R1_2')
      if (winR1_1 && winR1_2) {
        await ensureMatch('QF1', 'Babak 2 - Blok Atas', winR1_1.id, winR1_2.id)
      }
      const winR1_3 = getWinner('R1_3')
      const winR1_4 = getWinner('R1_4')
      if (winR1_3 && winR1_4) {
        await ensureMatch('QF2', 'Babak 2 - Blok Tengah', winR1_3.id, winR1_4.id)
      }
      const winR1_5 = getWinner('R1_5')
      const triMatches = knockoutMatches.filter((m) => ['R1_6A', 'R1_6B', 'R1_6C'].includes(m.bracketSlot || ''))
      if (triMatches.length === 3 && triMatches.every((m) => m.status === 'COMPLETED')) {
        const stats = new Map<string, { teamId: string; pts: number; diff: number }>()
        for (const tm of triMatches) {
          if (!stats.has(tm.teamAId)) stats.set(tm.teamAId, { teamId: tm.teamAId, pts: 0, diff: 0 })
          if (!stats.has(tm.teamBId)) stats.set(tm.teamBId, { teamId: tm.teamBId, pts: 0, diff: 0 })
          const res = tm.results[0]
          if (res) {
            const pA = res.pointsA ?? res.finalGoalsA ?? 0
            const pB = res.pointsB ?? res.finalGoalsB ?? 0
            const sA = stats.get(tm.teamAId)!
            const sB = stats.get(tm.teamBId)!
            sA.diff += (pA - pB)
            sB.diff += (pB - pA)
            const wId = res.winnerTeamId || (pA > pB ? tm.teamAId : pB > pA ? tm.teamBId : null)
            if (wId === tm.teamAId) sA.pts += 3
            else if (wId === tm.teamBId) sB.pts += 3
            else if (pA === pB) {
              sA.pts += 1
              sB.pts += 1
            }
          }
        }
        const topTri = Array.from(stats.values()).sort((a, b) => b.pts - a.pts || b.diff - a.diff)[0]?.teamId
        if (winR1_5 && topTri) {
          await ensureMatch('QF3', 'Babak 2 - Blok Bawah', winR1_5.id, topTri)
        }
      }
      const winQF1 = getWinner('QF1')
      const winQF2 = getWinner('QF2')
      const winQF3 = getWinner('QF3')
      if (winQF1 && winQF2) {
        await ensureMatch('FINAL_1', 'Final Match 1 (Atas vs Tengah)', winQF1.id, winQF2.id)
      }
      if (winQF1 && winQF3) {
        await ensureMatch('FINAL_2', 'Final Match 2 (Atas vs Bawah)', winQF1.id, winQF3.id)
      }
      if (winQF2 && winQF3) {
        await ensureMatch('FINAL_3', 'Final Match 3 (Tengah vs Bawah)', winQF2.id, winQF3.id)
      }
      return
    }

    // --- 3. SOCCER & SUMOBOT (R1 -> Babak 2 -> Final Segitiga 3 Tim) ---
    // 1. Babak 2 (R2_1): Pemenang Match 1 (R1_AB) vs Pemenang Match 2 (R1_CD)
    const winM1 = getWinner('R1_AB')
    const winM2 = getWinner('R1_CD')
    if (winM1 && winM2) {
      await ensureMatch('R2_1', 'Babak 2 (Match 1 vs 2)', winM1.id, winM2.id)
    }

    // 2. Babak 2 (R2_2): Pemenang Match 3 (R1_EF) vs Pemenang Match 4 (R1_GH)
    const winM3 = getWinner('R1_EF')
    const winM4 = getWinner('R1_GH')
    if (winM3 && winM4) {
      await ensureMatch('R2_2', 'Babak 2 (Match 3 vs 4)', winM3.id, winM4.id)
    }

    // 3. Untuk Soccer: Babak 2 (R2_3) = Pemenang Match 5 (R1_IJ) vs Juara Grup K
    if (isSoccer) {
      const winM5 = getWinner('R1_IJ')
      let teamK = null
      const groupK = await client.competitionGroup.findFirst({
        where: { categoryId, name: { contains: 'K' } },
      })
      if (groupK) {
        const kMatches = await client.match.findMany({
          where: { groupId: groupK.id, stage: 'GROUP' },
          include: {
            teamA: true,
            teamB: true,
            results: { where: { status: 'FINAL' } },
          },
        })
        if (kMatches.length > 0 && kMatches.every((m) => m.status === 'COMPLETED')) {
          const stats = new Map<string, { team: any; points: number; diff: number }>()
          for (const m of kMatches) {
            if (!stats.has(m.teamAId)) stats.set(m.teamAId, { team: m.teamA, points: 0, diff: 0 })
            if (!stats.has(m.teamBId)) stats.set(m.teamBId, { team: m.teamB, points: 0, diff: 0 })
            const res = m.results[0]
            if (res) {
              const pA = res.pointsA ?? res.finalGoalsA ?? 0
              const pB = res.pointsB ?? res.finalGoalsB ?? 0
              const statA = stats.get(m.teamAId)!
              const statB = stats.get(m.teamBId)!
              statA.diff += (pA - pB)
              statB.diff += (pB - pA)
              const winId = res.winnerTeamId || (pA > pB ? m.teamAId : pB > pA ? m.teamBId : null)
              if (winId === m.teamAId) statA.points += 3
              else if (winId === m.teamBId) statB.points += 3
              else if (pA === pB) {
                statA.points += 1
                statB.points += 1
              }
            }
          }
          teamK = Array.from(stats.values()).sort((a, b) => b.points - a.points || b.diff - a.diff)[0]?.team ?? null
        }
      }
      if (!teamK) {
        const existingR2_3 = knockoutMatches.find((m) => m.bracketSlot === 'R2_3')
        if (existingR2_3) teamK = existingR2_3.teamB
      }
      if (winM5 && teamK) {
        await ensureMatch('R2_3', 'Babak 2 (Match 5 vs Grup K)', winM5.id, teamK.id)
      }
    }

    // 4. Final Segitiga 3 Tim:
    // Tim X = Pemenang R2_1 (M1 vs M2)
    // Tim Y = Pemenang R2_2 (M3 vs M4)
    // Tim Z:
    //   - Sumo: Pemenang Match 5 (R1_IJ)
    //   - Soccer: Pemenang R2_3 (Match 5 vs Juara Grup K)
    const winX = getWinner('R2_1')
    const winY = getWinner('R2_2')
    const winZ = isSoccer ? getWinner('R2_3') : getWinner('R1_IJ')

    if (winX && winY) {
      await ensureMatch('FINAL_1', 'Final Match 1 (X vs Y)', winX.id, winY.id)
    }
    if (winX && winZ) {
      await ensureMatch('FINAL_2', 'Final Match 2 (X vs Z)', winX.id, winZ.id)
    }
    if (winY && winZ) {
      await ensureMatch('FINAL_3', 'Final Match 3 (Y vs Z)', winY.id, winZ.id)
    }
  } catch {
    // Abaikan error agar tidak memutus respons operator
  }
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
      onResponse: async (request, reply) => {
        if (reply.statusCode === 200 && broadcastService) {
          try {
            const matchId = (request.params as { id: string }).id
            const arena = await client.arenaState.findFirst({
              where: { activeMatchId: matchId },
              select: { id: true },
            })
            await broadcastService.broadcastUpdate(arena?.id)
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
        include: {
          category: { select: { id: true, code: true } },
          segments: { orderBy: [{ ordinal: 'asc' }, { attempt: 'asc' }] },
        },
      })
      if (!match) {
        return errorResponse(reply, 404, 'NOT_FOUND', 'Match tidak ditemukan.', request.id)
      }
      if (match.matchVersion !== expectedMatchVersion) {
        return errorResponse(reply, 409, 'VERSION_CONFLICT', 'Match version conflict.', request.id, { currentMatchVersion: match.matchVersion })
      }

      const activeSegment = match.segments.find((s) => s.status === 'ACTIVE')
      const nextPreparedSegment = match.segments.find((s) => s.status === 'PREPARED')
      const currentSegment = (action === 'phase.advance' && (body?.targetPhase as string) === 'COMPETITION')
        ? (nextPreparedSegment || activeSegment || match.segments[match.segments.length - 1])
        : (activeSegment || nextPreparedSegment || match.segments[match.segments.length - 1])

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
        const catCode = (match.category?.code ?? '').toLowerCase()
        const defaultDuration = catCode.includes('soccer') ? 180_000 : 120_000
        const durationMs = (body?.durationMs as number) ?? defaultDuration

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
          const existing = await tx.segmentAttempt.findUnique({
            where: {
              matchId_ordinal_attempt: { matchId: match.id, ordinal, attempt: 1 },
            },
          })

          let seg
          if (existing) {
            seg = await tx.segmentAttempt.update({
              where: { id: existing.id },
              data: { status: 'PREPARED', durationMs },
            })
          } else {
            seg = await tx.segmentAttempt.create({
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
          }

          // SC-01: Invalidate any old READY goal intent
          await tx.goalIntent.updateMany({
            where: { matchId: match.id, status: 'READY' },
            data: { status: 'INVALIDATED' },
          })

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: {
              currentSegmentId: seg.id,
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

          if ((targetPhase === 'INTERMISSION' || targetPhase === 'RESULT') && activeSegment) {
            await tx.segmentAttempt.update({
              where: { id: activeSegment.id },
              data: {
                status: 'ENDED',
                endedAt: new Date(),
              },
            })
          }

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

      if (action === 'match.resume') {
        const reason = (body?.reason as string) ?? 'Lanjutkan pertandingan'
        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'start' },
          { role, hasStarted: match.hasStarted },
        )
        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Lanjutkan pertandingan tidak dapat dilakukan.', request.id)
        }

        if (timerService) {
          try {
            await timerService.resume(match.id, request.authPrincipal?.userId ?? null)
          } catch {
            try {
              await timerService.start({ matchId: match.id, actorId: request.authPrincipal?.userId ?? null })
            } catch {
              // ignore if timer not ready or mocked
            }
          }
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
              action: 'match.resume',
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

      if (action === 'match.rematch') {
        const evalRes = evaluateMatchTransition(
          match.status as MatchStatus,
          match.phase as MatchPhase | null,
          { type: 'rematch' },
          { role, hasStarted: match.hasStarted },
        )
        if (!evalRes.allowed) {
          return errorResponse(reply, 409, evalRes.errorCode ?? 'INVALID_TRANSITION', evalRes.message ?? 'Tanding ulang tidak dapat dilakukan.', request.id)
        }

        const prevResults = await client.resultRevision.findMany({
          where: { matchId: match.id },
          orderBy: { revision: 'desc' },
        })
        const latestFinal = prevResults.find((r) => r.status === 'FINAL')
        const previousWinnerId = latestFinal?.winnerTeamId

        const arena = await getOrCreateArena(client)

        const result = await client.$transaction(async (tx) => {
          if (previousWinnerId) {
            const downstreamMatches = await tx.match.findMany({
              where: {
                categoryId: match.categoryId,
                stage: 'KNOCKOUT',
                hasStarted: false,
                status: 'SCHEDULED',
                OR: [{ teamAId: previousWinnerId }, { teamBId: previousWinnerId }],
              },
            })
            for (const dm of downstreamMatches) {
              await tx.match.delete({ where: { id: dm.id } })
            }
          }

          // Clear currentSegmentId first to prevent foreign key violations
          await tx.match.update({
            where: { id: match.id },
            data: { currentSegmentId: null },
          })

          // Clear self-referencing goal correction foreign keys before deleting goals
          await tx.goalEvent.updateMany({
            where: { matchId: match.id },
            data: { correctsGoalId: null },
          })
          await tx.goalEvent.deleteMany({ where: { matchId: match.id } })
          await tx.goalIntent.deleteMany({ where: { matchId: match.id } })
          await tx.resultRevision.deleteMany({ where: { matchId: match.id } })

          await tx.segmentAttempt.deleteMany({
            where: {
              matchId: match.id,
              OR: [{ ordinal: { gt: 1 } }, { attempt: { gt: 1 } }],
            },
          })
          const seg1 = await tx.segmentAttempt.findFirst({
            where: { matchId: match.id, ordinal: 1, attempt: 1 },
          })
          let firstSegmentId = seg1?.id ?? null
          if (seg1) {
            await tx.segmentAttempt.update({
              where: { id: seg1.id },
              data: { status: 'PREPARED' },
            })
          }

          const timerInstance = await tx.timerInstance.findFirst({
            where: { matchId: match.id },
            orderBy: { createdAt: 'desc' },
          })
          if (timerInstance) {
            await tx.timerInstance.update({
              where: { id: timerInstance.id },
              data: {
                state: 'IDLE',
                remainingAtAnchorMs: timerInstance.initialMs,
                anchorWallUtc: null,
                checkpointWallUtc: null,
                checkpointSeq: { increment: 1 },
              },
            })
          }

          const updatedMatch = await tx.match.update({
            where: { id: match.id },
            data: {
              status: 'SCHEDULED',
              phase: 'PRE_MATCH',
              hasStarted: false,
              currentSegmentId: firstSegmentId,
              matchVersion: { increment: 1 },
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

          await tx.auditEntry.create({
            data: {
              id: randomUUID(),
              action: 'match.rematch',
              resourceType: 'Match',
              resourceId: match.id,
              actorId: request.authPrincipal?.userId ?? null,
              reason: (body?.reason as string) ?? 'Tanding ulang pertandingan',
            },
          })

          return { match: updatedMatch, arena: updatedArena }
        })

        if (timerService) {
          timerService.clearEngine(match.id)
        }

        if (match.stage === 'KNOCKOUT') {
          await autoSyncKnockoutProgression(client, match.categoryId)
        }
        if (match.stage === 'GROUP') {
          await autoSyncGroupWinnerToBracket(client, match.categoryId)
        }

        return reply.code(200).send({
          matchVersion: result.match.matchVersion,
          status: result.match.status,
          phase: result.match.phase,
          arenaVersion: result.arena.arenaVersion,
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
        const previousGoalIntentId = body?.previousGoalIntentId as string | undefined
        const targetSegmentAttemptId = body?.targetSegmentAttemptId as string | undefined

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
        let prev = null
        if (previousGoalIntentId && previousGoalIntentId !== 'last-consumed-id') {
          prev = await client.goalIntent.findUnique({
            where: { id: previousGoalIntentId },
          })
          if (prev && prev.matchId !== match.id) {
            return errorResponse(reply, 404, 'NOT_FOUND', 'Previous goal intent tidak ditemukan.', request.id)
          }
        }

        // Fallback: ambil intent terakhir yang sudah CONSUMED atau INVALIDATED pada match ini
        if (!prev) {
          prev = await client.goalIntent.findFirst({
            where: { matchId: match.id, status: { in: ['CONSUMED', 'INVALIDATED'] } },
            orderBy: { createdAt: 'desc' },
          })
        }

        if (prev?.status === 'READY') {
          return reply.code(200).send({
            goalIntentId: prev.id,
            status: prev.status,
            matchVersion: match.matchVersion,
          })
        }

        // Determine target segment attempt (must have been played / active)
        let segId = prev?.segmentAttemptId
        if (!segId) {
          const activeSeg = match.segments.find((s) => s.status === 'ACTIVE') || match.segments[0]
          segId = activeSeg?.id
        }

        if (targetSegmentAttemptId) {
          const seg = match.segments.find((s) => s.id === targetSegmentAttemptId)
          if (!seg || (!seg.activatedAt && seg.status === 'PREPARED')) {
            return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Target segment attempt tidak sah atau belum pernah dimainkan.', request.id)
          }
          segId = seg.id
        }

        if (!segId) {
          return errorResponse(reply, 404, 'NOT_FOUND', 'Segment attempt tidak ditemukan untuk menyiapkan gol.', request.id)
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

      if (action === 'goal.undo') {
        const side = body?.side as 'A' | 'B'
        if (side !== 'A' && side !== 'B') {
          return errorResponse(reply, 422, 'INVALID_INPUT', 'side (A/B) wajib diisi.', request.id)
        }

        if (timerService && timerService.getStorageHealth() === 'DEGRADED') {
          return errorResponse(reply, 503, 'STORAGE_DEGRADED', 'Penyimpanan terdegradasi. Undo gol ditolak.', request.id)
        }

        const isCompetition = match.phase === 'COMPETITION'
        const isResult = match.phase === 'RESULT'
        const isPaused = match.status === 'PAUSED'
        if (!isCompetition && !isResult && !isPaused) {
          return errorResponse(reply, 409, 'INVALID_TRANSITION', 'Undo gol hanya diizinkan saat pertandingan berjalan, dijeda, atau fase keputusan.', request.id)
        }

        const activeGoals = await client.goalEvent.findMany({
          where: { matchId: match.id, side, delta: 1 },
          include: { correctedBy: true },
          orderBy: { createdAt: 'desc' },
        })
        const targetGoal = activeGoals.find((g) => g.correctedBy.length === 0)
        if (!targetGoal) {
          return errorResponse(reply, 404, 'NOT_FOUND', `Tidak ada gol aktif yang dapat dibatalkan untuk Tim ${side}.`, request.id)
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
              reason: (body?.reason as string) ?? 'Undo gol operator',
              actorId: request.authPrincipal?.userId ?? null,
            },
          })

          const readyIntent = await tx.goalIntent.findFirst({
            where: { matchId: match.id, status: 'READY' },
          })
          if (!readyIntent) {
            await tx.goalIntent.create({
              data: {
                id: randomUUID(),
                matchId: match.id,
                segmentAttemptId: targetGoal.segmentAttemptId,
                status: 'READY',
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
              action: 'goal.undo',
              resourceType: 'GoalEvent',
              resourceId: correctionId,
              actorId: request.authPrincipal?.userId ?? null,
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

        // Sinkronisasi otomatis juara grup ke slot babak gugur jika match berada di fase GROUP
        if (match.stage === 'GROUP') {
          await autoSyncGroupWinnerToBracket(client, match.categoryId)
        }
        if (match.stage === 'KNOCKOUT') {
          await autoSyncKnockoutProgression(client, match.categoryId)
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
