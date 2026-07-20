import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const API_BASE = 'https://api.windrun.io/api/v2'
const output = resolve('public/data/snapshots/latest.json')

type RemoteAbility = { valveId: number; englishName: string; shortName: string; ownerHeroId: number | null; isUltimate: boolean | null }
type RemoteHero = { id: number; englishName?: string; name?: string; primaryAttribute?: string }

function colorFor(seed: string): string {
  let hash = 0
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return `#${(hash >>> 0).toString(16).padStart(6, '0').slice(0, 6)}`
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

async function main() {
  const [abilityResponse, heroResponse, statsResponse, pairsResponse] = await Promise.all([
    getJson<{ data: RemoteAbility[] }>('/static/abilities'),
    getJson<{ data: RemoteHero[] | Record<string, RemoteHero> }>('/static/heroes'),
    getJson<{ data: { abilityStats: { abilityId: number; numPicks: number; avgPickPosition: number; wins: number }[]; patches?: { overall?: string[] } } }>('/abilities'),
    getJson<{ data: { abilityPairs: { abilityIdOne: number; abilityIdTwo: number; numPicks: number; wins: number }[] } }>('/ability-pairs'),
  ])
  const heroes = Array.isArray(heroResponse.data) ? heroResponse.data : Object.values(heroResponse.data)
  const snapshot = {
    version: `windrun-${new Date().toISOString()}`,
    patch: statsResponse.data.patches?.overall?.[0] ?? 'unknown',
    generatedAt: new Date().toISOString(),
    source: 'Windrun public API snapshot. Review source and asset licences before redistribution.',
    abilities: [
      ...abilityResponse.data.filter((item) => item.valveId < 0 && item.englishName.startsWith('Hero:')).map((item) => ({
        id: item.valveId, name: item.englishName.replace(/^Hero:\s*/, ''), shortName: item.shortName,
        isUltimate: false, isHero: true, iconColor: colorFor(item.shortName),
      })),
      ...abilityResponse.data.filter((item) => item.valveId > 0 && item.englishName).map((item) => ({
        id: item.valveId, name: item.englishName, shortName: item.shortName, ownerHeroId: item.ownerHeroId ?? undefined,
        isUltimate: Boolean(item.isUltimate), isHero: false, iconColor: colorFor(item.shortName),
      })),
    ],
    heroes: heroes.map((item) => ({ id: item.id, name: item.englishName ?? item.name ?? `Hero ${item.id}`, primaryAttribute: item.primaryAttribute ?? 'uni' })),
    abilityStats: statsResponse.data.abilityStats.map((item) => ({ abilityId: item.abilityId, picks: item.numPicks, avgPickPosition: item.avgPickPosition, wins: item.wins })),
    pairStats: pairsResponse.data.abilityPairs.map((item) => ({ abilityIdOne: item.abilityIdOne, abilityIdTwo: item.abilityIdTwo, picks: item.numPicks, wins: item.wins })),
  }
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.tmp`
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  await rename(temporary, output)
  console.log(`Wrote ${snapshot.abilities.length} abilities to ${output}`)
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
