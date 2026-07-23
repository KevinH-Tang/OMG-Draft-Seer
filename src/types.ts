export interface Ability {
  id: number
  name: string
  shortName: string
  ownerHeroId?: number
  isUltimate: boolean
  isHero?: boolean
  iconColor: string
}

export interface Hero {
  id: number
  name: string
  primaryAttribute: 'str' | 'agi' | 'int' | 'uni'
}

export interface AbilityStats {
  abilityId: number
  picks: number
  avgPickPosition: number
  wins: number
}

export interface PairStats {
  abilityIdOne: number
  abilityIdTwo: number
  picks: number
  wins: number
}

export interface TripletStats {
  abilityIdOne: number
  abilityIdTwo: number
  abilityIdThree: number
  picks: number
  wins: number
}

export interface Snapshot {
  version: string
  patch: string
  generatedAt: string
  source: string
  abilities: Ability[]
  heroes: Hero[]
  abilityStats: AbilityStats[]
  abilityValuations?: Record<string, number>
  pairStats: PairStats[]
  tripletStats?: TripletStats[]
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type SlotCategory = 'hero' | 'ability' | 'ultimate'

export interface IconCandidate {
  abilityId: number
  score: number
}

export interface IconSignature {
  abilityId: number
  variant?: string
  luma: string
  meanRgb: [number, number, number]
}

export interface RecognizedSlot {
  index: number
  category: SlotCategory
  rect: Rect
  crop: Rect
  candidates: IconCandidate[]
  selectedAbilityId?: number
  preview?: Blob
  matchMode?: 'template' | 'color-fallback'
}

export interface RecommendationInteraction {
  type: 'pair' | 'triple'
  abilityIds: number[]
  synergy: number
  rawSynergy: number
  logitSynergy: number
  rawLogitSynergy: number
  picks: number
}

export interface PartialRecommendationInteraction {
  type: 'triple'
  abilityIds: number[]
  rawLogitSynergy: number
  picks: number
  pairCoverage: number
  missingPairIds: number[][]
}

export interface Recommendation {
  abilityIds: number[]
  pickOrderIds: number[]
  score: number
  abilityWinRate: number
  synergy: number
  logitSynergy: number
  effectiveInteractionCount: number
  effectiveInteractions: RecommendationInteraction[]
  partialInteractions: PartialRecommendationInteraction[]
  averagePickPosition: number
}
