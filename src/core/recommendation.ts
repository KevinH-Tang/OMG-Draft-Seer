import type { Ability, PairStats, Recommendation, Snapshot } from '../types'

export const MAX_COMBINATION_EVALUATIONS = 50_000
export const MAX_SHORTLIST_SIZE = 28

interface AbilityMetric {
  effectiveWinRate: number
  weight: number
  picks: number
  avgPickPosition?: number
}

interface ScoreContext {
  abilities: Map<number, Ability>
  stats: Map<number, Snapshot['abilityStats'][number]>
  pairs: Map<string, PairStats>
}

function pairKey(leftId: number, rightId: number): string {
  return leftId < rightId ? `${leftId}:${rightId}` : `${rightId}:${leftId}`
}

function createScoreContext(snapshot: Snapshot): ScoreContext {
  const pairs = new Map<string, PairStats>()
  for (const pair of snapshot.pairStats) {
    const key = pairKey(pair.abilityIdOne, pair.abilityIdTwo)
    if (!pairs.has(key)) pairs.set(key, pair)
  }
  return {
    abilities: new Map(snapshot.abilities.map((ability) => [ability.id, ability])),
    stats: new Map(snapshot.abilityStats.map((stat) => [stat.abilityId, stat])),
    pairs,
  }
}

function abilityMetric(abilityId: number, context: ScoreContext): AbilityMetric {
  const stat = context.stats.get(abilityId)
  if (!stat || stat.picks === 0) return { effectiveWinRate: 0.5, weight: 0, picks: 0 }
  return {
    effectiveWinRate: (stat.wins + 25) / (stat.picks + 50),
    weight: stat.picks / (stat.picks + 50),
    picks: stat.picks,
    avgPickPosition: stat.avgPickPosition,
  }
}

function pairSynergy(leftId: number, rightId: number, context: ScoreContext): { value: number; weight: number } | undefined {
  const pair = context.pairs.get(pairKey(leftId, rightId))
  if (!pair || pair.picks < 30) return undefined
  const left = abilityMetric(leftId, context)
  const right = abilityMetric(rightId, context)
  return {
    value: pair.wins / pair.picks - (left.effectiveWinRate + right.effectiveWinRate) / 2,
    weight: Math.log1p(pair.picks),
  }
}

function buildSynergy(ids: number[], context: ScoreContext): number {
  let weightedValue = 0
  let totalWeight = 0
  for (let index = 0; index < ids.length; index += 1) {
    for (const other of ids.slice(index + 1)) {
      const pair = pairSynergy(ids[index], other, context)
      if (!pair) continue
      weightedValue += pair.value * pair.weight
      totalWeight += pair.weight
    }
  }
  return totalWeight > 0 ? weightedValue / totalWeight : 0
}

function combinationCount(items: number, needed: number, stopAt = Number.POSITIVE_INFINITY): number {
  if (needed < 0 || needed > items) return 0
  const selected = Math.min(needed, items - needed)
  let count = 1
  for (let index = 1; index <= selected; index += 1) {
    count = (count * (items - selected + index)) / index
    if (count > stopAt) return count
  }
  return count
}

function forEachCombination<T>(items: T[], needed: number, visit: (selection: T[]) => void): void {
  const selection: T[] = []
  const visitBranch = (start: number, remaining: number) => {
    if (remaining === 0) {
      visit([...selection])
      return
    }
    for (let index = start; index <= items.length - remaining; index += 1) {
      selection.push(items[index])
      visitBranch(index + 1, remaining - 1)
      selection.pop()
    }
  }
  visitBranch(0, needed)
}

function scoreBuild(ids: number[], context: ScoreContext): Recommendation {
  const abilities = ids
    .map((id) => context.abilities.get(id))
    .filter((ability): ability is Ability => Boolean(ability))
  const individual = abilities.map((ability) => abilityMetric(ability.id, context))
  const totalWeight = individual.reduce((sum, item) => sum + item.weight, 0)
  const abilityWinRate = totalWeight > 0
    ? individual.reduce((sum, item) => sum + item.effectiveWinRate * item.weight, 0) / totalWeight
    : 0.5
  const synergy = buildSynergy(ids, context)
  const ultimatePenalty = abilities.filter((ability) => ability.isUltimate).length > 1 ? -0.09 : 0
  const score = abilityWinRate * 100 + synergy * 100 + ultimatePenalty * 100
  const averageReliability = individual.reduce((sum, item) => sum + item.weight, 0) / Math.max(1, individual.length)
  const positions = individual.flatMap((item) => item.avgPickPosition === undefined ? [] : [item.avgPickPosition])
  const averagePickPosition = positions.length > 0 ? positions.reduce((sum, position) => sum + position, 0) / positions.length : 50
  const reasons = [
    `平滑基础胜率 ${(abilityWinRate * 100).toFixed(1)}%`,
    synergy !== 0 ? `技能对协同 ${synergy > 0 ? '+' : ''}${(synergy * 100).toFixed(1)}%` : '没有足够的技能对协同样本',
    `样本可信度 ${(averageReliability * 100).toFixed(0)}%`,
  ]
  if (ultimatePenalty) reasons.push('多个终极技能会降低可用性评分')
  return {
    abilityIds: ids,
    score,
    abilityWinRate,
    synergy,
    averagePickPosition,
    sampleConfidence: averageReliability,
    confidence: averageReliability >= 0.75 ? 'high' : averageReliability >= 0.45 ? 'medium' : 'low',
    reasons,
  }
}

function candidatePriority(id: number, selected: number[], context: ScoreContext): number {
  const ability = context.abilities.get(id)
  if (!ability) return Number.NEGATIVE_INFINITY
  const stat = abilityMetric(id, context)
  const base = (stat.effectiveWinRate - 0.5) * stat.weight * 100
  const selectedSynergy = selected.reduce((sum, selectedId) => sum + (pairSynergy(id, selectedId, context)?.value ?? 0) * 100, 0)
  const ultimatePenalty = ability.isUltimate && selected.some((selectedId) => context.abilities.get(selectedId)?.isUltimate) ? -9 : 0
  return base + selectedSynergy + ultimatePenalty
}

function shortlistCandidates(candidates: number[], selected: number[], needed: number, context: ScoreContext): number[] {
  if (combinationCount(candidates.length, needed, MAX_COMBINATION_EVALUATIONS) <= MAX_COMBINATION_EVALUATIONS) return candidates
  return [...candidates]
    .map((id, index) => ({ id, index, priority: candidatePriority(id, selected, context) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .slice(0, Math.max(needed, MAX_SHORTLIST_SIZE))
    .map((item) => item.id)
}

export function recommendBuilds(
  candidateIds: number[],
  selectedIds: number[],
  snapshot: Snapshot,
  limit = 10,
): Recommendation[] {
  if (limit <= 0) return []
  const context = createScoreContext(snapshot)
  const knownCandidates = [...new Set(candidateIds)].filter((id) => context.abilities.has(id))
  const selected = [...new Set(selectedIds)].filter((id) => knownCandidates.includes(id)).slice(0, 4)
  const available = knownCandidates.filter((id) => !selected.includes(id))
  const needed = 4 - selected.length
  if (needed < 0 || available.length < needed) return []
  const searchCandidates = shortlistCandidates(available, selected, needed, context)
  const recommendations: Recommendation[] = []
  forEachCombination(searchCandidates, needed, (addition) => {
    recommendations.push(scoreBuild([...selected, ...addition], context))
  })
  return recommendations
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}
