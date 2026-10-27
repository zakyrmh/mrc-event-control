import { randomUUID } from 'node:crypto'
import { DatabaseConnection } from './database.js'
import { hashPassword } from './auth.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const username = args[0]
  const password = args[1]
  const role = (args[2]?.toUpperCase() || 'OPERATOR') as 'OPERATOR' | 'SUPER_ADMIN'

  if (!username || !password) {
    process.stderr.write('Usage: pnpm --filter server create:user <username> <password> [OPERATOR|SUPER_ADMIN]\n')
    process.stderr.write('Catatan: Password minimal 12 karakter.\n')
    process.exit(1)
  }

  if (role !== 'OPERATOR' && role !== 'SUPER_ADMIN') {
    process.stderr.write('Role harus OPERATOR atau SUPER_ADMIN.\n')
    process.exit(1)
  }

  const databaseUrl = process.env.DATABASE_URL || 'file:./data/development.db'
  const connection = new DatabaseConnection(databaseUrl)
  await connection.connect()

  try {
    const existing = await connection.client.user.findUnique({ where: { username } })
    const hashedPassword = await hashPassword(password)

    if (existing) {
      await connection.client.user.update({
        where: { id: existing.id },
        data: { passwordHash: hashedPassword, role, enabled: true },
      })
      process.stdout.write(`✓ User '${username}' berhasil diperbarui (Role: ${role}).\n`)
    } else {
      const id = randomUUID()
      await connection.client.$transaction([
        connection.client.user.create({
          data: { id, username, passwordHash: hashedPassword, role },
        }),
        connection.client.auditEntry.create({
          data: {
            id: randomUUID(),
            action: 'user.create',
            resourceType: 'User',
            resourceId: id,
            afterJson: JSON.stringify({ username, role, enabled: true }),
          },
        }),
      ])
      process.stdout.write(`✓ User '${username}' berhasil dibuat (Role: ${role}, ID: ${id}).\n`)
    }
  } finally {
    await connection.disconnect()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Gagal membuat user: ${error instanceof Error ? error.message : 'Unknown error'}\n`)
  process.exit(1)
})
