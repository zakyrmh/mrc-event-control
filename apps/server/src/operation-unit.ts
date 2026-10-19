import { randomUUID } from 'node:crypto'

import { Prisma, type PrismaClient } from '@prisma/client'

export type OperationStatus =
  | 'RESERVED'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'CANCELLED'

export interface OperationIdentity {
  idempotencyKey: string
  payloadHash: string
  principalId: string
  scope: string
}

export interface OperationReservation extends OperationIdentity {
  expectedRuntimeId?: string
  targetId?: string
}

export interface OperationRecord {
  id: string
  receipt: unknown | null
  status: OperationStatus
  terminalCode: string | null
}

export interface UnitOfWorkMutation<Response> {
  audit: {
    action: string
    after?: unknown
    authorityReference?: unknown
    before?: unknown
    reason?: string
    resourceId?: string
    resourceType: string
  }
  outbox: {
    aggregateId: string
    aggregateType: string
    broadcastRevision: number
    payloadPublic: unknown
    type: string
  }
  response: Response
}

export interface ExecuteOperationOptions<Response> extends OperationIdentity {
  currentRuntimeId: string
  mutate: (
    transaction: Prisma.TransactionClient,
  ) => Promise<UnitOfWorkMutation<Response>>
  faultAfterWrite?: 'business' | 'audit' | 'outbox' | 'receipt'
}

export class OperationError extends Error {
  constructor(
    readonly code: string,
    readonly status: OperationStatus,
  ) {
    super(code)
    this.name = 'OperationError'
  }
}

export class DefinitiveOperationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'DefinitiveOperationError'
  }
}

function receiptFromJson(value: string | null): unknown | null {
  return value === null ? null : JSON.parse(value)
}

function recordFromLedger(ledger: {
  id: string
  receiptJson: string | null
  status: string
  terminalCode: string | null
}): OperationRecord {
  return {
    id: ledger.id,
    receipt: receiptFromJson(ledger.receiptJson),
    status: ledger.status as OperationStatus,
    terminalCode: ledger.terminalCode,
  }
}

function uniqueKey(identity: OperationIdentity) {
  return {
    principalId_scope_idempotencyKey: {
      principalId: identity.principalId,
      scope: identity.scope,
      idempotencyKey: identity.idempotencyKey,
    },
  }
}

function assertMatchingHash(
  ledger: { payloadHash: string },
  payloadHash: string,
): void {
  if (ledger.payloadHash !== payloadHash) {
    throw new OperationError('KEY_REUSED', 'REJECTED')
  }
}

let processWriteTail: Promise<void> = Promise.resolve()

export class OperationUnitOfWork {
  constructor(private readonly client: PrismaClient) {}

