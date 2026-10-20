import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import Database from 'better-sqlite3'

import {
  createVerifiedBackup,
  DatabaseConnection,
  databaseBusyTimeoutMs,
  restoreFromBackup,
  type DatabaseVersions,
} from '../src/database.js'

const migrationUrl = new URL(
  '../prisma/migrations/20261018190000_initial_foundation/migration.sql',
  import.meta.url,
)

describe('SQLite foundation', () => {
  let directory: string
  let databasePath: string
  let connection: DatabaseConnection
  const expectedVersions: DatabaseVersions = {
    appVersion: '1.0.0',
    schemaVersion: '20261018190000',
  }

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'mrc-x-f04-'))
    databasePath = join(directory, 'foundation.db')
    const migration = await readFile(migrationUrl, 'utf8')
    const bootstrap = new Database(databasePath)
    bootstrap.exec(migration)
    bootstrap.close()

    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()
  })

  after(async () => {
    await connection.disconnect()
  })

  it('applies the reviewed migration to a fresh database', async () => {
    const integrity = await connection.client.$queryRawUnsafe<
      Array<{ integrity_check: string }>
    >('PRAGMA integrity_check')
    const tableCount = await connection.client.$queryRawUnsafe<
      Array<{ count: bigint }>
    >("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")

    assert.equal(integrity[0]?.integrity_check, 'ok')
    assert.equal(tableCount[0]?.count, 12n)
  })

  it('enforces connection durability settings', async () => {
    const foreignKeys = await connection.client.$queryRawUnsafe<
      Array<{ foreign_keys: bigint }>
    >('PRAGMA foreign_keys')
    const journalMode = await connection.client.$queryRawUnsafe<
      Array<{ journal_mode: string }>
    >('PRAGMA journal_mode')
    const synchronous = await connection.client.$queryRawUnsafe<
      Array<{ synchronous: bigint }>
    >('PRAGMA synchronous')
    const busyTimeout = await connection.client.$queryRawUnsafe<
      Array<{ timeout: bigint }>
    >('PRAGMA busy_timeout')

    assert.equal(foreignKeys[0]?.foreign_keys, 1n)
    assert.equal(journalMode[0]?.journal_mode, 'wal')
    assert.equal(synchronous[0]?.synchronous, 2n)
    assert.equal(busyTimeout[0]?.timeout, BigInt(databaseBusyTimeoutMs))
  })

  it('rejects foreign-key and unique violations in real SQLite', async () => {
    await connection.client.category.create({
      data: { id: 'category-a', code: 'LFJ', label: 'Line Follower Junior' },
    })
    await assert.rejects(
      connection.client.team.create({
        data: {
          id: 'orphan',
          categoryId: 'missing',
          code: 'T-01',
          name: 'Orphan',
        },
      }),
    )
    await connection.client.team.create({
      data: {
        id: 'team-a',
        categoryId: 'category-a',
        code: 'T-01',
        name: 'Team A',
      },
    })
    await assert.rejects(
      connection.client.team.create({
        data: {
          id: 'team-b',
          categoryId: 'category-a',
          code: 'T-01',
          name: 'Team B',
        },
      }),
    )
  })

  it('rejects group membership across category boundaries', async () => {
    await connection.client.category.create({
      data: { id: 'category-b', code: 'LFS', label: 'Line Follower Senior' },
    })
    await connection.client.competitionGroup.create({
      data: { id: 'group-a', categoryId: 'category-a', name: 'Group A' },
    })
    await connection.client.team.create({
      data: {
        id: 'team-category-b',
        categoryId: 'category-b',
        code: 'T-02',
        name: 'Team Category B',
      },
    })

    await assert.rejects(
      connection.client.groupMembership.create({
        data: {
          id: 'invalid-membership',
          categoryId: 'category-a',
          groupId: 'group-a',
          teamId: 'team-category-b',
        },
      }),
    )
  })

  it('keeps audit entries append-only', async () => {
    await connection.client.auditEntry.create({
      data: {
        id: 'audit-1',
        action: 'category.create',
        resourceType: 'Category',
        resourceId: 'category-a',
      },
    })

    await assert.rejects(
      connection.client.auditEntry.update({
        data: { action: 'tampered' },
        where: { id: 'audit-1' },
      }),
    )
    await assert.rejects(
      connection.client.auditEntry.delete({ where: { id: 'audit-1' } }),
    )

    const preserved = await connection.client.auditEntry.findUnique({
      where: { id: 'audit-1' },
    })
    assert.equal(preserved?.action, 'category.create')
  })

  it('persists committed data across a clean connection restart', async () => {
    await connection.client.eventConfig.create({
      data: {
        id: 'main',
        appVersion: '1.0.0',
        dataLocation: databasePath,
        eventName: 'MRC X 2026',
        schemaVersion: '20261018190000',
        timezone: 'Asia/Jakarta',
      },
    })
    await connection.disconnect()
    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()

    const config = await connection.client.eventConfig.findUnique({
      where: { id: 'main' },
    })
    assert.equal(config?.schemaVersion, '20261018190000')
  })

  it('creates and verifies a restorable copy with version pairing', async () => {
    const backupPath = join(directory, 'verified-copy.db')
    await assert.rejects(
      createVerifiedBackup(
        databasePath,
        backupPath,
        directory,
        expectedVersions,
        false,
      ),
      /maintenance window/,
    )

    await connection.disconnect()
    const result = await createVerifiedBackup(
      databasePath,
      backupPath,
      directory,
      expectedVersions,
      true,
    )
    assert.ok(result.bytes > 0)
    assert.match(result.sha256, /^[a-f0-9]{64}$/)

    const restored = new DatabaseConnection(`file:${backupPath}`)
    await restored.connect()
    const [config, teamCount, auditCount] = await Promise.all([
      restored.client.eventConfig.findUnique({ where: { id: 'main' } }),
      restored.client.team.count(),
      restored.client.auditEntry.count(),
    ])
    assert.equal(config?.appVersion, expectedVersions.appVersion)
    assert.equal(teamCount, 2)
    assert.equal(auditCount, 1)
    await restored.disconnect()

    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()
  })

  it('preserves the last known good backup when verification fails', async () => {
    const backupPath = join(directory, 'last-known-good.db')
    const priorContents = 'last-known-good'
    await writeFile(backupPath, priorContents)
    await connection.disconnect()

    await assert.rejects(
      createVerifiedBackup(
        databasePath,
        backupPath,
        directory,
        { appVersion: 'wrong', schemaVersion: 'wrong' },
        true,
      ),
      /version pairing/,
    )
    assert.equal(await readFile(backupPath, 'utf8'), priorContents)

    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()
  })

  it('rejects backup destinations outside the approved root', async () => {
    await assert.rejects(
      createVerifiedBackup(
        databasePath,
        join(directory, '..', 'outside.db'),
        directory,
        { appVersion: '1.0.0', schemaVersion: '20261018190000' },
        true,
      ),
      /approved backup root/,
    )
  })

  it('restores from a verified backup, archiving the current database and verifying contents (L-09 / TC-16)', async () => {
    const backupPath = join(directory, 'for-restore.db')
    await connection.disconnect()

    const backupInfo = await createVerifiedBackup(
      databasePath,
      backupPath,
      directory,
      expectedVersions,
      true,
    )

    // Now restore into a fresh target path
    const restoredTarget = join(directory, 'restored-target.db')
    const restoreResult = await restoreFromBackup({
      backupPath,
      targetDatabasePath: restoredTarget,
      expectedVersions,
      expectedSha256: backupInfo.sha256,
    })

    assert.equal(restoreResult.restored, true)
    assert.equal(restoreResult.restoredPath, restoredTarget)

    // Reopen restored target to prove it works
    const restoredConn = new DatabaseConnection(`file:${restoredTarget}`)
    await restoredConn.connect()
    const teamCount = await restoredConn.client.team.count()
    assert.equal(teamCount, 2)
    await restoredConn.disconnect()

    // Restore again into restoredTarget to verify pre-restore archiving
    const secondRestore = await restoreFromBackup({
      backupPath,
      targetDatabasePath: restoredTarget,
      expectedVersions,
    })
    assert.ok(secondRestore.archivedCurrentPath)

    // Reconnect original connection for after() hook
    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()
  })

  it('rejects restore if backup file is corrupted or checksum mismatches (TC-16)', async () => {
    const corruptBackupPath = join(directory, 'corrupt.db')
    await writeFile(corruptBackupPath, 'completely invalid sqlite database content')

    await assert.rejects(
      async () => {
        await restoreFromBackup({
          backupPath: corruptBackupPath,
          targetDatabasePath: join(directory, 'should-not-exist.db'),
          expectedVersions,
        })
      },
      /Corrupted backup file/,
    )
  })
})
