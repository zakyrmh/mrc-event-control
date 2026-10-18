import { z } from 'zod'

export const idSchema = z.uuid()
export const utcDateTimeSchema = z.iso.datetime({ offset: true })
export const nonBlankStringSchema = z.string().trim().min(1)
export const revisionSchema = z.int().nonnegative()

export const paginationQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export function nullableOptionalString(maxLength: number) {
  return z.string().trim().max(maxLength).nullable().optional()
}
