import { DatabaseConnection } from './database.js'
import { bootstrapAdmin } from './auth.js'

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL
  const username = process.env.MRC_BOOTSTRAP_ADMIN_USERNAME
  const password = process.env.MRC_BOOTSTRAP_ADMIN_PASSWORD
  if (databaseUrl === undefined || username === undefined || password === undefined) {
    throw new Error('DATABASE_URL, MRC_BOOTSTRAP_ADMIN_USERNAME, and MRC_BOOTSTRAP_ADMIN_PASSWORD are required')
  }
  const connection = new DatabaseConnection(databaseUrl)
  await connection.connect()
  try {
    const result = await bootstrapAdmin(connection.client, username, password)
    process.stdout.write(result.created ? 'Super-admin created.\n' : 'Super-admin already exists; no changes made.\n')
  } finally {
    await connection.disconnect()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Admin bootstrap failed: ${error instanceof Error ? error.message : 'Unknown error'}\n`)
  process.exitCode = 1
})
