import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'

export const databaseBusyTimeoutMs = 5_000

export interface DatabaseVersions {
  appVersion: string
  schemaVersion: string
}

export interface VerifiedBackup {
  appVersion: string
  bytes: number
  destinationPath: string
  schemaVersion: string
  sha256: string
}

function resolveDatabasePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('DATABASE_URL must use the file: SQLite protocol')
  }

  const path = databaseUrl.slice('file:'.length)
  if (path === '' || path === ':memory:') {
    throw new Error('A persistent SQLite file is required')
  }

  return isAbsolute(path) ? path : resolve(path)
}

export class DatabaseConnection {
  readonly client: PrismaClient
  readonly path: string
  #connected = false

  constructor(databaseUrl: string) {
    this.path = resolveDatabasePath(databaseUrl)
    const adapter = new PrismaBetterSqlite3({
      timeout: databaseBusyTimeoutMs,
      url: databaseUrl,
    })
    this.client = new PrismaClient({ adapter })
  }

  async connect(): Promise<void> {
    if (this.#connected) {
      return
    }

    await this.client.$connect()
    await this.client.$queryRawUnsafe('PRAGMA foreign_keys = ON')
    await this.client.$queryRawUnsafe('PRAGMA journal_mode = WAL')
    await this.client.$queryRawUnsafe('PRAGMA synchronous = FULL')
    await this.client.$queryRawUnsafe(
      `PRAGMA busy_timeout = ${databaseBusyTimeoutMs}`,
    )

    const settings = await this.client.$queryRawUnsafe<
      Array<{ foreign_keys: bigint }>
    >('PRAGMA foreign_keys')
    if (settings[0]?.foreign_keys !== 1n) {
      await this.client.$disconnect()
      throw new Error('SQLite foreign key enforcement could not be enabled')
    }

    this.#connected = true
  }

  async disconnect(): Promise<void> {
    if (!this.#connected) {
      return
    }

    await this.client.$disconnect()
    this.#connected = false
  }
}

export async function createVerifiedBackup(
  sourcePath: string,
  destinationPath: string,
  approvedBackupRoot: string,
  expectedVersions: DatabaseVersions,
  writersStopped: boolean,
): Promise<VerifiedBackup> {
  if (!writersStopped) {
    throw new Error('Backup requires a maintenance window with writers stopped')
  }
  const [canonicalSource, canonicalBackupRoot, canonicalDestinationDirectory] =
    await Promise.all([
      realpath(sourcePath),
      realpath(approvedBackupRoot),
      realpath(dirname(destinationPath)),
    ])
  const destinationRelativeToRoot = relative(
    canonicalBackupRoot,
    canonicalDestinationDirectory,
  )
  if (
    destinationRelativeToRoot === '..' ||
    destinationRelativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(destinationRelativeToRoot)
  ) {
    throw new Error('Backup destination must be inside the approved backup root')
  }

  const canonicalDestination = resolve(
    canonicalDestinationDirectory,
    basename(destinationPath),
  )
  if (canonicalSource === canonicalDestination) {
    throw new Error('Backup destination must differ from the source database')
  }

  const temporaryDirectory = await mkdtemp(
    resolve(canonicalDestinationDirectory, '.mrc-x-backup-'),
  )
  const temporaryPath = resolve(temporaryDirectory, 'candidate.db')
  try {
    const source = new Database(sourcePath, {
      readonly: true,
      fileMustExist: true,
    })
    try {
      await source.backup(temporaryPath)
    } finally {
      source.close()
    }

    const copy = new Database(temporaryPath, {
      readonly: true,
      fileMustExist: true,
    })
    try {
      const integrity = copy.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') {
        throw new Error(`Backup integrity check failed: ${String(integrity)}`)
      }

      const version = copy
        .prepare(
          'SELECT "appVersion", "schemaVersion" FROM "EventConfig" LIMIT 1',
        )
        .get() as DatabaseVersions | undefined
      if (
        version?.appVersion !== expectedVersions.appVersion ||
        version.schemaVersion !== expectedVersions.schemaVersion
      ) {
        throw new Error(
          'Backup application/schema version pairing does not match',
        )
      }
    } finally {
      copy.close()
    }

    const temporaryFile = await open(temporaryPath, 'r')
    try {
      await temporaryFile.sync()
    } finally {
      await temporaryFile.close()
    }
    await rename(temporaryPath, canonicalDestination)
    const destinationDirectory = await open(canonicalDestinationDirectory, 'r')
    try {
      await destinationDirectory.sync()
    } finally {
      await destinationDirectory.close()
    }

    const [contents, metadata] = await Promise.all([
      readFile(canonicalDestination),
      stat(canonicalDestination),
    ])
    return {
      ...expectedVersions,
      bytes: metadata.size,
      destinationPath: canonicalDestination,
      sha256: createHash('sha256').update(contents).digest('hex'),
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

export interface RestoreBackupOptions {
  backupPath: string
  targetDatabasePath: string
  archiveDirectory?: string
  expectedVersions: DatabaseVersions
  expectedSha256?: string
}

export async function restoreFromBackup(options: RestoreBackupOptions): Promise<{
  restored: boolean
  archivedCurrentPath?: string
  restoredPath: string
}> {
  const backupStat = await stat(options.backupPath)
  if (!backupStat.isFile()) {
    throw new Error('Backup file not found')
  }

  const backupBuffer = await readFile(options.backupPath)
  if (options.expectedSha256) {
    const actualSha = createHash('sha256').update(backupBuffer).digest('hex')
    if (actualSha !== options.expectedSha256) {
      throw new Error('Backup checksum mismatch')
    }
  }

  let candidateDb: Database.Database
  try {
    candidateDb = new Database(options.backupPath, { readonly: true, fileMustExist: true })
  } catch (err) {
    throw new Error(`Corrupted backup file: failed to open SQLite database: ${String(err)}`)
  }

  try {
    try {
      const integrity = candidateDb.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') {
        throw new Error(`Corrupted backup file: integrity_check returned ${integrity}`)
      }
      const version = candidateDb
        .prepare('SELECT "appVersion", "schemaVersion" FROM "EventConfig" LIMIT 1')
        .get() as DatabaseVersions | undefined
      if (
        version?.appVersion !== options.expectedVersions.appVersion ||
        version.schemaVersion !== options.expectedVersions.schemaVersion
      ) {
        throw new Error('Backup application/schema version pairing does not match')
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Corrupted backup file')) {
        throw err
      }
      throw new Error(`Corrupted backup file: SQLite inspection failed: ${String(err)}`)
    }
  } finally {
    candidateDb.close()
  }

  let archivedCurrentPath: string | undefined
  try {
    const currentStat = await stat(options.targetDatabasePath)
    if (currentStat.isFile()) {
      const archDir = options.archiveDirectory ?? dirname(options.targetDatabasePath)
      archivedCurrentPath = resolve(archDir, `archive-pre-restore-${Date.now()}.db`)
      await copyFile(options.targetDatabasePath, archivedCurrentPath)
    }
  } catch {
    // target file might not exist yet
  }

  await copyFile(options.backupPath, options.targetDatabasePath)

  return {
    restored: true,
    archivedCurrentPath,
    restoredPath: options.targetDatabasePath,
  }
}
