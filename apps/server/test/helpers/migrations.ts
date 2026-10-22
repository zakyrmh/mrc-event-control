import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const migrationsDir = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url),
)

/**
 * Returns every migration directory name in apply order.
 *
 * Prisma names migrations with a sortable UTC timestamp prefix, so lexical
 * sorting is the same order `prisma migrate deploy` uses.
 */
export async function listMigrations(): Promise<string[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/** Applies every migration to an open better-sqlite3 handle, in order. */
export async function applyMigrations(db: Database.Database): Promise<void> {
  for (const name of await listMigrations()) {
    const sql = await readFile(`${migrationsDir}${name}/migration.sql`, 'utf8')
    db.exec(sql)
  }
}

/**
 * Creates a migrated SQLite database file at `databasePath`.
 *
 * Tests used to hand-list migration files, which meant every new migration
 * broke them. Applying the directory keeps a single source of truth.
 */
export async function createMigratedDatabase(
  databasePath: string,
): Promise<void> {
  const db = new Database(databasePath)
  try {
    await applyMigrations(db)
  } finally {
    db.close()
  }
}
