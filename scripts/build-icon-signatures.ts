import { readFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { PNG } from 'pngjs'
import { isHeroAbility } from '../src/core/ability-category.ts'
import {
  signatureFromRgba,
  TEMPLATE_TRANSFORMS,
} from '../src/core/template-matching.ts'
import type { IconSignature, Snapshot } from '../src/types.ts'

const snapshotPath = resolve('public/data/snapshots/latest.json')
const outputPath = resolve('public/data/icon-signatures.json')
const heroSelectionDir = resolve('heroes/selection')
const concurrency = 16

function abilityIconUrl(shortName: string): string {
  return `https://cdn.datdota.com/images/ability/${encodeURIComponent(shortName)}.png`
}

async function makeSignatures(
  ability: Snapshot['abilities'][number],
): Promise<IconSignature[]> {
  try {
    const image = isHeroAbility(ability)
      ? await readFile(resolve(heroSelectionDir, `${ability.shortName}.png`))
      : await (async () => {
          const response = await fetch(abilityIconUrl(ability.shortName), {
            signal: AbortSignal.timeout(20000),
          })
          if (!response.ok) throw new Error(String(response.status))
          return Buffer.from(await response.arrayBuffer())
        })()
    const png = PNG.sync.read(image)
    return TEMPLATE_TRANSFORMS.map((transform) => {
      const signature = signatureFromRgba(
        png.data,
        png.width,
        png.height,
        transform,
      )
      return {
        abilityId: ability.id,
        variant: transform.name,
        luma: Buffer.from(signature.luma).toString('base64'),
        meanRgb: signature.meanRgb,
      }
    })
  } catch {
    return []
  }
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const statAbilityIds = new Set(
    snapshot.abilityStats.map((stat) => stat.abilityId),
  )
  const templateAbilities = snapshot.abilities.filter(
    (ability) => isHeroAbility(ability) || statAbilityIds.has(ability.id),
  )
  const signatures: IconSignature[] = []
  let next = 0
  let missing = 0
  const worker = async () => {
    while (next < templateAbilities.length) {
      const index = next++
      const abilitySignatures = await makeSignatures(templateAbilities[index])
      if (abilitySignatures.length > 0) signatures.push(...abilitySignatures)
      else missing += 1
      if ((index + 1) % 100 === 0)
        console.log(`Processed ${index + 1}/${templateAbilities.length}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  signatures.sort((left, right) => left.abilityId - right.abilityId)
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: signatures.length,
    signatures,
  }
  await mkdir(dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.tmp`
  await writeFile(temporary, `${JSON.stringify(payload)}\n`, 'utf8')
  await rename(temporary, outputPath)
  console.log(
    `Wrote ${signatures.length} icon signatures; ${missing} images missing`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
