import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  scheduleGenerateInputSchema,
  scheduleReorderInputSchema,
  tieConfigInputSchema,
  type MatchStage,
  type SchedulePreview,
  type SchedulePreviewGroup,
} from '@mrc-x/shared/server'
import { planGroupTies, type GeneratedMatchPlan } from './schedule-generation.js'

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

async function currentCatalogRevision(
  client: Prisma.TransactionClient | PrismaClient,
): Promise<number> {
  const config = await client.eventConfig.findFirst()
  return config?.catalogRevision ?? 1
}

interface GroupWithTeams {
  id: string
  name: string
  teams: Array<{ id: string; code: string; name: string }>
}

async function loadGroupsWithTeams(
  client: Prisma.TransactionClient | PrismaClient,
  categoryId: string,
  groupIds?: readonly string[],
): Promise<GroupWithTeams[]> {
  const groups = await client.competitionGroup.findMany({
    where: {
      categoryId,
      enabled: true,
      ...(groupIds && groupIds.length > 0 ? { id: { in: [...groupIds] } } : {}),
    },
    orderBy: { name: 'asc' },
    include: {
      members: {
        include: {
          team: { select: { id: true, code: true, name: true, archivedAt: true } },
        },
      },
    },
  })

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    teams: group.members
      .filter((member) => member.team.archivedAt === null)
      // Deterministic Tim A/B assignment: ascending team code.
      .map((member) => member.team)
      .sort((a, b) => a.code.localeCompare(b.code)),
  }))
}

interface PlannedGroup {
  group: GroupWithTeams
  plans: GeneratedMatchPlan[]
}

interface BuildPlanResult {
  groups: PlannedGroup[]
  invalidGroups: Array<{ groupId: string; groupName: string; teamCount: number }>
}

function buildPlan(
  categoryId: string,
  stage: MatchStage,
  rondeCount: number,
  groups: readonly GroupWithTeams[],
): BuildPlanResult {
  const planned: PlannedGroup[] = []
  const invalidGroups: BuildPlanResult['invalidGroups'] = []

  for (const group of groups) {
    if (group.teams.length < 2) {
      invalidGroups.push({
        groupId: group.id,
        groupName: group.name,
        teamCount: group.teams.length,
      })
      continue
    }

    planned.push({
      group,
      plans: planGroupTies({
        categoryId,
        stage,
        groupId: group.id,
        teamIds: group.teams.map((team) => team.id),
        rondeCount,
      }),
    })
  }

  return { groups: planned, invalidGroups }
}

async function existingTieKeys(
  client: Prisma.TransactionClient | PrismaClient,
  categoryId: string,
  stage: MatchStage,
): Promise<Set<string>> {
  const existing = await client.match.findMany({
    where: { categoryId, stage, tieId: { not: null }, rondeNumber: { not: null } },
    select: { tieId: true, rondeNumber: true },
  })

  const keys = new Set<string>()
  for (const row of existing) {
    keys.add(`${row.tieId}:${row.rondeNumber}`)
  }
  return keys
}

