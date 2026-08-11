import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { OverlayState } from '../platform/overlays'
import type {
  CombinationRecommendation,
  CombinationRecommendationGroup,
  Snapshot,
} from '../types'
import { FloatingOverlay } from './OverlayViews'

const snapshot: Snapshot = {
  version: 'test',
  patch: 'test',
  generatedAt: '2026-08-09T00:00:00.000Z',
  source: 'test',
  heroes: [],
  abilities: [
    {
      id: 1,
      name: 'First Ability',
      shortName: 'first',
      isUltimate: false,
      iconColor: '#111111',
    },
    {
      id: 2,
      name: 'Second Ability',
      shortName: 'second',
      isUltimate: false,
      iconColor: '#222222',
    },
    {
      id: 3,
      name: 'Candidate Third',
      shortName: 'third',
      isUltimate: false,
      iconColor: '#333333',
    },
    {
      id: 4,
      name: 'Another Third',
      shortName: 'another-third',
      isUltimate: false,
      iconColor: '#444444',
    },
  ],
  abilityStats: [
    { abilityId: 1, picks: 100, wins: 50, avgPickPosition: 1 },
    { abilityId: 2, picks: 100, wins: 50, avgPickPosition: 2 },
    { abilityId: 3, picks: 100, wins: 50, avgPickPosition: 3 },
    { abilityId: 4, picks: 100, wins: 50, avgPickPosition: 4 },
  ],
  pairStats: [{ abilityIdOne: 1, abilityIdTwo: 2, picks: 100, wins: 60 }],
  tripletStats: [
    {
      abilityIdOne: 1,
      abilityIdTwo: 2,
      abilityIdThree: 3,
      picks: 70,
      wins: 49,
    },
    {
      abilityIdOne: 1,
      abilityIdTwo: 2,
      abilityIdThree: 4,
      picks: 60,
      wins: 39,
    },
  ],
}

const tripleRecommendation: CombinationRecommendation = {
  type: 'triple',
  abilityIds: [1, 3, 4],
  score: 70,
  winRate: 0.7,
  baseWinRate: 0.5,
  synergy: 0.2,
  logitSynergy: 0.8,
  picks: 321,
  selectedCount: 0,
}

const pairRecommendation: CombinationRecommendation = {
  type: 'pair',
  abilityIds: [1, 2],
  score: 60,
  winRate: 0.6,
  baseWinRate: 0.5,
  synergy: 0.1,
  logitSynergy: 0.4,
  picks: 100,
  selectedCount: 0,
}

const recommendationGroups: CombinationRecommendationGroup[] = [
  {
    pairAbilityIds: [1, 2],
    pair: pairRecommendation,
    triples: [
      {
        ...tripleRecommendation,
        abilityIds: [1, 2, 3],
      },
    ],
  },
  {
    pairAbilityIds: [1, 4],
    triples: [tripleRecommendation],
  },
]

function renderOverlay(): string {
  const state: OverlayState = {
    recognitionStatus: 'ready',
    candidatePools: {
      heroIds: [],
      abilityIds: [1, 2, 3, 4],
      ultimateIds: [],
    },
    combinationRecommendationGroups: recommendationGroups,
    locale: 'en',
    tierCategory: 'all',
    tierQuery: '',
  }

  return renderToStaticMarkup(
    <FloatingOverlay
      kind="recommendation"
      state={state}
      snapshot={snapshot}
      abilities={
        new Map(snapshot.abilities.map((ability) => [ability.id, ability]))
      }
    />,
  )
}

describe('FloatingOverlay combination recommendations', () => {
  it('renders Pair rows with their sorted third abilities in state order', () => {
    const markup = renderOverlay()
    const combinations = markup.slice(
      markup.indexOf('data-testid="overlay-combination-recommendations"'),
    )

    expect(combinations).toContain('Candidate Third')
    expect(combinations).toContain('仅三技能数据')
    expect(combinations.indexOf('combination-popularity-row')).toBeLessThan(
      combinations.indexOf('pair-recommendation-row'),
    )
    expect(combinations.indexOf('combination-popularity-row')).toBeLessThan(
      combinations.indexOf('overlay-combination-recommendations-scroll'),
    )
    expect(combinations.indexOf('Second Ability')).toBeLessThan(
      combinations.indexOf('Another Third'),
    )
  })

  it('uses a dedicated vertical wheel-scroll region', () => {
    expect(renderOverlay()).toContain(
      'max-h-[465px] touch-pan-y gap-1.5 overflow-y-auto',
    )
  })
})
