import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import { clampRectToCanvas, cropCenter, parseLayoutDocument } from '../src/core/layout'
import { decodeTemplateSignatures, rankByTemplate, signatureFromRgba } from '../src/core/template-matching'
import type { IconSignature, Snapshot } from '../src/types'

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

async function loadFixtureContext() {
  const layout = parseLayoutDocument(JSON.parse(await readFile(layoutPath, 'utf8')))
  if (!layout) throw new Error('Invalid default layout')
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const signaturePayload = JSON.parse(await readFile(signaturesPath, 'utf8')) as { signatures?: IconSignature[] }
  const fixtureNames = (await readdir(fixtureDirectory)).filter((fileName) => FIXTURE_IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase()))
  return { layout, snapshot, templates: decodeTemplateSignatures(signaturePayload.signatures ?? []), fixtureNames }
}

describe('golden screenshot fixtures', () => {
  it('keeps every approved fixture at 2560x1440 with 60 labels', async () => {
    const { layout, fixtureNames } = await loadFixtureContext()
    expect(fixtureNames.length).toBeGreaterThan(0)

    for (const fixtureName of fixtureNames) {
      const image = decodeFixtureImage(fixtureName, await readFile(resolve(fixtureDirectory, fixtureName)))
      const labels = JSON.parse(await readFile(resolve(fixtureDirectory, `${basename(fixtureName, extname(fixtureName))}.json`), 'utf8')) as Record<string, number>
      expect([image.width, image.height]).toEqual([layout.width, layout.height])
      expect(Object.keys(labels)).toHaveLength(60)
      expect(Object.values(labels).every((abilityId) => Number.isInteger(abilityId))).toBe(true)
    }
  })

  it('matches every labelled fixture slot with the template recognizer', async () => {
    const { layout, snapshot, templates, fixtureNames } = await loadFixtureContext()

    for (const fixtureName of fixtureNames) {
      const image = decodeFixtureImage(fixtureName, await readFile(resolve(fixtureDirectory, fixtureName)))
      const expected = JSON.parse(await readFile(resolve(fixtureDirectory, `${basename(fixtureName, extname(fixtureName))}.json`), 'utf8')) as Record<string, number>
      const actual: Record<string, number> = {}

      for (const [index, slot] of layout.slots.entries()) {
        const rect = clampRectToCanvas(slot.rect, image.width, image.height)
        const crop = cropCenter(rect)
        const candidates = rankByTemplate(signatureFromRgba(cropPixels(image, crop), crop.width, crop.height), snapshot.abilities, slot.category, templates)
        actual[String(index)] = candidates[0]?.abilityId ?? Number.NaN
      }

      expect(actual, fixtureName).toEqual(expected)
    }
  })
})