  async #serializeWrite<Result>(work: () => Promise<Result>): Promise<Result> {
    const preceding = processWriteTail
    let release = (): void => undefined
    processWriteTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await preceding
    try {
      return await work()
    } finally {
      release()
    }
  }

  async reserve(input: OperationReservation): Promise<OperationRecord> {
    try {
      const ledger = await this.client.operationLedger.create({
        data: {
          id: randomUUID(),
          principalId: input.principalId,
          scope: input.scope,
          idempotencyKey: input.idempotencyKey,
          payloadHash: input.payloadHash,
          targetId: input.targetId,
          expectedRuntimeId: input.expectedRuntimeId,
          status: 'RESERVED',
        },
      })
      return recordFromLedger(ledger)
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error
      }

      const ledger = await this.client.operationLedger.findUniqueOrThrow({
        where: uniqueKey(input),
      })
      assertMatchingHash(ledger, input.payloadHash)
      return recordFromLedger(ledger)
    }
  }

  async get(identity: OperationIdentity): Promise<OperationRecord | null> {
    const ledger = await this.client.operationLedger.findUnique({
      where: uniqueKey(identity),
    })
    if (ledger === null) {
      return null
    }
    assertMatchingHash(ledger, identity.payloadHash)
    return recordFromLedger(ledger)
  }

  async cancelOrObserve(
    input: OperationReservation,
  ): Promise<OperationRecord> {
    return this.#serializeWrite(() =>
      this.client.$transaction(async (transaction) => {
      const existing = await transaction.operationLedger.findUnique({
        where: uniqueKey(input),
      })
      if (existing !== null) {
        assertMatchingHash(existing, input.payloadHash)
        if (existing.status !== 'RESERVED') {
          return recordFromLedger(existing)
        }

        const cancelled = await transaction.operationLedger.update({
          data: {
            status: 'CANCELLED',
            terminalCode: 'CANCELLED_BY_USER',
            terminalAt: new Date(),
          },
          where: { id: existing.id },
        })
        return recordFromLedger(cancelled)
      }

      const tombstone = await transaction.operationLedger.create({
        data: {
          id: randomUUID(),
          principalId: input.principalId,
          scope: input.scope,
          idempotencyKey: input.idempotencyKey,
          payloadHash: input.payloadHash,
          targetId: input.targetId,
          expectedRuntimeId: input.expectedRuntimeId,
          status: 'CANCELLED',
          terminalCode: 'CANCELLED_BEFORE_RESERVATION',
          terminalAt: new Date(),
        },
      })
      return recordFromLedger(tombstone)
      }),
    )
  }

  async execute<Response>(
    input: ExecuteOperationOptions<Response>,
  ): Promise<Response> {
    return this.#serializeWrite(() => this.#execute(input))
  }

  async #execute<Response>(
    input: ExecuteOperationOptions<Response>,
  ): Promise<Response> {
    try {
      return await this.client.$transaction(async (transaction) => {
        const ledger = await transaction.operationLedger.findUnique({
          where: uniqueKey(input),
        })
        if (ledger === null) {
          throw new OperationError('RESERVATION_REQUIRED', 'REJECTED')
        }
        assertMatchingHash(ledger, input.payloadHash)

        if (ledger.status === 'SUCCEEDED') {
          return receiptFromJson(ledger.receiptJson) as Response
        }
        if (ledger.status !== 'RESERVED') {
          throw new OperationError(
            ledger.terminalCode ?? ledger.status,
            ledger.status as OperationStatus,
          )
        }
        if (
          ledger.expectedRuntimeId !== null &&
          ledger.expectedRuntimeId !== input.currentRuntimeId
        ) {
          throw new DefinitiveOperationError('RUNTIME_CHANGED')
        }

        const mutation = await input.mutate(transaction)
        if (input.faultAfterWrite === 'business') {
          throw new Error('INJECTED_BUSINESS_WRITE_FAULT')
        }

        await transaction.auditEntry.create({
          data: {
            id: randomUUID(),
            commandId: ledger.id,
            actorId: input.principalId,
            action: mutation.audit.action,
            resourceType: mutation.audit.resourceType,
            resourceId: mutation.audit.resourceId,
            beforeJson:
              mutation.audit.before === undefined
                ? undefined
                : JSON.stringify(mutation.audit.before),
            afterJson:
              mutation.audit.after === undefined
                ? undefined
                : JSON.stringify(mutation.audit.after),
            reason: mutation.audit.reason,
            authorityReference:
              mutation.audit.authorityReference === undefined
                ? undefined
                : JSON.stringify(mutation.audit.authorityReference),
          },
        })
        if (input.faultAfterWrite === 'audit') {
          throw new Error('INJECTED_AUDIT_WRITE_FAULT')
        }

        await transaction.outboxEvent.create({
          data: {
            eventId: randomUUID(),
            broadcastRevision: mutation.outbox.broadcastRevision,
            aggregateType: mutation.outbox.aggregateType,
            aggregateId: mutation.outbox.aggregateId,
            type: mutation.outbox.type,
            payloadPublicJson: JSON.stringify(mutation.outbox.payloadPublic),
          },
        })
        if (input.faultAfterWrite === 'outbox') {
          throw new Error('INJECTED_OUTBOX_WRITE_FAULT')
        }

        const responseJson = JSON.stringify(mutation.response)
        await transaction.commandReceipt.create({
          data: {
            id: randomUUID(),
            ledgerId: ledger.id,
            responseJson,
          },
        })
        if (input.faultAfterWrite === 'receipt') {
          throw new Error('INJECTED_RECEIPT_WRITE_FAULT')
        }

        await transaction.operationLedger.update({
          data: {
            status: 'SUCCEEDED',
            terminalCode: 'SUCCEEDED',
            terminalAt: new Date(),
            receiptJson: responseJson,
          },
          where: { id: ledger.id },
        })
        return mutation.response
      })
    } catch (error) {
      if (!(error instanceof DefinitiveOperationError)) {
        throw error
      }

      await this.client.operationLedger.updateMany({
        data: {
          status: 'REJECTED',
          terminalCode: error.code,
          terminalAt: new Date(),
        },
        where: {
          ...uniqueKey(input).principalId_scope_idempotencyKey,
          payloadHash: input.payloadHash,
          status: 'RESERVED',
        },
      })
      throw new OperationError(error.code, 'REJECTED')
    }
  }
}
