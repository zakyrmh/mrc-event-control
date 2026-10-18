import { z } from 'zod'

import { errorCodeSchema } from './enums.js'
import { nonBlankStringSchema, revisionSchema } from './primitives.js'

export const fieldErrorSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.int().nonnegative()])),
  message: nonBlankStringSchema,
})
export type FieldError = z.infer<typeof fieldErrorSchema>

export const apiErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: nonBlankStringSchema,
  requestId: nonBlankStringSchema,
  retryable: z.boolean(),
  fieldErrors: z.array(fieldErrorSchema).optional(),
  currentMatchVersion: revisionSchema.optional(),
  currentArenaVersion: revisionSchema.optional(),
  currentRevision: revisionSchema.optional(),
})
export type ApiError = z.infer<typeof apiErrorSchema>

export const apiErrorEnvelopeSchema = z.strictObject({
  error: apiErrorSchema,
})
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>
