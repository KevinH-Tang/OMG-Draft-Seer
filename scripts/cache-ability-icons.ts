import { mkdir, readdir, rename, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { PNG } from 'pngjs'
import type { Snapshot } from '../src/types.ts'

const snapshotPath = resolve('public/data/snapshots/latest.json')
const assetRoot = resolve('public/assets')
const manifestPath = resolve('reports/ability-icon-cache.json')
const concurrency = 16

function iconUrl(ability: Snapshot['abilities'][number]): string {
  return ability.isHero
    ? `https://cdn.datdota.com/images/miniheroes/${encodeURIComponent(ability.shortName)}.png`
    : `https://cdn.datdota.com/images/ability/${encodeURIComponent(ability.shortName)}.png`
}

function relativeFileName(ability: Snapshot['abilities'][number]): string {
  return `${ability.isHero ? 'hero-icons' : 'ability-icons'}/${ability.id}.png`
}

function category(ability: Snapshot['abilities'][number]): 'hero' | 'ultimate' | 'ability' {
  return ability.isHero ? 'hero' : ability.isUltimate ? 'ultimate' : 'ability'
}

function runtimeAbilities(snapshot: Snapshot): Snapshot['abilities'] {
  const statAbilityIds = new Set(snapshot.abilityStats.map((stat) => stat.abilityId))
  return snapshot.abilities.filter((ability) => ability.isHero || statAbilityIds.has(ability.id))
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const file = await stat(path)
    return file.isFile() && file.size > 0
  } catch {
    return false
  }
}

async function pruneStaleAssets(abilities: Snapshot['abilities']): Promise<number> {
  const desired = new Set(abilities.map(relativeFileName))
  let pruned = 0
  for (const directoryName of ['hero-icons', 'ability-icons']) {
    const directory = resolve(assetRoot, directoryName)
    const fileNames = await readdir(directory).catch(() => [] as string[])
    for (const fileName of fileNames) {
      if (!fileName.endsWith('.png') || desired.has(`${directoryName}/${fileName}`)) continue
      await unlink(resolve(directory, fileName))
      pruned += 1
    }
  }
  return pruned
}

async function cacheAbility(ability: Snapshot['abilities'][number]) {
  const fileName = relativeFileName(ability)
  const outputPath = resolve(assetRoot, fileName)
  if (await fileExists(outputPath)) {
    return { abilityId: ability.id, shortName: ability.shortName, category: category(ability), fileName, status: 'cached' as const }
  }

  try {
    const response = await fetch(iconUrl(ability), { signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(String(response.status))
    const buffer = Buffer.from(await response.arrayBuffer())
    PNG.sync.read(buffer)
    await mkdir(dirname(outputPath), { recursive: true })
    const temporaryPath = `${outputPath}.tmp-${process.pid}`
    await writeFile(temporaryPath, buffer)
    await rename(temporaryPath, outputPath)
    return { abilityId: ability.id, shortName: ability.shortName, category: category(ability), fileName, status: 'downloaded' as const }
  } catch {
    return { abilityId: ability.id, shortName: ability.shortName, category: category(ability), fileName, status: 'missing' as const }
  }
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const abilities = runtimeAbilities(snapshot)
  await mkdir(assetRoot, { recursive: true })

  const results: Array<Awaited<ReturnType<typeof cacheAbility>>> = []
  let next = 0
  const worker = async () => {
    while (next < abilities.length) {
      const ability = abilities[next++]
      results.push(await cacheAbility(ability))
      if (results.length % 100 === 0) console.log(`Cached ${results.length}/${abilities.length}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  const pruned = await pruneStaleAssets(abilities)

  results.sort((left, right) => left.abilityId - right.abilityId)
  const payload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: 'Windrun DatDota CDN icon cache',
    count: results.length,
    cached: results.filter((item) => item.status !== 'missing').length,
    missing: results.filter((item) => item.status === 'missing').length,
    pruned,
    categories: {
      heroes: results.filter((item) => item.category === 'hero' && item.status !== 'missing').length,
      ultimates: results.filter((item) => item.category === 'ultimate' && item.status !== 'missing').length,
      abilities: results.filter((item) => item.category === 'ability' && item.status !== 'missing').length,
    },
    entries: results,
  }
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`Cached ${payload.cached}/${payload.count} ability icons; ${payload.missing} missing; pruned ${payload.pruned} stale files`)
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
