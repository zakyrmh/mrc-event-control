import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildTieId,
  countGroupMatches,
  generateRoundRobin,
  planGroupTies,
} from '../src/schedule-generation.js'

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

describe('Round robin planner (S-02)', () => {
  describe('generateRoundRobin', () => {
    for (const n of [2, 3, 4, 5, 7]) {
      it(`covers every pair exactly once for ${n} teams`, () => {
        const teams = Array.from({ length: n }, (_, i) => `team-${i + 1}`)
        const pairings = generateRoundRobin(teams)

        assert.equal(pairings.length, (n * (n - 1)) / 2)

        const seen = new Set<string>()
        for (const pairing of pairings) {
          assert.notEqual(pairing.homeId, pairing.awayId)
          const key = pairKey(pairing.homeId, pairing.awayId)
          assert.equal(seen.has(key), false, `duplicate pair ${key}`)
          seen.add(key)
        }
        assert.equal(seen.size, (n * (n - 1)) / 2)
      })
    }

    it('produces n-1 rounds for even counts and n rounds for odd counts', () => {
      const even = generateRoundRobin(['a', 'b', 'c', 'd'])
      assert.equal(Math.max(...even.map((p) => p.roundIndex)), 3)

      const odd = generateRoundRobin(['a', 'b', 'c'])
      assert.equal(Math.max(...odd.map((p) => p.roundIndex)), 3)
    })

    it('gives each team exactly one match per round when the count is even', () => {
      const teams = ['a', 'b', 'c', 'd', 'e', 'f']
      const pairings = generateRoundRobin(teams)
      const perRound = new Map<number, string[]>()

      for (const pairing of pairings) {
        const list = perRound.get(pairing.roundIndex) ?? []
        list.push(pairing.homeId, pairing.awayId)
        perRound.set(pairing.roundIndex, list)
      }

      for (const [, list] of perRound) {
        assert.equal(list.length, teams.length)
        assert.equal(new Set(list).size, teams.length)
      }
    })

    it('returns nothing for fewer than two teams', () => {
      assert.deepEqual(generateRoundRobin([]), [])
      assert.deepEqual(generateRoundRobin(['solo']), [])
    })

    it('ignores duplicate team ids', () => {
      const pairings = generateRoundRobin(['a', 'a', 'b'])
      assert.equal(pairings.length, 1)
    })

    it('is deterministic across calls', () => {
      const teams = ['a', 'b', 'c', 'd', 'e']
      assert.deepEqual(generateRoundRobin(teams), generateRoundRobin(teams))
    })
  })

  describe('buildTieId', () => {
    it('is stable for the same inputs', () => {
      const params = {
        categoryId: 'cat-1',
        stage: 'GROUP',
        groupId: 'grp-1',
        pairIds: ['t1', 't2'],
      }
      assert.equal(buildTieId(params), buildTieId(params))
    })

    it('does not depend on pair ordering', () => {
      const base = { categoryId: 'c', stage: 'GROUP', groupId: 'g' }
      assert.equal(
        buildTieId({ ...base, pairIds: ['t1', 't2'] }),
        buildTieId({ ...base, pairIds: ['t2', 't1'] }),
      )
    })

    it('gives different ids to different pairs in the same group', () => {
      const base = { categoryId: 'c', stage: 'GROUP', groupId: 'g' }
      const ids = new Set([
        buildTieId({ ...base, pairIds: ['t1', 't2'] }),
        buildTieId({ ...base, pairIds: ['t1', 't3'] }),
        buildTieId({ ...base, pairIds: ['t2', 't3'] }),
      ])
      assert.equal(ids.size, 3)
    })

    it('differs across groups and categories', () => {
      const pairIds = ['t1', 't2']
      assert.notEqual(
        buildTieId({ categoryId: 'c', stage: 'GROUP', groupId: 'g1', pairIds }),
        buildTieId({ categoryId: 'c', stage: 'GROUP', groupId: 'g2', pairIds }),
      )
      assert.notEqual(
        buildTieId({ categoryId: 'c1', stage: 'GROUP', groupId: 'g', pairIds }),
        buildTieId({ categoryId: 'c2', stage: 'GROUP', groupId: 'g', pairIds }),
      )
    })

    it('produces a 32 character identifier', () => {
      const id = buildTieId({
        categoryId: 'c',
        stage: 'GROUP',
        groupId: 'g',
        pairIds: ['t1', 't2'],
      })
      assert.equal(id.length, 32)
    })
  })

  describe('planGroupTies', () => {
    const base = {
      categoryId: 'cat',
      stage: 'GROUP',
      groupId: 'grp',
      teamIds: ['LFU-01', 'LFU-02', 'LFU-03'],
      rondeCount: 3,
    }

    it('creates C(n,2) * rondeCount matches', () => {
      const plans = planGroupTies(base)
      assert.equal(plans.length, 9)
    })

    it('swaps Tim A and Tim B on alternating ronde', () => {
      const plans = planGroupTies({ ...base, rondeCount: 2 })
      const byTie = new Map<string, typeof plans>()

      for (const plan of plans) {
        const key = `${plan.roundIndex}`
        const list = byTie.get(key) ?? []
        list.push(plan)
        byTie.set(key, list)
      }

      for (const [, list] of byTie) {
        for (const ronde1 of list.filter((p) => p.rondeNumber === 1)) {
          const ronde2 = list.find(
            (p) =>
              p.rondeNumber === 2 &&
              pairKey(p.teamAId, p.teamBId) === pairKey(ronde1.teamAId, ronde1.teamBId),
          )
          assert.ok(ronde2, 'expected a second ronde for the same pairing')
          assert.equal(ronde2.teamAId, ronde1.teamBId)
          assert.equal(ronde2.teamBId, ronde1.teamAId)
        }
      }
    })

    it('gives every match a distinct (tieId, rondeNumber) pair', () => {
      const plans = planGroupTies(base)
      const seen = new Set<string>()
      for (const plan of plans) {
        const key = `${plan.tieId}:${plan.rondeNumber}`
        assert.equal(seen.has(key), false, `duplicate key ${key}`)
        seen.add(key)
      }
    })

    it('numbers ronde from 1 to rondeCount', () => {
      const plans = planGroupTies({ ...base, rondeCount: 4 })
      const numbers = new Set(plans.map((p) => p.rondeNumber))
      assert.deepEqual([...numbers].sort((a, b) => a - b), [1, 2, 3, 4])
    })

    it('returns nothing when rondeCount is invalid', () => {
      assert.deepEqual(planGroupTies({ ...base, rondeCount: 0 }), [])
      assert.deepEqual(planGroupTies({ ...base, rondeCount: -1 }), [])
      assert.deepEqual(planGroupTies({ ...base, rondeCount: 1.5 }), [])
    })

    it('returns nothing when the group has fewer than two teams', () => {
      assert.deepEqual(planGroupTies({ ...base, teamIds: ['LFU-01'] }), [])
    })
  })

  describe('countGroupMatches', () => {
    it('matches the round robin formula', () => {
      assert.equal(countGroupMatches(3, 3), 9)
      assert.equal(countGroupMatches(4, 1), 6)
      assert.equal(countGroupMatches(13, 1), 78)
    })

    it('returns zero for degenerate input', () => {
      assert.equal(countGroupMatches(1, 3), 0)
      assert.equal(countGroupMatches(3, 0), 0)
    })
  })
})
