import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import Database from 'better-sqlite3'

import { DatabaseConnection } from '../src/database.js'

const m1Url = new URL(
  '../prisma/migrations/20261018190000_initial_foundation/migration.sql',
  import.meta.url,
)
const m2Url = new URL(
  '../prisma/migrations/20261020200000_add_match_schedule/migration.sql',
  import.meta.url,
)
const m3Url = new URL(
  '../prisma/migrations/20261021100000_add_match_lifecycle_foundation/migration.sql',
  import.meta.url,
)

describe('Match Lifecycle SQLite Foundation (L-01 / ML-01)', () => {
  let connection: DatabaseConnection
  let categoryId: string
  let teamAId: string
  let teamBId: string
  let match1Id: string
  let match2Id: string

  before(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mrc-x-lifecycle-'))
    const databasePath = join(directory, 'lifecycle.db')
    const m1 = await readFile(m1Url, 'utf8')
    const m2 = await readFile(m2Url, 'utf8')
    const m3 = await readFile(m3Url, 'utf8')

    const db = new Database(databasePath)
    db.exec(m1)
    db.exec(m2)
    db.exec(m3)
    db.close()

    connection = new DatabaseConnection(`file:${databasePath}`)
    await connection.connect()

    categoryId = randomUUID()
    await connection.client.category.create({
      data: { id: categoryId, code: 'SOCCER', label: 'Robot Soccer', enabled: true },
    })

    teamAId = randomUUID()
    await connection.client.team.create({
      data: { id: teamAId, categoryId, code: 'SOC-A', name: 'Team A' },
    })

    teamBId = randomUUID()
    await connection.client.team.create({
      data: { id: teamBId, categoryId, code: 'SOC-B', name: 'Team B' },
    })

    match1Id = randomUUID()
    await connection.client.match.create({
      data: {
        id: match1Id,
        categoryId,
        sequence: 1,
        teamAId,
        teamBId,
        status: 'SCHEDULED',
        teamASnapshotJson: JSON.stringify({ code: 'SOC-A', name: 'Team A' }),
        teamBSnapshotJson: JSON.stringify({ code: 'SOC-B', name: 'Team B' }),
      },
    })

    match2Id = randomUUID()
    await connection.client.match.create({
      data: {
        id: match2Id,
        categoryId,
        sequence: 2,
        teamAId,
        teamBId,
        status: 'SCHEDULED',
      },
    })
  })

  after(async () => {
    await connection.disconnect()
  })

  it('enforces single active match per arena in ArenaState', async () => {
    // Create arena with match1
    await connection.client.arenaState.create({
      data: {
        id: 'main',
        activeMatchId: match1Id,
        arenaVersion: 1,
      },
    })

    // Setting arena active match to match2 succeeds via update
    const updated = await connection.client.arenaState.update({
      where: { id: 'main' },
      data: { activeMatchId: match2Id, arenaVersion: 2 },
    })
    assert.equal(updated.activeMatchId, match2Id)
    assert.equal(updated.arenaVersion, 2)
  })

  it('enforces unique participant side per match (Side A and Side B)', async () => {
    await connection.client.matchParticipant.create({
      data: {
        id: randomUUID(),
        matchId: match1Id,
        side: 'A',
        teamId: teamAId,
        attendance: 'PRESENT',
        verification: 'READY',
      },
    })

    await connection.client.matchParticipant.create({
      data: {
        id: randomUUID(),
        matchId: match1Id,
        side: 'B',
        teamId: teamBId,
        attendance: 'PRESENT',
        verification: 'READY',
      },
    })

    // Attempting duplicate side A in same match must fail
    await assert.rejects(
      async () => {
        await connection.client.matchParticipant.create({
          data: {
            id: randomUUID(),
            matchId: match1Id,
            side: 'A',
            teamId: teamBId,
          },
        })
      },
      /Unique constraint failed|UNIQUE constraint failed/,
    )
  })

  it('enforces unique ordinal and attempt in SegmentAttempt', async () => {
    const attempt1 = await connection.client.segmentAttempt.create({
      data: {
        id: randomUUID(),
        matchId: match1Id,
        kind: 'ROUND',
        ordinal: 1,
        attempt: 1,
        status: 'PREPARED',
      },
    })
    assert.ok(attempt1.id)

    // Attempting same ordinal and attempt must fail
    await assert.rejects(
      async () => {
        await connection.client.segmentAttempt.create({
          data: {
            id: randomUUID(),
            matchId: match1Id,
            kind: 'ROUND',
            ordinal: 1,
            attempt: 1,
            status: 'PREPARED',
          },
        })
      },
      /Unique constraint failed|UNIQUE constraint failed/,
    )

    // Attempt 2 for same ordinal succeeds (ulangan segmen)
    const attempt2 = await connection.client.segmentAttempt.create({
      data: {
        id: randomUUID(),
        matchId: match1Id,
        kind: 'ROUND',
        ordinal: 1,
        attempt: 2,
        supersedesAttemptId: attempt1.id,
        status: 'PREPARED',
      },
    })
    assert.ok(attempt2.id)
    assert.equal(attempt2.supersedesAttemptId, attempt1.id)
  })

  it('enforces unique revision per match in ResultRevision', async () => {
    const rev1 = await connection.client.resultRevision.create({
      data: {
        id: randomUUID(),
        matchId: match1Id,
        revision: 1,
        status: 'FINAL',
        winnerTeamId: teamAId,
        finalGoalsA: 3,
        finalGoalsB: 1,
        authorityReference: 'JURI-1',
      },
    })
    assert.ok(rev1.id)

    // Duplicate revision 1 must fail
    await assert.rejects(
      async () => {
        await connection.client.resultRevision.create({
          data: {
            id: randomUUID(),
            matchId: match1Id,
            revision: 1,
            status: 'DRAFT',
          },
        })
      },
      /Unique constraint failed|UNIQUE constraint failed/,
    )
  })
})
