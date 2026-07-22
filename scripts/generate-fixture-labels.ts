import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import { clampRectToCanvas, cropCenter, parseLayoutDocument } from '../src/core/layout.ts'
import { decodeTemplateSignatures, rankByTemplate, signatureFromRgba } from '../src/core/template-matching.ts'
import type { IconSignature, Snapshot } from '../src/types.ts'

const fixtureDirectory = resolve('tests/fixtures')
const layoutPath = resolve('omg-layout-2560x1440.json')
const snapshotPath = resolve('public/data/snapshots/latest.json')
const signaturesPath = resolve('public/data/icon-signatures.json')
const FIXTURE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])

interface FixtureImage {
  width: number
  height: number
  data: Uint8Array
}

function decodeFixtureImage(fileName: string, input: Buffer): FixtureImage {
  const extension = extname(fileName).toLowerCase()
  if (extension === '.png') return PNG.sync.read(input)
  if (extension === '.jpg' || extension === '.jpeg') return decode(input, { useTArray: true })
  throw new Error(`Unsupported fixture format: ${fileName}`)
}

function cropPixels(image: FixtureImage, crop: { x: number; y: number; width: number; height: number }): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(crop.width * crop.height * 4)
  for (let row = 0; row < crop.height; row += 1) {
    const sourceStart = ((crop.y + row) * image.width + crop.x) * 4
    const targetStart = row * crop.width * 4
    pixels.set(image.data.subarray(sourceStart, sourceStart + crop.width * 4), targetStart)
  }
  return pixels
}

async function main() {
  const layout = parseLayoutDocument(JSON.parse(await readFile(layoutPath, 'utf8')))
  if (!layout) throw new Error('Invalid default layout')
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const signaturePayload = JSON.parse(await readFile(signaturesPath, 'utf8')) as { signatures?: IconSignature[] }
  const templates = decodeTemplateSignatures(signaturePayload.signatures ?? [])
  if (templates.size === 0) throw new Error('No template signatures available')
  const fixtureNames = (await readdir(fixtureDirectory)).filter((fileName) => FIXTURE_IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase()))

  if (fixtureNames.length === 0) throw new Error('No PNG, JPG, or JPEG fixtures found')

  for (const fixtureName of fixtureNames) {
    const image = decodeFixtureImage(fixtureName, await readFile(resolve(fixtureDirectory, fixtureName)))
    if (image.width !== layout.width || image.height !== layout.height) {
      throw new Error(`${fixtureName} must be ${layout.width}x${layout.height}, received ${image.width}x${image.height}`)
    }

    const labels: Record<string, number> = {}
    for (const [index, slot] of layout.slots.entries()) {
      const rect = clampRectToCanvas(slot.rect, image.width, image.height)
      const crop = cropCenter(rect)
      const candidates = rankByTemplate(signatureFromRgba(cropPixels(image, crop), crop.width, crop.height), snapshot.abilities, slot.category, templates)
      const topCandidate = candidates[0]
      if (!topCandidate) throw new Error(`${fixtureName} slot ${index} has no matching candidate`)
      labels[String(index)] = topCandidate.abilityId
    }

    const labelPath = resolve(fixtureDirectory, `${basename(fixtureName, extname(fixtureName))}.json`)
    await writeFile(labelPath, `${JSON.stringify(labels, null, 2)}\n`, 'utf8')
    console.log(`${fixtureName}: wrote ${Object.keys(labels).length} labels`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
