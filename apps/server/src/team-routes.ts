import { createHash, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  categoryInputSchema,
  categoryPatchInputSchema,
  groupInputSchema,
  groupPatchInputSchema,
  matchScheduleInputSchema,
  matchSchedulePatchInputSchema,
  teamImportCommitInputSchema,
  teamImportPreviewInputSchema,
  teamInputSchema,
  teamPatchInputSchema,
} from '@mrc-x/shared/server'

interface TeamImportPreviewJob {
  id: string
  previewHash: string
  catalogRevision: number
  createdAt: number
  valid: boolean
  rows: Array<{
    categoryCode: string
    teamCode: string
    teamName: string
    institution: string | null
    groupName: string | null
    categoryId: string
    groupId: string | null
  }>
  errors: Array<{ row: number; column?: string; message: string }>
}

const previewCache = new Map<string, TeamImportPreviewJob>()
const PREVIEW_TTL_MS = 15 * 60 * 1000 // 15 minutes

function pruneExpiredPreviews(now: number): void {
  for (const [id, job] of previewCache.entries()) {
    if (now - job.createdAt > PREVIEW_TTL_MS) {
      previewCache.delete(id)
    }
  }
  while (previewCache.size > 100) {
    const oldestKey = previewCache.keys().next().value
    if (oldestKey !== undefined) {
      previewCache.delete(oldestKey)
    } else {
      break
    }
  }
}

async function getOrCreateEventConfig(
  client: Prisma.TransactionClient | PrismaClient,
) {
  let config = await client.eventConfig.findFirst()
  if (!config) {
    config = await client.eventConfig.create({
      data: {
        id: 'main',
        eventName: 'MRC X 2026',
        timezone: 'Asia/Jakarta',
        schemaVersion: '20261018190000',
        appVersion: '1.0.0',
        dataLocation: 'local',
        catalogRevision: 1,
        storageEpoch: 1,
      },
    })
  }
  return config
}

async function bumpCatalogRevision(
  tx: Prisma.TransactionClient,
): Promise<number> {
  const config = await getOrCreateEventConfig(tx)
  const updated = await tx.eventConfig.update({
    where: { id: config.id },
    data: { catalogRevision: { increment: 1 } },
  })
  return updated.catalogRevision
}

function parseCsvLines(csv: string): string[][] {
  const lines: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < csv.length && csv[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        row.push(cell.trim())
        cell = ''
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && i + 1 < csv.length && csv[i + 1] === '\n') {
          i++
        }
        row.push(cell.trim())
        if (row.length > 1 || row[0] !== '') {
          lines.push(row)
        }
        row = []
        cell = ''
      } else {
        cell += char
      }
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim())
    if (row.length > 1 || row[0] !== '') {
      lines.push(row)
    }
  }
  return lines
}

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

