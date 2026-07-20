import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PNG } from 'pngjs'
import { decodeTemplateSignatures, rankByTemplate, signatureFromRgba, TEMPLATE_TRANSFORMS } from '../src/core/template-matching.ts'
import type { Ability, IconSignature, Snapshot, SlotCategory } from '../src/types.ts'

const snapshotPath = resolve('public/data/snapshots/latest.json')
const signaturesPath = resolve('public/data/icon-signatures.json')
const reportPath = resolve('reports/icon-self-check.json')
const heroSelectionDir = resolve('heroes/selection')
const concurrency = 16

function abilityIconUrl(ability: Ability): string {
  return `https://cdn.datdota.com/images/ability/${encodeURIComponent(ability.shortName)}.png`
}

function categoryFor(ability: Ability): SlotCategory {
  if (ability.isHero) return 'hero'
  return ability.isUltimate ? 'ultimate' : 'normal'
}

async function main() {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const signatureFile = JSON.parse(await readFile(signaturesPath, 'utf8')) as { signatures: IconSignature[] }
  const templates = decodeTemplateSignatures(signatureFile.signatures)
  const abilities = snapshot.abilities.filter((ability) => templates.has(ability.id))
  const transforms = TEMPLATE_TRANSFORMS.filter((transform) => transform.name !== 'base')
  const failures: Array<{ abilityId: number; name: string; transform: string; actualId?: number; actualName?: string }> = []
  const sourceFallbacks: Array<{ abilityId: number; name: string }> = []
  let checks = 0
  let next = 0
  let completed = 0

  const check = (ability: Ability, transform: string, crop: { luma: Uint8Array; meanRgb: [number, number, number] }) => {
    const top = rankByTemplate(crop, snapshot.abilities, categoryFor(ability), templates)[0]
    checks += 1
    if (!top || top.abilityId !== ability.id) {
      failures.push({ abilityId: ability.id, name: ability.name, transform, actualId: top?.abilityId, actualName: top ? snapshot.abilities.find((item) => item.id === top.abilityId)?.name : undefined })
    }
  }

  const verify = async (ability: Ability) => {
    if (ability.isHero) {
      try {
        const png = PNG.sync.read(await readFile(resolve(heroSelectionDir, `${ability.shortName}.png`)))
        for (const transform of transforms) check(ability, transform.name, signatureFromRgba(png.data, png.width, png.height, transform))
      } catch {
        for (const transform of transforms) failures.push({ abilityId: ability.id, name: ability.name, transform: transform.name })
      }
      return
    }
    try {
      const response = await fetch(abilityIconUrl(ability), { signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(String(response.status))
      const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()))
      for (const transform of transforms) {
        check(ability, transform.name, signatureFromRgba(png.data, png.width, png.height, transform))
      }
    } catch {
      sourceFallbacks.push({ abilityId: ability.id, name: ability.name })
      const stored = signatureFile.signatures.filter((signature) => signature.abilityId === ability.id)
      for (const transform of transforms) {
        const signature = stored.find((item) => item.variant === transform.name)
        if (!signature) {
          failures.push({ abilityId: ability.id, name: ability.name, transform: transform.name })
          continue
        }
        check(ability, transform.name, {
          luma: Uint8Array.from(Buffer.from(signature.luma, 'base64')),
          meanRgb: signature.meanRgb,
        })
      }
    }
  }

  const worker = async () => {
    while (next < abilities.length) {
      const ability = abilities[next++]
      await verify(ability)
      completed += 1
      if (completed % 100 === 0 || completed === abilities.length) console.log(`Verified ${completed}/${abilities.length} source icons`)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, abilities.length) }, worker))
  failures.sort((left, right) => left.abilityId - right.abilityId || left.transform.localeCompare(right.transform))
  sourceFallbacks.sort((left, right) => left.abilityId - right.abilityId)

  const report = { version: 2, generatedAt: new Date().toISOString(), checks, passed: checks - failures.length, sourceFallbacks, failures }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`Self-check: ${report.passed}/${checks} passed; ${failures.length} failures; ${sourceFallbacks.length} source fallbacks`)
  if (failures.length > 0) process.exitCode = 1
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
