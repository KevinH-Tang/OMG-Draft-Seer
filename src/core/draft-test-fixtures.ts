import type { Ability, Snapshot } from '../types'

export function createDraftTestSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const abilities: Ability[] = [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: -(index + 1),
      name: `Hero ${index + 1}`,
      shortName: `hero_${index + 1}`,
      isHero: true,
      isUltimate: false,
      iconColor: '#35553d',
    })),
    ...Array.from({ length: 36 }, (_, index) => ({
      id: index + 1,
      name: `Ability ${index + 1}`,
      shortName: `ability_${index + 1}`,
      isHero: false,
      isUltimate: false,
      iconColor: '#426d4d',
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      id: 101 + index,
      name: `Ultimate ${index + 1}`,
      shortName: `ultimate_${index + 1}`,
      isHero: false,
      isUltimate: true,
      iconColor: '#806b35',
    })),
  ]
  const stats = abilities.map((ability, index) => ({
    abilityId: ability.id,
    picks: 100,
    avgPickPosition: index + 1,
    wins: 50,
  }))
  return {
    version: 'draft-test',
    patch: 'test',
    generatedAt: '2026-07-22T00:00:00.000Z',
    source: 'test fixture',
    heroes: [],
    abilities,
    abilityStats: stats,
    pairStats: [],
    ...overrides,
  }
}

export const draftTestPool = {
  heroIds: Array.from({ length: 12 }, (_, index) => -(index + 1)),
  abilityIds: Array.from({ length: 36 }, (_, index) => index + 1),
  ultimateIds: Array.from({ length: 12 }, (_, index) => 101 + index),
} as const
