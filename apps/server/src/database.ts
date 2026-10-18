import { createHash } from 'node:crypto'
import {
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
