import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import type { Prisma } from '@prisma/client'
import Database from 'better-sqlite3'

import { DatabaseConnection } from '../src/database.js'
import {
  DefinitiveOperationError,
  OperationError,
  OperationUnitOfWork,
  type ExecuteOperationOptions,
} from '../src/operation-unit.js'

const migrationUrl = new URL(
  '../prisma/migrations/20261018190000_initial_foundation/migration.sql',
  import.meta.url,
)

interface Fixture {
  close: () => Promise<void>
  connection: DatabaseConnection
  unit: OperationUnitOfWork
}

async function fixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'mrc-x-f05-'))
  const databasePath = join(directory, 'operation.db')
  const migration = await readFile(migrationUrl, 'utf8')
  const bootstrap = new Database(databasePath)
  bootstrap.exec(migration)
  bootstrap.close()

  const connection = new DatabaseConnection(`file:${databasePath}`)
  await connection.connect()
  await connection.client.user.create({
    data: {
      id: 'operator-1',
      username: 'operator',
      passwordHash: 'not-a-real-password-hash',
      role: 'OPERATOR',
    },
  })
  await connection.client.category.create({
    data: { id: 'category-1', code: 'SOC', label: 'Before' },
  })

  return {
    connection,
    unit: new OperationUnitOfWork(connection.client),
    close: () => connection.disconnect(),
  }
}

function identity(key: string, payloadHash = `hash-${key}`) {
  return {
    idempotencyKey: key,
    payloadHash,
    principalId: 'operator-1',
    scope: 'fixture.category.rename',
  }
}

function mutation(
  expectedRevision: number,
  label: string,
  broadcastRevision = expectedRevision + 1,
): ExecuteOperationOptions<{ label: string; revision: number }>['mutate'] {
  return async (transaction: Prisma.TransactionClient) => {
    const updated = await transaction.category.updateMany({
      data: { label, revision: { increment: 1 } },
      where: { id: 'category-1', revision: expectedRevision },
    })
    if (updated.count !== 1) {
      throw new DefinitiveOperationError('VERSION_CONFLICT')
    }
    const after = await transaction.category.findUniqueOrThrow({
      where: { id: 'category-1' },
    })
    return {
      audit: {
        action: 'category.rename',
        before: { label: 'Before', revision: expectedRevision },
        after: { label: after.label, revision: after.revision },
        resourceId: after.id,
        resourceType: 'Category',
      },
      outbox: {
        aggregateId: after.id,
        aggregateType: 'Category',
        broadcastRevision,
        payloadPublic: { label: after.label, revision: after.revision },
        type: 'category.updated',
      },
      response: { label: after.label, revision: after.revision },
    }
  }
}

