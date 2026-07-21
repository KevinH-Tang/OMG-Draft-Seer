import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import type { IconSignature, Snapshot } from '../src/types.ts'

const snapshotPath = resolve('public/data/snapshots/latest.json')
const signaturesPath = resolve('public/data/icon-signatures.json')
const iconManifestPath = resolve('reports/ability-icon-cache.json')
const assetRoot = resolve('public/assets')

interface IconCacheEntry {
  abilityId: number
  category: 'hero' | 'ultimate' | 'ability'
  fileName: string
  status: 'cached' | 'downloaded' | 'missing'
}

interface IconCacheManifest {
  count?: number
  cached?: number
  missing?: number
  categories?: { heroes?: number; ultimates?: number; abilities?: number }
  entries?: IconCacheEntry[]
}

function runtimeAbilities(snapshot: Snapshot): Snapshot['abilities'] {
  const statAbilityIds = new Set(snapshot.abilityStats.map((stat) => stat.abilityId))
  return snapshot.abilities.filter((ability) => ability.isHero || statAbilityIds.has(ability.id))
}

function iconPath(ability: Snapshot['abilities'][number]): string {
  return resolve(assetRoot, ability.isHero ? 'hero-icons' : 'ability-icons', `${ability.id}.png`)
}

async function verifyPng(path: string): Promise<string | undefined> {
  try {
    const buffer = await readFile(path)
    if (buffer.length === 0) return 'empty file'
    PNG.sync.read(buffer)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : 'invalid PNG'
  }
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const signatureFile = JSON.parse(await readFile(signaturesPath, 'utf8')) as { count?: number; signatures?: IconSignature[] }
  const iconManifest = JSON.parse(await readFile(iconManifestPath, 'utf8')) as IconCacheManifest
  const abilities = runtimeAbilities(snapshot)
  const abilityById = new Map(snapshot.abilities.map((ability) => [ability.id, ability]))
  const candidateIds = new Set(abilities.map((ability) => ability.id))
  const signatures = signatureFile.signatures ?? []
  const signedIds = new Set((signatureFile.signatures ?? []).map((signature) => signature.abilityId))
  const manifestEntries = iconManifest.entries ?? []
  const manifestIds = new Set(manifestEntries.map((entry) => entry.abilityId))
  const failures: string[] = []

  if (signatureFile.count !== undefined && signatureFile.count !== signatures.length) {
    failures.push(`signature count mismatch: declared ${signatureFile.count}, found ${signatures.length}`)
  }
  if (signedIds.size !== abilities.length) {
    failures.push(`signature ID count mismatch: expected ${abilities.length}, found ${signedIds.size}`)
  }
  if (iconManifest.count !== undefined && iconManifest.count !== manifestEntries.length) {
    failures.push(`icon manifest count mismatch: declared ${iconManifest.count}, found ${manifestEntries.length}`)
  }
  if (manifestIds.size !== abilities.length) {
    failures.push(`icon manifest ID count mismatch: expected ${abilities.length}, found ${manifestIds.size}`)
  }

  for (const ability of abilities) {
    if (!signedIds.has(ability.id)) failures.push(`${ability.id} ${ability.name}: missing template signature`)
    const path = iconPath(ability)
    const pngError = await verifyPng(path)
    if (pngError) failures.push(`${ability.id} ${ability.name}: ${pngError} (${path})`)
  }

  for (const signature of signatures) {
    if (!candidateIds.has(signature.abilityId)) {
      failures.push(`${signature.abilityId}: signature is not in the runtime snapshot`)
      continue
    }
    try {
      const decodedLength = Buffer.from(signature.luma, 'base64').length
      if (decodedLength !== 256) failures.push(`${signature.abilityId}: signature luma has ${decodedLength} bytes, expected 256`)
    } catch {
      failures.push(`${signature.abilityId}: signature luma is not valid base64`)
    }
    if (signature.meanRgb.length !== 3 || signature.meanRgb.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
      failures.push(`${signature.abilityId}: signature meanRgb is invalid`)
    }
  }

  for (const entry of manifestEntries) {
    const ability = abilityById.get(entry.abilityId)
    const expectedFileName = ability ? `${ability.isHero ? 'hero-icons' : 'ability-icons'}/${ability.id}.png` : undefined
    if (!candidateIds.has(entry.abilityId)) failures.push(`${entry.abilityId}: icon manifest entry is not in the runtime snapshot`)
    if (expectedFileName && entry.fileName !== expectedFileName) failures.push(`${entry.abilityId}: icon manifest path mismatch`)
    if (entry.status === 'missing') failures.push(`${entry.abilityId}: icon manifest marks the runtime icon as missing`)
  }

  const cachedEntries = manifestEntries.filter((entry) => entry.status !== 'missing')
  const missingEntries = manifestEntries.filter((entry) => entry.status === 'missing')
  if (iconManifest.cached !== undefined && iconManifest.cached !== cachedEntries.length) {
    failures.push(`icon manifest cached count mismatch: declared ${iconManifest.cached}, found ${cachedEntries.length}`)
  }
  if (iconManifest.missing !== undefined && iconManifest.missing !== missingEntries.length) {
    failures.push(`icon manifest missing count mismatch: declared ${iconManifest.missing}, found ${missingEntries.length}`)
  }
  const categoryCounts = {
    heroes: cachedEntries.filter((entry) => entry.category === 'hero').length,
    ultimates: cachedEntries.filter((entry) => entry.category === 'ultimate').length,
    abilities: cachedEntries.filter((entry) => entry.category === 'ability').length,
  }
  for (const category of Object.keys(categoryCounts) as Array<keyof typeof categoryCounts>) {
    if (iconManifest.categories?.[category] !== undefined && iconManifest.categories[category] !== categoryCounts[category]) {
      failures.push(`icon manifest ${category} count mismatch: declared ${iconManifest.categories[category]}, found ${categoryCounts[category]}`)
    }
  }

  console.log(`Runtime assets: ${abilities.length} candidates, ${signedIds.size} signed IDs, ${manifestIds.size} cached manifest IDs, ${failures.length} failures`)
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