export function registerTeamRoutes(
  server: FastifyInstance,
  client: PrismaClient,
): void {
  // --- CATEGORIES ---
  server.get(
    '/api/v1/categories',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (_request, reply) => {
      const categories = await client.category.findMany({
        orderBy: { code: 'asc' },
      })
      return reply.send(categories)
    },
  )

  server.post(
    '/api/v1/categories',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const parsed = categoryInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data kategori tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }
      const existing = await client.category.findUnique({
        where: { code: parsed.data.code },
      })
      if (existing) {
        return errorResponse(
          reply,
          422,
          'DUPLICATE_CODE',
          'Kode kategori sudah digunakan.',
          request.id,
        )
      }

      const id = randomUUID()
      const actorId = request.authPrincipal?.userId ?? null
      const created = await client.$transaction(async (tx) => {
        const cat = await tx.category.create({
          data: {
            id,
            code: parsed.data.code,
            label: parsed.data.label,
            enabled: parsed.data.enabled,
            revision: 1,
          },
        })
        await bumpCatalogRevision(tx)
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'category.create',
            actorId,
            resourceType: 'Category',
            resourceId: id,
            afterJson: JSON.stringify(cat),
          },
        })
        return cat
      })
      return reply.code(201).send(created)
    },
  )

  server.patch<{ Params: { id: string } }>(
    '/api/v1/categories/:id',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const parsed = categoryPatchInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data kategori tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }
      const existing = await client.category.findUnique({
        where: { id: request.params.id },
      })
      if (!existing) {
        return errorResponse(
          reply,
          404,
          'NOT_FOUND',
          'Kategori tidak ditemukan.',
          request.id,
        )
      }
      if (existing.revision !== parsed.data.expectedRevision) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Revisi kategori telah berubah.',
          request.id,
        )
      }

      const actorId = request.authPrincipal?.userId ?? null
      const updated = await client.$transaction(async (tx) => {
        const cat = await tx.category.update({
          where: { id: existing.id, revision: existing.revision },
          data: {
            label: parsed.data.label ?? existing.label,
            enabled: parsed.data.enabled ?? existing.enabled,
            revision: { increment: 1 },
          },
        })
        await bumpCatalogRevision(tx)
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'category.update',
            actorId,
            resourceType: 'Category',
            resourceId: existing.id,
            beforeJson: JSON.stringify(existing),
            afterJson: JSON.stringify(cat),
          },
        })
        return cat
      })
      return reply.send(updated)
    },
  )

  // --- GROUPS ---
  server.get<{ Querystring: { categoryId?: string } }>(
    '/api/v1/groups',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request, reply) => {
      const where = request.query.categoryId
        ? { categoryId: request.query.categoryId }
        : {}
      const groups = await client.competitionGroup.findMany({
        where,
        orderBy: { name: 'asc' },
      })
      return reply.send(groups)
    },
  )

  server.post(
    '/api/v1/groups',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const parsed = groupInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data grup tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }
      const category = await client.category.findUnique({
        where: { id: parsed.data.categoryId },
      })
      if (!category || !category.enabled) {
        return errorResponse(
          reply,
          422,
          'CATEGORY_NOT_FOUND',
          'Kategori tidak ditemukan atau tidak aktif.',
          request.id,
        )
      }

      const existing = await client.competitionGroup.findUnique({
        where: {
          categoryId_name: {
            categoryId: parsed.data.categoryId,
            name: parsed.data.name,
          },
        },
      })
      if (existing) {
        return errorResponse(
          reply,
          422,
          'DUPLICATE_GROUP_NAME',
          'Nama grup sudah ada dalam kategori ini.',
          request.id,
        )
      }

      const id = randomUUID()
      const actorId = request.authPrincipal?.userId ?? null
      const created = await client.$transaction(async (tx) => {
        const grp = await tx.competitionGroup.create({
          data: {
            id,
            categoryId: parsed.data.categoryId,
            name: parsed.data.name,
            enabled: true,
            revision: 1,
          },
        })
        await bumpCatalogRevision(tx)
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'group.create',
            actorId,
            resourceType: 'Group',
            resourceId: id,
            afterJson: JSON.stringify(grp),
          },
        })
        return grp
      })
      return reply.code(201).send(created)
    },
  )

  server.patch<{ Params: { id: string } }>(
    '/api/v1/groups/:id',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const parsed = groupPatchInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data grup tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }
      const existing = await client.competitionGroup.findUnique({
        where: { id: request.params.id },
      })
      if (!existing) {
        return errorResponse(
          reply,
          404,
          'NOT_FOUND',
          'Grup tidak ditemukan.',
          request.id,
        )
      }
      if (existing.revision !== parsed.data.expectedRevision) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Revisi grup telah berubah.',
          request.id,
        )
      }

      const actorId = request.authPrincipal?.userId ?? null
      const updated = await client.$transaction(async (tx) => {
        const grp = await tx.competitionGroup.update({
          where: { id: existing.id, revision: existing.revision },
          data: {
            name: parsed.data.name ?? existing.name,
            enabled: parsed.data.enabled ?? existing.enabled,
            revision: { increment: 1 },
          },
        })
        await bumpCatalogRevision(tx)
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'group.update',
            actorId,
            resourceType: 'Group',
            resourceId: existing.id,
            beforeJson: JSON.stringify(existing),
            afterJson: JSON.stringify(grp),
          },
        })
        return grp
      })
      return reply.send(updated)
    },
  )

  // --- TEAMS ---
  server.get<{
    Querystring: { categoryId?: string; includeArchived?: string }
  }>(
    '/api/v1/teams',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request, reply) => {
      const includeArchived = request.query.includeArchived === 'true'
      const where: Prisma.TeamWhereInput = {
        ...(request.query.categoryId
          ? { categoryId: request.query.categoryId }
          : {}),
        ...(includeArchived ? {} : { archivedAt: null }),
      }

      const teams = await client.team.findMany({
        where,
        include: {
          memberships: {
            select: { groupId: true },
          },
        },
        orderBy: [{ categoryId: 'asc' }, { code: 'asc' }],
      })

      const mapped = teams.map((team) => ({
        id: team.id,
        categoryId: team.categoryId,
        code: team.code,
        name: team.name,
        institution: team.institution,
        groupId: team.memberships[0]?.groupId ?? null,
        archivedAt: team.archivedAt?.toISOString() ?? null,
        revision: team.revision,
      }))
      return reply.send(mapped)
    },
  )

  server.post(
    '/api/v1/teams',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const parsed = teamInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data tim tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }
      const category = await client.category.findUnique({
        where: { id: parsed.data.categoryId },
      })
      if (!category || !category.enabled) {
        return errorResponse(
          reply,
          422,
          'CATEGORY_NOT_FOUND',
          'Kategori tidak ditemukan atau tidak aktif.',
          request.id,
        )
      }

      const duplicate = await client.team.findUnique({
        where: {
          categoryId_code: {
            categoryId: parsed.data.categoryId,
            code: parsed.data.code,
          },
        },
      })
      if (duplicate) {
        return errorResponse(
          reply,
          422,
          'DUPLICATE_CODE',
          'Kode tim sudah digunakan dalam kategori ini.',
          request.id,
        )
      }

      if (parsed.data.groupId) {
        const group = await client.competitionGroup.findUnique({
          where: { id: parsed.data.groupId },
        })
        if (!group || group.categoryId !== parsed.data.categoryId) {
          return errorResponse(
            reply,
            422,
            'CATEGORY_MISMATCH',
            'Grup tidak sesuai dengan kategori tim.',
            request.id,
          )
        }
      }

      const id = randomUUID()
      const actorId = request.authPrincipal?.userId ?? null
      const created = await client.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: {
            id,
            categoryId: parsed.data.categoryId,
            code: parsed.data.code,
            name: parsed.data.name,
            institution: parsed.data.institution ?? null,
            revision: 1,
          },
        })
        if (parsed.data.groupId) {
          await tx.groupMembership.create({
            data: {
              id: randomUUID(),
              categoryId: parsed.data.categoryId,
              groupId: parsed.data.groupId,
              teamId: id,
            },
          })
        }
        await bumpCatalogRevision(tx)
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'team.create',
            actorId,
            resourceType: 'Team',
            resourceId: id,
            afterJson: JSON.stringify({
              ...team,
              groupId: parsed.data.groupId ?? null,
            }),
          },
        })
        return {
          ...team,
          groupId: parsed.data.groupId ?? null,
          archivedAt: null,
        }
      })
      return reply.code(201).send(created)
    },
  )

  server.patch<{ Params: { id: string } }>(
    '/api/v1/teams/:id',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const parsed = teamPatchInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data perubahan tim tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }
      const existing = await client.team.findUnique({
        where: { id: request.params.id },
        include: { memberships: true },
      })
      if (!existing) {
        return errorResponse(
          reply,
          404,
          'NOT_FOUND',
          'Tim tidak ditemukan.',
          request.id,
        )
      }
      if (existing.revision !== parsed.data.expectedRevision) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Revisi tim telah berubah.',
          request.id,
        )
      }

      if (parsed.data.groupId) {
        const group = await client.competitionGroup.findUnique({
          where: { id: parsed.data.groupId },
        })
        if (!group || group.categoryId !== existing.categoryId) {
          return errorResponse(
            reply,
            422,
            'CATEGORY_MISMATCH',
            'Grup tidak sesuai dengan kategori tim.',
            request.id,
          )
        }
      }

      const actorId = request.authPrincipal?.userId ?? null
      const now = new Date()
      const updated = await client.$transaction(async (tx) => {
        let archivedAt = existing.archivedAt
        if (parsed.data.archived === true) {
          archivedAt = now
        } else if (parsed.data.archived === false) {
          archivedAt = null
        }

        const team = await tx.team.update({
          where: { id: existing.id, revision: existing.revision },
          data: {
            name: parsed.data.name ?? existing.name,
            institution:
              parsed.data.institution !== undefined
                ? parsed.data.institution
                : existing.institution,
            archivedAt,
            revision: { increment: 1 },
          },
        })

        let currentGroupId: string | null =
          existing.memberships[0]?.groupId ?? null
        if (parsed.data.groupId === null) {
          await tx.groupMembership.deleteMany({
            where: { teamId: existing.id },
          })
          currentGroupId = null
        } else if (
          typeof parsed.data.groupId === 'string' &&
          parsed.data.groupId !== currentGroupId
        ) {
          await tx.groupMembership.deleteMany({
            where: { teamId: existing.id },
          })
          await tx.groupMembership.create({
            data: {
              id: randomUUID(),
              categoryId: existing.categoryId,
              groupId: parsed.data.groupId,
              teamId: existing.id,
            },
          })
          currentGroupId = parsed.data.groupId
        }

        await bumpCatalogRevision(tx)
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: parsed.data.archived ? 'team.archive' : 'team.update',
            actorId,
            resourceType: 'Team',
            resourceId: existing.id,
            beforeJson: JSON.stringify({
              ...existing,
              groupId: existing.memberships[0]?.groupId ?? null,
            }),
            afterJson: JSON.stringify({
              ...team,
              groupId: currentGroupId,
            }),
          },
        })
        return {
          ...team,
          groupId: currentGroupId,
          archivedAt: team.archivedAt?.toISOString() ?? null,
        }
      })
      return reply.send(updated)
    },
  )

  // --- CATALOG REVISION ---
  // The UI needs the exact revision the import endpoints enforce. Reading it
  // from Category.revision was wrong: that counter is per category and never
  // tracks EventConfig.catalogRevision, which made imports unreachable.
  server.get(
    '/api/v1/catalog-revision',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (_request, reply) => {
      const config = await getOrCreateEventConfig(client)
      return reply.send({ catalogRevision: config.catalogRevision })
    },
  )

  // --- TEAM IMPORTS (PREVIEW & COMMIT) ---
  server.post(
    '/api/v1/team-imports/preview',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const parsed = teamImportPreviewInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data import tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }

      const config = await getOrCreateEventConfig(client)
      if (parsed.data.expectedRevision !== config.catalogRevision) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Revisi katalog telah berubah.',
          request.id,
          // Tell the caller which revision is current so the UI can recover
          // instead of resending a value it guessed.
          { currentCatalogRevision: config.catalogRevision },
        )
      }

      const lines = parseCsvLines(parsed.data.csvContent)
      if (lines.length < 2) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'CSV harus memiliki header dan minimal satu baris data.',
          request.id,
        )
      }

      const firstLine = lines[0] ?? []
      const header = firstLine.map((h) => h.toLowerCase())
      const expectedHeader = [
        'categorycode',
        'teamcode',
        'teamname',
        'institution',
        'groupname',
      ]
      const isHeaderMatch =
        header.length >= 5 &&
        expectedHeader.every((col, idx) => header[idx] === col)

      if (!isHeaderMatch) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Header CSV tidak valid. Gunakan: categoryCode,teamCode,teamName,institution,groupName',
          request.id,
        )
      }

      if (lines.length > 5001) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Maksimal 5.000 baris per file CSV.',
          request.id,
        )
      }

      const categories = await client.category.findMany()
      // Panitia rarely matches letter case exactly. Normalise both sides so
      // "LF-OPEN" and "lf-open" resolve to the same category, and "Grup A" and
      // "group a" resolve to the same group.
      const categoryMap = new Map(
        categories.map((c) => [c.code.trim().toLowerCase(), c]),
      )
      const groups = await client.competitionGroup.findMany()
      const groupMap = new Map(
        groups.map((g) => [
          `${g.categoryId}:${g.name.trim().toLowerCase()}`,
          g,
        ]),
      )
      const existingTeams = await client.team.findMany({
        select: { categoryId: true, code: true },
      })
      const existingTeamSet = new Set(
        existingTeams.map((t) => `${t.categoryId}:${t.code}`),
      )

      const errors: Array<{ row: number; column?: string; message: string }> = []
      const batchCodes = new Set<string>()
      const validatedRows: TeamImportPreviewJob['rows'] = []

      for (let i = 1; i < lines.length; i++) {
        const rowNum = i + 1
        const line = lines[i] ?? []
        const categoryCode = line[0]?.trim() ?? ''
        const teamCode = line[1]?.trim() ?? ''
        const teamName = line[2]?.trim() ?? ''
        const institution = line[3]?.trim() || null
        const groupName = line[4]?.trim() || null

        if (!categoryCode) {
          errors.push({
            row: rowNum,
            column: 'categoryCode',
            message: 'Kode kategori wajib diisi.',
          })
          continue
        }
        const category = categoryMap.get(categoryCode.toLowerCase())
        if (!category || !category.enabled) {
          errors.push({
            row: rowNum,
            column: 'categoryCode',
            message: `Kategori "${categoryCode}" tidak ditemukan atau non-aktif.`,
          })
          continue
        }

        if (!teamCode) {
          errors.push({
            row: rowNum,
            column: 'teamCode',
            message: 'Kode tim wajib diisi.',
          })
          continue
        }
        const codeKey = `${category.id}:${teamCode}`
        if (batchCodes.has(codeKey) || existingTeamSet.has(codeKey)) {
          errors.push({
            row: rowNum,
            column: 'teamCode',
            message: `Kode tim "${teamCode}" duplikat pada kategori "${categoryCode}".`,
          })
          continue
        }
        batchCodes.add(codeKey)

        if (!teamName) {
          errors.push({
            row: rowNum,
            column: 'teamName',
            message: 'Nama tim wajib diisi.',
          })
          continue
        }

        let groupId: string | null = null
        if (groupName) {
          const group = groupMap.get(
            `${category.id}:${groupName.toLowerCase()}`,
          )
          if (!group || !group.enabled) {
            errors.push({
              row: rowNum,
              column: 'groupName',
              message: `Grup "${groupName}" tidak ditemukan dalam kategori "${categoryCode}".`,
            })
            continue
          }
          groupId = group.id
        }

        validatedRows.push({
          categoryCode,
          teamCode,
          teamName,
          institution,
          groupName,
          categoryId: category.id,
          groupId,
        })
      }

      const now = Date.now()
      pruneExpiredPreviews(now)

      const hashData = JSON.stringify({
        rows: validatedRows,
        revision: config.catalogRevision,
      })
      const previewHash = createHash('sha256').update(hashData).digest('hex')
      const previewId = randomUUID()

      previewCache.set(previewId, {
        id: previewId,
        previewHash,
        catalogRevision: config.catalogRevision,
        createdAt: now,
        valid: errors.length === 0,
        rows: validatedRows,
        errors,
      })

      return reply.send({
        id: previewId,
        valid: errors.length === 0,
        previewHash,
        catalogRevision: config.catalogRevision,
        // Categories the rows target, so the UI can reveal the imported teams.
        // A batch may span several categories; reporting only the first would
        // hide the rest, which is the same class of bug this fix addresses.
        categoryIds: [...new Set(validatedRows.map((r) => r.categoryId))],
        categoryId: validatedRows[0]?.categoryId ?? null,
        summary: {
          totalRows: lines.length - 1,
          validRows: validatedRows.length,
          errorRows: errors.length,
        },
        errors,
      })
    },
  )

  server.post<{ Params: { id: string } }>(
    '/api/v1/team-imports/:id/commit',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const parsed = teamImportCommitInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data konfirmasi impor tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }

      const preview = previewCache.get(request.params.id)
      if (!preview) {
        return errorResponse(
          reply,
          404,
          'NOT_FOUND',
          'Pratinjau tidak ditemukan. Pratinjau disimpan di memori server, sehingga hilang bila server dimulai ulang atau lewat 15 menit. Ulangi Pratinjau Impor.',
          request.id,
        )
      }

      if (!preview.valid || preview.errors.length > 0) {
        return errorResponse(
          reply,
          422,
          'INVALID_INPUT',
          'All-or-nothing: impor ditolak karena terdapat baris yang salah.',
          request.id,
        )
      }

      const config = await getOrCreateEventConfig(client)
      if (
        parsed.data.expectedRevision !== config.catalogRevision ||
        preview.catalogRevision !== config.catalogRevision ||
        parsed.data.previewHash !== preview.previewHash
      ) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Pratinjau kedaluwarsa: katalog telah diperbarui sejak pratinjau dibuat. Ulangi Pratinjau Impor.',
          request.id,
          { currentCatalogRevision: config.catalogRevision },
        )
      }

      const actorId = request.authPrincipal?.userId ?? null
      const result = await client.$transaction(async (tx) => {
        for (const row of preview.rows) {
          const teamId = randomUUID()
          await tx.team.create({
            data: {
              id: teamId,
              categoryId: row.categoryId,
              code: row.teamCode,
              name: row.teamName,
              institution: row.institution,
              revision: 1,
            },
          })
          if (row.groupId) {
            await tx.groupMembership.create({
              data: {
                id: randomUUID(),
                categoryId: row.categoryId,
                groupId: row.groupId,
                teamId,
              },
            })
          }
        }

        const newRevision = await bumpCatalogRevision(tx)
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'team.import',
            actorId,
            resourceType: 'Team',
            afterJson: JSON.stringify({
              importedCount: preview.rows.length,
              previewHash: preview.previewHash,
            }),
          },
        })
        return { importedCount: preview.rows.length, catalogRevision: newRevision }
      })

      previewCache.delete(request.params.id)
      return reply.send({
        committed: true,
        importedCount: result.importedCount,
        catalogRevision: result.catalogRevision,
      })
    },
  )

  // --- MATCHES (SCHEDULE & CORRECTION) ---
  server.get<{ Querystring: { categoryId?: string; status?: string } }>(
    '/api/v1/matches',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request, reply) => {
      const where: Prisma.MatchWhereInput = {
        ...(request.query.categoryId
          ? { categoryId: request.query.categoryId }
          : {}),
        ...(request.query.status ? { status: request.query.status } : {}),
      }
      const matches = await client.match.findMany({
        where,
        include: {
          category: { select: { id: true, code: true, label: true } },
          group: { select: { id: true, name: true } },
          teamA: {
            select: { id: true, code: true, name: true, institution: true },
          },
          teamB: {
            select: { id: true, code: true, name: true, institution: true },
          },
          results: {
            where: { status: 'FINAL' },
            select: {
              revision: true,
              status: true,
              decisionText: true,
              winnerTeamId: true,
              finalGoalsA: true,
              finalGoalsB: true,
              pointsA: true,
              pointsB: true,
              refereeReference: true,
            },
          },
        },
        orderBy: [{ sequence: 'asc' }, { scheduledAt: 'asc' }],
      })
      return reply.send(matches)
    },
  )

  server.post(
    '/api/v1/matches',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request: FastifyRequest, reply) => {
      const parsed = matchScheduleInputSchema.safeParse(request.body)
      if (!parsed.success) {
        const isSameTeam = parsed.error.issues.some(
          (i) => i.message === 'Tim A dan Tim B harus berbeda',
        )
        if (isSameTeam) {
          return errorResponse(
            reply,
            422,
            'SAME_TEAM_FORBIDDEN',
            'Tim A dan Tim B tidak boleh sama.',
            request.id,
            { fieldErrors: parsed.error.issues },
          )
        }
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data jadwal match tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }
      if (parsed.data.teamAId === parsed.data.teamBId) {
        return errorResponse(
          reply,
          422,
          'SAME_TEAM_FORBIDDEN',
          'Tim A dan Tim B tidak boleh sama.',
          request.id,
        )
      }

      const category = await client.category.findUnique({
        where: { id: parsed.data.categoryId },
      })
      if (!category || !category.enabled) {
        return errorResponse(
          reply,
          422,
          'CATEGORY_NOT_FOUND',
          'Kategori tidak ditemukan atau tidak aktif.',
          request.id,
        )
      }

      if (parsed.data.groupId) {
        const group = await client.competitionGroup.findUnique({
          where: { id: parsed.data.groupId },
        })
        if (!group || group.categoryId !== parsed.data.categoryId) {
          return errorResponse(
            reply,
            422,
            'CATEGORY_MISMATCH',
            'Grup tidak sesuai dengan kategori match.',
            request.id,
          )
        }
      }

      const teamA = await client.team.findUnique({
        where: { id: parsed.data.teamAId },
      })
      const teamB = await client.team.findUnique({
        where: { id: parsed.data.teamBId },
      })

      if (
        !teamA ||
        teamA.categoryId !== parsed.data.categoryId ||
        teamA.archivedAt !== null
      ) {
        return errorResponse(
          reply,
          422,
          'CATEGORY_MISMATCH',
          'Tim A tidak ditemukan, tidak sesuai kategori, atau telah diarsipkan.',
          request.id,
        )
      }
      if (
        !teamB ||
        teamB.categoryId !== parsed.data.categoryId ||
        teamB.archivedAt !== null
      ) {
        return errorResponse(
          reply,
          422,
          'CATEGORY_MISMATCH',
          'Tim B tidak ditemukan, tidak sesuai kategori, atau telah diarsipkan.',
          request.id,
        )
      }

      const id = randomUUID()
      const actorId = request.authPrincipal?.userId ?? null
      const created = await client.$transaction(async (tx) => {
        const match = await tx.match.create({
          data: {
            id,
            categoryId: parsed.data.categoryId,
            groupId: parsed.data.groupId ?? null,
            stage: parsed.data.stage ?? 'GROUP',
            stageLabel: parsed.data.stageLabel ?? null,
            bracketSlot: parsed.data.bracketSlot ?? null,
            scheduledAt: parsed.data.scheduledAt
              ? new Date(parsed.data.scheduledAt)
              : null,
            sequence: parsed.data.sequence,
            teamAId: parsed.data.teamAId,
            teamBId: parsed.data.teamBId,
            status: 'SCHEDULED',
            matchVersion: 1,
            hasStarted: false,
          },
        })
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'match.schedule',
            actorId,
            resourceType: 'Match',
            resourceId: id,
            afterJson: JSON.stringify(match),
          },
        })
        return match
      })
      return reply.code(201).send(created)
    },
  )

  server.patch<{ Params: { id: string } }>(
    '/api/v1/matches/:id',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const parsed = matchSchedulePatchInputSchema.safeParse(request.body)
      if (!parsed.success) {
        return errorResponse(
          reply,
          400,
          'INVALID_INPUT',
          'Data koreksi jadwal tidak valid.',
          request.id,
          { fieldErrors: parsed.error.issues },
        )
      }

      const existing = await client.match.findUnique({
        where: { id: request.params.id },
      })
      if (!existing) {
        return errorResponse(
          reply,
          404,
          'NOT_FOUND',
          'Jadwal match tidak ditemukan.',
          request.id,
        )
      }

      if (existing.matchVersion !== parsed.data.expectedMatchVersion) {
        return errorResponse(
          reply,
          409,
          'VERSION_CONFLICT',
          'Versi match telah berubah.',
          request.id,
        )
      }

      if (existing.hasStarted || existing.status !== 'SCHEDULED') {
        return errorResponse(
          reply,
          422,
          'MATCH_ALREADY_STARTED',
          'Pembetulan jadwal hanya diizinkan sebelum match bermain.',
          request.id,
        )
      }

      const targetTeamAId = parsed.data.teamAId ?? existing.teamAId
      const targetTeamBId = parsed.data.teamBId ?? existing.teamBId
      if (targetTeamAId === targetTeamBId) {
        return errorResponse(
          reply,
          422,
          'SAME_TEAM_FORBIDDEN',
          'Tim A dan Tim B tidak boleh sama.',
          request.id,
        )
      }

      if (parsed.data.teamAId && parsed.data.teamAId !== existing.teamAId) {
        const teamA = await client.team.findUnique({
          where: { id: parsed.data.teamAId },
        })
        if (
          !teamA ||
          teamA.categoryId !== existing.categoryId ||
          teamA.archivedAt !== null
        ) {
          return errorResponse(
            reply,
            422,
            'CATEGORY_MISMATCH',
            'Tim A tidak valid atau telah diarsipkan.',
            request.id,
          )
        }
      }

      if (parsed.data.teamBId && parsed.data.teamBId !== existing.teamBId) {
        const teamB = await client.team.findUnique({
          where: { id: parsed.data.teamBId },
        })
        if (
          !teamB ||
          teamB.categoryId !== existing.categoryId ||
          teamB.archivedAt !== null
        ) {
          return errorResponse(
            reply,
            422,
            'CATEGORY_MISMATCH',
            'Tim B tidak valid atau telah diarsipkan.',
            request.id,
          )
        }
      }

      const actorId = request.authPrincipal?.userId ?? null
      const updated = await client.$transaction(async (tx) => {
        const match = await tx.match.update({
          where: { id: existing.id, matchVersion: existing.matchVersion },
          data: {
            stageLabel:
              parsed.data.stageLabel !== undefined
                ? parsed.data.stageLabel
                : existing.stageLabel,
            scheduledAt:
              parsed.data.scheduledAt !== undefined
                ? parsed.data.scheduledAt
                  ? new Date(parsed.data.scheduledAt)
                  : null
                : existing.scheduledAt,
            sequence: parsed.data.sequence ?? existing.sequence,
            teamAId: targetTeamAId,
            teamBId: targetTeamBId,
            matchVersion: { increment: 1 },
          },
        })
        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'match.reschedule',
            actorId,
            resourceType: 'Match',
            resourceId: existing.id,
            beforeJson: JSON.stringify(existing),
            afterJson: JSON.stringify(match),
          },
        })
        return match
      })
      return reply.send(updated)
    },
  )

  // --- BRACKET SEED PREVIEW & COMMIT (SEMI-AUTOMATIC) ---
  server.get<{ Params: { categoryId: string } }>(
    '/api/v1/categories/:categoryId/bracket-seed-preview',
    { config: { auth: { roles: ['OPERATOR', 'SUPER_ADMIN'] } } },
    async (request, reply) => {
      const { categoryId } = request.params
      const category = await client.category.findUnique({
        where: { id: categoryId },
        include: { groups: { orderBy: { name: 'asc' } } },
      })
      if (!category) {
        return errorResponse(reply, 404, 'NOT_FOUND', 'Kategori tidak ditemukan.', request.id)
      }

      // Ambil seluruh match grup pada kategori ini beserta hasil FINAL-nya
      const matches = await client.match.findMany({
        where: { categoryId, stage: 'GROUP' },
        include: {
          group: true,
          teamA: true,
          teamB: true,
          results: { where: { status: 'FINAL' } },
        },
        orderBy: { sequence: 'asc' },
      })

      // Hitung klasemen per grup
      const groupWinners: Array<{
        groupId: string
        groupName: string
        teamId: string
        teamCode: string
        teamName: string
        points: number
        diff: number
      }> = []

      for (const grp of category.groups) {
        const grpMatches = matches.filter((m) => m.groupId === grp.id)
        if (grpMatches.length === 0) continue

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
            if (res.winnerTeamId === m.teamAId) {
              statA.points += 3
            } else if (res.winnerTeamId === m.teamBId) {
              statB.points += 3
            } else if (pA === pB) {
              statA.points += 1
              statB.points += 1
            }
          }
        }

        const sorted = Array.from(teamStats.values()).sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points
          return b.diff - a.diff
        })

        if (sorted.length > 0 && sorted[0].team) {
          groupWinners.push({
            groupId: grp.id,
            groupName: grp.name,
            teamId: sorted[0].team.id,
            teamCode: sorted[0].team.code,
            teamName: sorted[0].team.name,
            points: sorted[0].points,
            diff: sorted[0].diff,
          })
        }
      }

      return reply.send({
        categoryId: category.id,
        categoryCode: category.code,
        categoryLabel: category.label,
        groupWinners,
      })
    },
  )

  server.post<{
    Params: { categoryId: string }
    Body: {
      matches: Array<{
        slotId: string
        stageLabel: string
        teamAId: string
        teamBId: string
      }>
    }
  }>(
    '/api/v1/categories/:categoryId/bracket-seed-commit',
    { config: { auth: { roles: ['SUPER_ADMIN'] } } },
    async (request, reply) => {
      const { categoryId } = request.params
      const { matches: bracketMatches } = request.body || { matches: [] }

      if (!bracketMatches || !Array.isArray(bracketMatches) || bracketMatches.length === 0) {
        return errorResponse(reply, 400, 'INVALID_INPUT', 'Daftar pertandingan bracket wajib diisi.', request.id)
      }

      const category = await client.category.findUnique({ where: { id: categoryId } })
      if (!category) {
        return errorResponse(reply, 404, 'NOT_FOUND', 'Kategori tidak ditemukan.', request.id)
      }

      // Ambil nomor urut sequence terakhir di kategori ini
      const maxSeq = await client.match.aggregate({
        where: { categoryId },
        _max: { sequence: true },
      })
      let nextSequence = (maxSeq._max.sequence ?? 0) + 1

      const actorId = request.authPrincipal?.userId ?? null

      const createdMatches = await client.$transaction(async (tx) => {
        const results = []
        for (const bm of bracketMatches) {
          if (bm.teamAId === bm.teamBId) continue

          // Periksa apakah slot ini sudah pernah dibuat sebelumnya
          const existingSlot = await tx.match.findFirst({
            where: { categoryId, bracketSlot: bm.slotId },
          })

          if (existingSlot) {
            // Update jika belum mulai
            if (!existingSlot.hasStarted && existingSlot.status === 'SCHEDULED') {
              const updated = await tx.match.update({
                where: { id: existingSlot.id },
                data: {
                  teamAId: bm.teamAId,
                  teamBId: bm.teamBId,
                  stageLabel: bm.stageLabel,
                  matchVersion: { increment: 1 },
                },
              })
              results.push(updated)
            }
          } else {
            const newMatch = await tx.match.create({
              data: {
                id: randomUUID(),
                categoryId,
                stage: 'KNOCKOUT',
                stageLabel: bm.stageLabel,
                bracketSlot: bm.slotId,
                sequence: nextSequence++,
                teamAId: bm.teamAId,
                teamBId: bm.teamBId,
                status: 'SCHEDULED',
                matchVersion: 1,
                hasStarted: false,
              },
            })
            results.push(newMatch)
          }
        }

        await tx.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'match.bracket_seed',
            actorId,
            resourceType: 'Category',
            resourceId: categoryId,
            beforeJson: null,
            afterJson: JSON.stringify({ count: results.length }),
          },
        })

        return results
      })

      return reply.send({ success: true, count: createdMatches.length, matches: createdMatches })
    },
  )
}
