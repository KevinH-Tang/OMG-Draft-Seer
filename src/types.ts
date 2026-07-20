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

export interface Snapshot {
  version: string
  patch: string
  generatedAt: string
  source: string
  abilities: Ability[]
  heroes: Hero[]
  abilityStats: AbilityStats[]
  pairStats: PairStats[]
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type SlotCategory = 'hero' | 'normal' | 'ultimate'

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

export interface Recommendation {
  abilityIds: number[]
  score: number
  abilityWinRate: number
  synergy: number
  averagePickPosition: number
  sampleConfidence: number
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}
