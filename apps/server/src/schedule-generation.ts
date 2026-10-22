import { createHash } from 'node:crypto'

/**
 * Pure round-robin planning helpers for generated group-stage schedules.
 *
 * Nothing here reads or writes the database. Everything is deterministic so a
 * preview and the subsequent commit compute identical results, and so a second
 * generate run produces the same tie identities instead of duplicates.
 */

export interface RoundRobinPairing {
  /** 1-based putaran (wave) index. */
  roundIndex: number
  homeId: string
  awayId: string
}

export interface GeneratedMatchPlan {
  tieId: string
  groupId: string
  roundIndex: number
  /** 1-based ronde (game/leg) inside the tie. */
  rondeNumber: number
  teamAId: string
  teamBId: string
}

export interface GroupPlanInput {
  categoryId: string
  stage: string
  groupId: string
  /** Team ids, expected in ascending code order so side assignment is stable. */
  teamIds: readonly string[]
  rondeCount: number
}

/**
 * Circle method (Berger tables).
 *
 * Odd team counts receive a null bye slot, so every round has exactly one team
 * resting. Every pair meets exactly once: C(n, 2) pairings in total.
 */
export function generateRoundRobin(
  teamIds: readonly string[],
): RoundRobinPairing[] {
  const unique = [...new Set(teamIds)]
  if (unique.length < 2) {
    return []
  }

  const slots: Array<string | null> =
    unique.length % 2 === 1 ? [...unique, null] : [...unique]
  const slotCount = slots.length
  const roundCount = slotCount - 1
  const half = slotCount / 2
  const fixed = slots[0] as string
  let rotation = slots.slice(1)

  const pairings: RoundRobinPairing[] = []

  for (let round = 0; round < roundCount; round++) {
    const line: Array<string | null> = [fixed, ...rotation]

    for (let i = 0; i < half; i++) {
      const first = line[i] ?? null
      const second = line[slotCount - 1 - i] ?? null
      if (first === null || second === null) {
        continue
      }

      // Pairing order is left to the caller; side assignment is decided when
      // ronde are expanded so Tim A can follow a stable rule (ascending code).
      pairings.push({
        roundIndex: round + 1,
        homeId: first,
        awayId: second,
      })
    }

    rotation = [
      rotation[rotation.length - 1] as string | null,
      ...rotation.slice(0, -1),
    ]
  }

  return pairings
}

/**
 * Deterministic tie identity for one pairing inside one group.
 *
 * The identity is scoped to the unordered pair, not the whole group, so a group
 * that gains a team later keeps its existing ties intact and only the new
 * pairings receive fresh identities. Combined with the database unique index on
 * (tieId, rondeNumber), a repeated generate becomes a no-op instead of a
 * duplicate schedule.
 */
export function buildTieId(params: {
  categoryId: string
  stage: string
  groupId: string
  pairIds: readonly [string, string] | readonly string[]
}): string {
  const sortedPair = [...params.pairIds].sort()
  const material = [
    params.categoryId,
    params.stage,
    params.groupId,
    ...sortedPair,
  ].join('|')

  return createHash('sha256').update(material).digest('hex').slice(0, 32)
}

/**
 * Expand each pairing into `rondeCount` matches.
 *
 * Tim A follows ascending team code on odd ronde (the stable, auditable rule),
 * and sides swap on even ronde so both teams take a turn as Tim A.
 */
export function planGroupTies(input: GroupPlanInput): GeneratedMatchPlan[] {
  if (!Number.isInteger(input.rondeCount) || input.rondeCount < 1) {
    return []
  }

  // `teamIds` arrives in ascending team-code order (see loadGroupsWithTeams),
  // so array position encodes the deterministic side rule: lower code is Tim A
  // on odd ronde, and sides swap on even ronde.
  const codeOrder = new Map(input.teamIds.map((id, index) => [id, index]))
  const plans: GeneratedMatchPlan[] = []

  for (const pairing of generateRoundRobin(input.teamIds)) {
    const tieId = buildTieId({
      categoryId: input.categoryId,
      stage: input.stage,
      groupId: input.groupId,
      pairIds: [pairing.homeId, pairing.awayId],
    })

    const firstIsLower =
      (codeOrder.get(pairing.homeId) ?? 0) < (codeOrder.get(pairing.awayId) ?? 0)
    const baseTeamAId = firstIsLower ? pairing.homeId : pairing.awayId
    const baseTeamBId = firstIsLower ? pairing.awayId : pairing.homeId

    for (let ronde = 1; ronde <= input.rondeCount; ronde++) {
      const swap = ronde % 2 === 0
      plans.push({
        tieId,
        groupId: input.groupId,
        roundIndex: pairing.roundIndex,
        rondeNumber: ronde,
        teamAId: swap ? baseTeamBId : baseTeamAId,
        teamBId: swap ? baseTeamAId : baseTeamBId,
      })
    }
  }

  return plans
}

/** Total matches a full group-stage generate would create for one group. */
export function countGroupMatches(
  teamCount: number,
  rondeCount: number,
): number {
  if (teamCount < 2 || rondeCount < 1) {
    return 0
  }
  return (teamCount * (teamCount - 1) * rondeCount) / 2
}