describe('atomic operation unit of work', () => {
  it('requires a reservation and rejects payload reuse', async () => {
    const context = await fixture()
    try {
      await assert.rejects(
        context.unit.execute({
          ...identity('missing'),
          currentRuntimeId: 'runtime-1',
          mutate: mutation(1, 'Never'),
        }),
        (error: unknown) =>
          error instanceof OperationError &&
          error.code === 'RESERVATION_REQUIRED',
      )

      await context.unit.reserve(identity('reserved'))
      const duplicate = await context.unit.reserve(identity('reserved'))
      assert.equal(duplicate.status, 'RESERVED')
      await assert.rejects(
        context.unit.reserve(identity('reserved', 'different-hash')),
        (error: unknown) =>
          error instanceof OperationError && error.code === 'KEY_REUSED',
      )
    } finally {
      await context.close()
    }
  })

  it('commits state, audit, receipt, outbox, and terminal ledger atomically', async () => {
    const context = await fixture()
    try {
      const operation = identity('atomic-success')
      await context.unit.reserve({
        ...operation,
        expectedRuntimeId: 'runtime-1',
        targetId: 'category-1',
      })
      const response = await context.unit.execute({
        ...operation,
        currentRuntimeId: 'runtime-1',
        mutate: mutation(1, 'After'),
      })

      assert.deepEqual(response, { label: 'After', revision: 2 })
      const [category, audit, receipt, outbox, ledger] = await Promise.all([
        context.connection.client.category.findUniqueOrThrow({
          where: { id: 'category-1' },
        }),
        context.connection.client.auditEntry.findMany(),
        context.connection.client.commandReceipt.findMany(),
        context.connection.client.outboxEvent.findMany(),
        context.unit.get(operation),
      ])
      assert.equal(category.revision, 2)
      assert.equal(audit.length, 1)
      assert.equal(receipt.length, 1)
      assert.equal(outbox.length, 1)
      assert.equal(ledger?.status, 'SUCCEEDED')
      assert.deepEqual(ledger?.receipt, response)
    } finally {
      await context.close()
    }
  })

  it('returns the original receipt for 100 retries without duplicate effects', async () => {
    const context = await fixture()
    try {
      const operation = identity('retry-after-commit')
      await context.unit.reserve(operation)
      const options = {
        ...operation,
        currentRuntimeId: 'runtime-1',
        mutate: mutation(1, 'Once'),
      }
      const first = await context.unit.execute(options)
      const retries = await Promise.all(
        Array.from({ length: 100 }, () => context.unit.execute(options)),
      )
      assert.ok(retries.every((receipt) => receipt.revision === first.revision))
      assert.equal(await context.connection.client.auditEntry.count(), 1)
      assert.equal(await context.connection.client.commandReceipt.count(), 1)
      assert.equal(await context.connection.client.outboxEvent.count(), 1)
    } finally {
      await context.close()
    }
  })

  it('observes a committed receipt after a database connection restart', async () => {
    const context = await fixture()
    let restarted: DatabaseConnection | undefined
    try {
      const operation = identity('restart-receipt')
      await context.unit.reserve(operation)
      const options = {
        ...operation,
        currentRuntimeId: 'runtime-1',
        mutate: mutation(1, 'Durable'),
      }
      const committed = await context.unit.execute(options)
      const databasePath = context.connection.path
      await context.connection.disconnect()

      restarted = new DatabaseConnection(`file:${databasePath}`)
      await restarted.connect()
      const recoveredUnit = new OperationUnitOfWork(restarted.client)
      const recovered = await recoveredUnit.execute(options)
      assert.deepEqual(recovered, committed)
      assert.equal(await restarted.client.category.count(), 1)
      assert.equal(await restarted.client.auditEntry.count(), 1)
      assert.equal(await restarted.client.commandReceipt.count(), 1)
      assert.equal(await restarted.client.outboxEvent.count(), 1)
    } finally {
      await restarted?.disconnect()
      await context.close()
    }
  })

  it('rolls back every write and leaves RESERVED on injected write faults', async () => {
    for (const fault of ['business', 'audit', 'outbox', 'receipt'] as const) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const context = await fixture()
        try {
          const operation = identity(`${fault}-${attempt}`)
          await context.unit.reserve(operation)
          await assert.rejects(
            context.unit.execute({
              ...operation,
              currentRuntimeId: 'runtime-1',
              faultAfterWrite: fault,
              mutate: mutation(1, 'Must Roll Back'),
            }),
            new RegExp(`INJECTED_${fault.toUpperCase()}_WRITE_FAULT`),
          )

          const [category, auditCount, receiptCount, outboxCount, ledger] =
            await Promise.all([
              context.connection.client.category.findUniqueOrThrow({
                where: { id: 'category-1' },
              }),
              context.connection.client.auditEntry.count(),
              context.connection.client.commandReceipt.count(),
              context.connection.client.outboxEvent.count(),
              context.unit.get(operation),
            ])
          assert.equal(category.revision, 1)
          assert.equal(auditCount, 0)
          assert.equal(receiptCount, 0)
          assert.equal(outboxCount, 0)
          assert.equal(ledger?.status, 'RESERVED')
        } finally {
          await context.close()
        }
      }
    }
  })

  it('persists cancellation tombstones and rejects delayed execution', async () => {
    const context = await fixture()
    try {
      const operation = identity('cancel-before-reserve')
      const cancelled = await context.unit.cancelOrObserve(operation)
      assert.equal(cancelled.status, 'CANCELLED')
      const delayedReservation = await context.unit.reserve(operation)
      assert.equal(delayedReservation.status, 'CANCELLED')
      await assert.rejects(
        context.unit.execute({
          ...operation,
          currentRuntimeId: 'runtime-1',
          mutate: mutation(1, 'Never'),
        }),
        (error: unknown) =>
          error instanceof OperationError && error.status === 'CANCELLED',
      )
      assert.equal(
        (
          await context.connection.client.category.findUniqueOrThrow({
            where: { id: 'category-1' },
          })
        ).revision,
        1,
      )
    } finally {
      await context.close()
    }
  })

  it('cancels RESERVED but observes SUCCEEDED without overwriting it', async () => {
    const context = await fixture()
    try {
      const reserved = identity('cancel-reserved')
      await context.unit.reserve(reserved)
      const cancelled = await context.unit.cancelOrObserve(reserved)
      assert.equal(cancelled.status, 'CANCELLED')

      const succeeded = identity('observe-succeeded')
      await context.unit.reserve(succeeded)
      const receipt = await context.unit.execute({
        ...succeeded,
        currentRuntimeId: 'runtime-1',
        mutate: mutation(1, 'Committed'),
      })
      const observed = await context.unit.cancelOrObserve(succeeded)
      assert.equal(observed.status, 'SUCCEEDED')
      assert.deepEqual(observed.receipt, receipt)
      assert.equal(await context.connection.client.commandReceipt.count(), 1)
    } finally {
      await context.close()
    }
  })

  it('rejects a reservation from an old runtime without business effects', async () => {
    const context = await fixture()
    try {
      const operation = identity('old-runtime')
      await context.unit.reserve({
        ...operation,
        expectedRuntimeId: 'runtime-before-restart',
      })
      await assert.rejects(
        context.unit.execute({
          ...operation,
          currentRuntimeId: 'runtime-after-restart',
          mutate: mutation(1, 'Never'),
        }),
        (error: unknown) =>
          error instanceof OperationError && error.code === 'RUNTIME_CHANGED',
      )
      const ledger = await context.unit.get(operation)
      assert.equal(ledger?.status, 'REJECTED')
      assert.equal(ledger?.terminalCode, 'RUNTIME_CHANGED')
      assert.equal(await context.connection.client.auditEntry.count(), 0)
    } finally {
      await context.close()
    }
  })

  it('allows exactly one of 20 distinct keys to win the same version', async () => {
    const context = await fixture()
    try {
      const operations = Array.from({ length: 20 }, (_, index) =>
        identity(`parallel-${index}`),
      )
      await Promise.all(
        operations.map((operation) => context.unit.reserve(operation)),
      )
      const results = await Promise.allSettled(
        operations.map((operation, index) =>
          context.unit.execute({
            ...operation,
            currentRuntimeId: 'runtime-1',
            mutate: mutation(1, `Winner ${index}`),
          }),
        ),
      )
      const succeeded = results.filter((result) => result.status === 'fulfilled')
      const rejected = results.filter((result) => result.status === 'rejected')
      assert.equal(succeeded.length, 1)
      assert.equal(rejected.length, 19)
      assert.ok(
        rejected.every(
          (result) =>
            result.reason instanceof OperationError &&
            result.reason.code === 'VERSION_CONFLICT',
        ),
      )
      assert.equal(await context.connection.client.auditEntry.count(), 1)
      assert.equal(await context.connection.client.commandReceipt.count(), 1)
      assert.equal(await context.connection.client.outboxEvent.count(), 1)
      assert.equal(
        await context.connection.client.operationLedger.count({
          where: { status: 'REJECTED', terminalCode: 'VERSION_CONFLICT' },
        }),
        19,
      )
    } finally {
      await context.close()
    }
  })
})