export function registerScheduleRoutes(
  server: FastifyInstance,
  client: PrismaClient,
): void {
  // --- TIE CONFIG (GET /api/v1/tie-configs) ---
  server.get<{ Querystring: { categoryId?: string } }>(
    '/api/v1/tie-configs',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const configs = await client.tieConfig.findMany({
        where: request.query.categoryId
          ? { categoryId: request.query.categoryId }
          : {},
        orderBy: [{ categoryId: 'asc' }, { stage: 'asc' }],
      })
      return reply.send(configs)
    },
  )

  // --- TIE CONFIG UPSERT (PUT /api/v1/tie-configs) ---
  server.put(
    '/api/v1/tie-configs',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const parsed = tieConfigInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Konfigurasi ronde tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }

      const category = await client.category.findUnique({
        where: { id: parsed.data.categoryId },
      })
      if (!category) {
        return errorResponse(
          reply,
          422,
          'CATEGORY_NOT_FOUND',
          'Kategori tidak ditemukan.',
          request.id,
        )
      }

      const existing = await client.tieConfig.findUnique({
        where: {
          categoryId_stage: {
            categoryId: parsed.data.categoryId,
            stage: parsed.data.stage,
          },
        },
      })

      if (existing && parsed.data.expectedRevision === undefined) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Konfigurasi sudah ada. Sertakan expectedRevision untuk mengubahnya.',
          request.id,
          { currentRevision: existing.revision },
        )
      }
      if (existing && parsed.data.expectedRevision !== existing.revision) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Konfigurasi telah berubah di perangkat lain.',
          request.id,
          { currentRevision: existing.revision },
        )
      }
      if (!existing && parsed.data.expectedRevision !== undefined) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Konfigurasi belum pernah dibuat. Hapus expectedRevision.',
          request.id,
        )
      }

      const saved = await client.$transaction(async (tx) => {
        const record = existing
          ? await tx.tieConfig.update({
              where: { id: existing.id },
              data: {
                rondeCount: parsed.data.rondeCount,
                approvedBy: parsed.data.approvedBy ?? null,
                sourceNote: parsed.data.sourceNote ?? null,
                revision: { increment: 1 },
              },
            })
          : await tx.tieConfig.create({
              data: {
                id: randomUUID(),
                categoryId: parsed.data.categoryId,
                stage: parsed.data.stage,
                rondeCount: parsed.data.rondeCount,
                approvedBy: parsed.data.approvedBy ?? null,
                sourceNote: parsed.data.sourceNote ?? null,
              },
            })

        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: existing ? 'tie-config.update' : 'tie-config.create',
            resourceType: 'TieConfig',
            resourceId: record.id,
            actorId: request.authPrincipal?.userId ?? null,
            beforeJson: existing ? JSON.stringify(existing) : null,
            afterJson: JSON.stringify(record),
          },
        })

        return record
      })

      return reply.code(existing ? 200 : 201).send(saved)
    },
  )

  // --- PREVIEW (GET /api/v1/match-schedules/group-preview) ---
  server.get<{
    Querystring: {
      categoryId?: string
      stage?: string
      rondeCount?: string
      groupIds?: string
      stageLabel?: string
    }
  }>(
    '/api/v1/match-schedules/group-preview',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const categoryId = request.query.categoryId
      const stage = (request.query.stage ?? 'GROUP') as MatchStage
      const rondeCount = Number(request.query.rondeCount)

      if (!categoryId) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'categoryId wajib diisi.',
          request.id,
        )
      }
      if (!Number.isInteger(rondeCount) || rondeCount < 1) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'rondeCount wajib diisi dengan bilangan bulat positif. Tidak ada nilai default.',
          request.id,
        )
      }
      if (stage !== 'GROUP' && stage !== 'KNOCKOUT' && stage !== 'FINAL') {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'stage harus GROUP, KNOCKOUT, atau FINAL.',
          request.id,
        )
      }

      const category = await client.category.findUnique({ where: { id: categoryId } })
      if (!category) {
        return errorResponse(
          reply,
          422,
          'CATEGORY_NOT_FOUND',
          'Kategori tidak ditemukan.',
          request.id,
        )
      }

      const requestedGroupIds = request.query.groupIds
        ? request.query.groupIds.split(',').filter(Boolean)
        : undefined

      const groups = await loadGroupsWithTeams(client, categoryId, requestedGroupIds)
      if (groups.length === 0) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'Kategori ini belum memiliki grup aktif untuk digenerate.',
          request.id,
        )
      }

      const { groups: plannedGroups, invalidGroups } = buildPlan(
        categoryId,
        stage,
        rondeCount,
        groups,
      )

      if (plannedGroups.length === 0) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'Tidak ada grup yang memiliki minimal dua tim aktif.',
          request.id,
          { invalidGroups },
        )
      }

      const existing = await existingTieKeys(client, categoryId, stage)

      const previewGroups: SchedulePreviewGroup[] = plannedGroups.map(
        ({ group, plans }) => {
          const teamById = new Map(group.teams.map((team) => [team.id, team]))
          let newCount = 0
          let existingCount = 0

          const matches = plans.map((plan) => {
            const exists = existing.has(`${plan.tieId}:${plan.rondeNumber}`)
            if (exists) existingCount++
            else newCount++

            const teamA = teamById.get(plan.teamAId)
            const teamB = teamById.get(plan.teamBId)

            return {
              tieId: plan.tieId,
              roundIndex: plan.roundIndex,
              rondeNumber: plan.rondeNumber,
              teamAId: plan.teamAId,
              teamACode: teamA?.code ?? plan.teamAId,
              teamAName: teamA?.name ?? plan.teamAId,
              teamBId: plan.teamBId,
              teamBCode: teamB?.code ?? plan.teamBId,
              teamBName: teamB?.name ?? plan.teamBId,
              exists,
            }
          })

          return {
            groupId: group.id,
            groupName: group.name,
            teamCount: group.teams.length,
            plannedCount: plans.length,
            existingCount,
            newCount,
            matches,
          }
        },
      )

      const preview: SchedulePreview = {
        categoryId,
        categoryCode: category.code,
        categoryLabel: category.label,
        stage,
        stageLabel: request.query.stageLabel ?? null,
        rondeCount,
        catalogRevision: await currentCatalogRevision(client),
        totalPlanned: previewGroups.reduce((sum, g) => sum + g.plannedCount, 0),
        totalNew: previewGroups.reduce((sum, g) => sum + g.newCount, 0),
        totalExisting: previewGroups.reduce((sum, g) => sum + g.existingCount, 0),
        groups: previewGroups,
      }

      return reply.send(preview)
    },
  )

  // --- GENERATE (POST /api/v1/match-schedules/generate) ---
  server.post(
    '/api/v1/match-schedules/generate',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const parsed = scheduleGenerateInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Permintaan generate tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }

      const { categoryId, stage, rondeCount, stageLabel, groupIds } = parsed.data
      const actorId = request.authPrincipal?.userId ?? null

      const category = await client.category.findUnique({ where: { id: categoryId } })
      if (!category) {
        return errorResponse(
          reply,
          422,
          'CATEGORY_NOT_FOUND',
          'Kategori tidak ditemukan.',
          request.id,
        )
      }

      const catalogRevision = await currentCatalogRevision(client)
      if (catalogRevision !== parsed.data.expectedCatalogRevision) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Katalog berubah sejak pratinjau. Muat ulang pratinjau sebelum generate.',
          request.id,
          { currentCatalogRevision: catalogRevision },
        )
      }

      const groups = await loadGroupsWithTeams(client, categoryId, groupIds)
      if (groups.length === 0) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'Kategori ini belum memiliki grup aktif untuk digenerate.',
          request.id,
        )
      }

      const { groups: plannedGroups, invalidGroups } = buildPlan(
        categoryId,
        stage,
        rondeCount,
        groups,
      )

      if (invalidGroups.length > 0) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'Setiap grup terpilih harus memiliki minimal dua tim aktif. Generate dibatalkan seluruhnya.',
          request.id,
          { invalidGroups },
        )
      }

      const existing = await existingTieKeys(client, categoryId, stage)

      const batchId = randomUUID()
      const result = await client.$transaction(async (tx) => {
        // Sequence continues after any manually scheduled match in this category.
        const maxSeq = await tx.match.aggregate({
          where: { categoryId },
          _max: { sequence: true },
        })
        let nextSequence = (maxSeq._max.sequence ?? 0) + 1

        let created = 0
        const skipped: Array<{
          groupId: string
          groupName: string
          tieId: string
          rondeNumber: number
          reason: 'ALREADY_EXISTS'
        }> = []
        const groupSummaries: Array<{
          groupId: string
          groupName: string
          created: number
          skipped: number
        }> = []

        for (const { group, plans } of plannedGroups) {
          let groupCreated = 0
          let groupSkipped = 0

          for (const plan of plans) {
            if (existing.has(`${plan.tieId}:${plan.rondeNumber}`)) {
              groupSkipped++
              skipped.push({
                groupId: group.id,
                groupName: group.name,
                tieId: plan.tieId,
                rondeNumber: plan.rondeNumber,
                reason: 'ALREADY_EXISTS',
              })
              continue
            }

            await tx.match.create({
              data: {
                id: randomUUID(),
                categoryId,
                groupId: plan.groupId,
                stage,
                stageLabel: stageLabel ?? null,
                sequence: nextSequence,
                teamAId: plan.teamAId,
                teamBId: plan.teamBId,
                status: 'SCHEDULED',
                matchVersion: 1,
                hasStarted: false,
                tieId: plan.tieId,
                rondeNumber: plan.rondeNumber,
                generationBatchId: batchId,
              },
            })

            nextSequence++
            groupCreated++
            created++
          }

          groupSummaries.push({
            groupId: group.id,
            groupName: group.name,
            created: groupCreated,
            skipped: groupSkipped,
          })
        }

        if (created === 0) {
          // Nothing to write: skip batch bookkeeping so an idle click leaves no trace.
          return { created, skipped, groupSummaries, newRevision: catalogRevision }
        }

        await tx.matchGenerationBatch.create({
          data: {
            id: batchId,
            categoryId,
            stage,
            rondeCount,
            stageLabel: stageLabel ?? null,
            createdCount: created,
            actorId,
          },
        })

        if (parsed.data.saveTieConfig) {
          const existingConfig = await tx.tieConfig.findUnique({
            where: { categoryId_stage: { categoryId, stage } },
          })
          if (existingConfig) {
            await tx.tieConfig.update({
              where: { id: existingConfig.id },
              data: { rondeCount, revision: { increment: 1 } },
            })
          } else {
            await tx.tieConfig.create({
              data: {
                id: randomUUID(),
                categoryId,
                stage,
                rondeCount,
                approvedBy: actorId,
              },
            })
          }
        }

        const config = await tx.eventConfig.findFirst()
        let newRevision = catalogRevision
        if (config) {
          const bumped = await tx.eventConfig.update({
            where: { id: config.id },
            data: { catalogRevision: { increment: 1 } },
          })
          newRevision = bumped.catalogRevision
        }

        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'match.schedule.generate',
            resourceType: 'MatchGenerationBatch',
            resourceId: batchId,
            actorId,
            afterJson: JSON.stringify({
              batchId,
              categoryId,
              stage,
              rondeCount,
              stageLabel: stageLabel ?? null,
              created,
              skippedCount: skipped.length,
              groups: groupSummaries,
            }),
          },
        })

        return { created, skipped, groupSummaries, newRevision }
      })

      return reply.code(result.created > 0 ? 201 : 200).send({
        batchId,
        categoryId,
        stage,
        rondeCount,
        created: result.created,
        skipped: result.skipped,
        groups: result.groupSummaries,
        catalogRevision: result.newRevision,
      })
    },
  )

  // --- REORDER (POST /api/v1/match-schedules/reorder) ---
  server.post(
    '/api/v1/match-schedules/reorder',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const parsed = scheduleReorderInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Permintaan susun ulang tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }

      const { categoryId, orderedMatchIds } = parsed.data
      const actorId = request.authPrincipal?.userId ?? null

      const catalogRevision = await currentCatalogRevision(client)
      if (catalogRevision !== parsed.data.expectedCatalogRevision) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Katalog berubah sejak daftar dimuat. Muat ulang sebelum menyusun ulang.',
          request.id,
          { currentCatalogRevision: catalogRevision },
        )
      }

      const matches = await client.match.findMany({
        where: { categoryId },
        select: { id: true, sequence: true, hasStarted: true, status: true },
      })

      if (matches.length !== orderedMatchIds.length) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'Daftar urutan harus memuat seluruh pertandingan kategori ini tepat satu kali.',
          request.id,
          { expectedCount: matches.length, receivedCount: orderedMatchIds.length },
        )
      }

      const known = new Set(matches.map((m) => m.id))
      const missing = orderedMatchIds.filter((id) => !known.has(id))
      if (missing.length > 0) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'Daftar urutan memuat pertandingan yang bukan milik kategori ini.',
          request.id,
          { unknownMatchIds: missing },
        )
      }

      const started = matches.filter((m) => m.hasStarted)
      if (started.length > 0) {
        return errorResponse(
          reply,
          409,
          'INVALID_TRANSITION',
          'Urutan tidak dapat diubah setelah ada pertandingan yang dimulai.',
          request.id,
          { startedMatchIds: started.map((m) => m.id) },
        )
      }

      const before = matches
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
        .map((m) => ({ id: m.id, sequence: m.sequence }))

      await client.$transaction(async (tx) => {
        // Two-phase renumber: UNIQUE(categoryId, sequence) forbids direct swaps,
        // and CHECK (sequence > 0) forbids negative placeholders. Park every row
        // above the current maximum first, then write the final values.
        const parkingBase = orderedMatchIds.length + 1
        for (const [index, matchId] of orderedMatchIds.entries()) {
          await tx.match.update({
            where: { id: matchId },
            data: { sequence: parkingBase + index },
          })
        }
        for (const [index, matchId] of orderedMatchIds.entries()) {
          await tx.match.update({
            where: { id: matchId },
            data: { sequence: index + 1, matchVersion: { increment: 1 } },
          })
        }

        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'match.schedule.reorder',
            resourceType: 'Match',
            resourceId: categoryId,
            actorId,
            beforeJson: JSON.stringify(before),
            afterJson: JSON.stringify(
              orderedMatchIds.map((id, index) => ({ id, sequence: index + 1 })),
            ),
          },
        })
      })

      return reply.send({
        categoryId,
        reordered: orderedMatchIds.length,
        orderedMatchIds,
      })
    },
  )

  // --- ROLLBACK (POST /api/v1/match-schedules/:batchId/rollback) ---
  server.post<{ Params: { batchId: string } }>(
    '/api/v1/match-schedules/:batchId/rollback',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest<{ Params: { batchId: string } }>, reply) => {
      const { batchId } = request.params
      const actorId = request.authPrincipal?.userId ?? null

      const batch = await client.matchGenerationBatch.findUnique({
        where: { id: batchId },
      })
      if (!batch) {
        return errorResponse(
          reply,
          404,
          'NOT_FOUND',
          'Batch generate tidak ditemukan.',
          request.id,
        )
      }
      if (batch.rolledBackAt) {
        return errorResponse(
          reply,
          409,
          'INVALID_TRANSITION',
          'Batch ini sudah dibatalkan sebelumnya.',
          request.id,
          { rolledBackAt: batch.rolledBackAt },
        )
      }

      const matches = await client.match.findMany({
        where: { generationBatchId: batchId },
        include: {
          _count: { select: { segments: true, goals: true, results: true } },
        },
      })

      if (matches.length === 0) {
        return errorResponse(
          reply,
          409,
          'INVALID_TRANSITION',
          'Batch ini tidak memiliki pertandingan tersisa.',
          request.id,
        )
      }

      const blocked = matches.filter(
        (m) =>
          m.hasStarted ||
          m.status !== 'SCHEDULED' ||
          m._count.segments > 0 ||
          m._count.goals > 0 ||
          m._count.results > 0,
      )

      if (blocked.length > 0) {
        return errorResponse(
          reply,
          409,
          'INVALID_TRANSITION',
          'Pembatalan ditolak: sebagian pertandingan batch sudah dimainkan atau memiliki data. Tidak ada yang dihapus.',
          request.id,
          {
            blockedMatches: blocked.map((m) => ({
              id: m.id,
              status: m.status,
              hasStarted: m.hasStarted,
              segments: m._count.segments,
              goals: m._count.goals,
              results: m._count.results,
            })),
          },
        )
      }

      const deleted = await client.$transaction(async (tx) => {
        const removal = await tx.match.deleteMany({
          where: {
            generationBatchId: batchId,
            status: 'SCHEDULED',
            hasStarted: false,
          },
        })

        await tx.matchGenerationBatch.update({
          where: { id: batchId },
          data: { rolledBackAt: new Date() },
        })

        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'match.schedule.rollback',
            resourceType: 'MatchGenerationBatch',
            resourceId: batchId,
            actorId,
            reason: 'Pembatalan batch generate jadwal babak grup',
            beforeJson: JSON.stringify({
              matchIds: matches.map((m) => m.id),
              createdCount: batch.createdCount,
            }),
            afterJson: JSON.stringify({ deletedCount: removal.count }),
          },
        })

        return removal.count
      })

      return reply.send({
        batchId,
        deleted,
        rolledBack: true,
      })
    },
  )

  // --- CATALOG REVISION (GET /api/v1/match-schedules/catalog-revision) ---
  // Lightweight read so the UI can bind reorder to the revision it just saw
  // without triggering a full preview computation.
  server.get(
    '/api/v1/match-schedules/catalog-revision',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (_request, reply) => {
      return reply.send({ catalogRevision: await currentCatalogRevision(client) })
    },
  )

  // --- BATCH LIST (GET /api/v1/match-schedules/batches) ---
  server.get<{ Querystring: { categoryId?: string } }>(
    '/api/v1/match-schedules/batches',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const batches = await client.matchGenerationBatch.findMany({
        where: {
          ...(request.query.categoryId
            ? { categoryId: request.query.categoryId }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      return reply.send(batches)
    },
  )
}
