import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isHeroAbility } from '../src/core/ability-category.ts'
import type { Snapshot } from '../src/types.ts'

const snapshotPath = resolve('public/data/snapshots/latest.json')
const assetDir = resolve('heroes/selection')
const outputPath = resolve('reports/hero-selection-map.json')

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const heroes = snapshot.abilities.filter(isHeroAbility)
  const entries = []
  for (const hero of heroes) {
    const fileName = `${hero.shortName}.png`
    const filePath = resolve(assetDir, fileName)
    const file = await stat(filePath).catch(() => undefined)
    if (!file?.isFile() || file.size === 0) throw new Error(`Missing hero selection asset: ${filePath}`)
    entries.push({ abilityId: hero.id, name: hero.name, shortName: hero.shortName, file: `heroes/selection/${fileName}` })
  }

  entries.sort((left, right) => left.abilityId - right.abilityId)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), source: 'Dota 2 VPK heroes/selection assets', entries }, null, 2)}\n`, 'utf8')
  console.log(`Mapped ${entries.length} hero selection assets to ${outputPath}`)
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
