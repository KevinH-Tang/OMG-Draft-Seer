import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import { matchesSlotCategory } from '../src/core/ability-category'
import {
  clampRectToCanvas,
  cropCenter,
  parseLayoutDocument,
} from '../src/core/layout'
import { buildProjectedLayout, quadBounds } from '../src/core/projective-layout'
import {
  decodeTemplateSignatures,
  rankByTemplate,
  signatureFromQuad,
  signatureFromRgba,
} from '../src/core/template-matching'
import type { IconSignature, Snapshot } from '../src/types'

const fixtureDirectory = resolve('tests/fixtures')
const layoutPath = resolve('omg-layout-2560x1440.json')
const snapshotPath = resolve('public/data/snapshots/latest.json')
const signaturesPath = resolve('public/data/icon-signatures.json')
const FIXTURE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg'])
const PROJECTED_RECOGNITION_MISMATCH_BASELINE = [] as const
const MANUAL_RECOGNITION_MISMATCH_BASELINE = [
  '{241DAD27-9A37-4364-BF08-68998F993992}.jpg:6 expected -28, received -91',
  '{882F0EEC-91F7-44F6-A38A-BB0A3EA169CD}.jpg:16 expected 5280, received 5585',
  '{9743DEFE-A22D-431A-B9C6-C514A127174F}.png:28 expected 5582, received 5471',
] as const

interface FixtureImage {
  width: number
  height: number
  data: Uint8Array
}

function cropPixels(
  image: FixtureImage,
  crop: { x: number; y: number; width: number; height: number },
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(crop.width * crop.height * 4)
  for (let row = 0; row < crop.height; row += 1) {
    const sourceStart = ((crop.y + row) * image.width + crop.x) * 4
    const targetStart = row * crop.width * 4
    pixels.set(
      image.data.subarray(sourceStart, sourceStart + crop.width * 4),
      targetStart,
    )
  }
  return pixels
}

function decodeFixtureImage(fileName: string, input: Buffer): FixtureImage {
  const extension = extname(fileName).toLowerCase()
  if (extension === '.png') return PNG.sync.read(input)
  if (extension === '.jpg' || extension === '.jpeg')
    return decode(input, { useTArray: true })
  throw new Error(`Unsupported fixture format: ${fileName}`)
}

async function listFixtureImages(
  directory = fixtureDirectory,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const names = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) return listFixtureImages(path)
      return FIXTURE_IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())
        ? [relative(fixtureDirectory, path)]
        : []
    }),
  )
  return names.flat().sort()
}

async function loadFixtureContext() {
  const layout = parseLayoutDocument(
    JSON.parse(await readFile(layoutPath, 'utf8')),
  )
  if (!layout) throw new Error('Invalid default layout')
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Snapshot
  const signaturePayload = JSON.parse(
    await readFile(signaturesPath, 'utf8'),
  ) as { signatures?: IconSignature[] }
  const allFixtureNames = await listFixtureImages()
  const fixtureNames = allFixtureNames.filter(
    (fileName) => dirname(fileName) === '.',
  )
  return {
    allFixtureNames,
    layout,
    snapshot,
    templates: decodeTemplateSignatures(signaturePayload.signatures ?? []),
    fixtureNames,
  }
}

describe('golden screenshot fixtures', () => {
  it('decodes and projects every nested resolution and bad-case fixture', async () => {
    const { allFixtureNames, fixtureNames } = await loadFixtureContext()
    const nestedFixtureNames = allFixtureNames.filter(
      (fileName) => !fixtureNames.includes(fileName),
    )

    expect(
      new Set(nestedFixtureNames.map((fileName) => fileName.split(/[\\/]/)[0])),
    ).toEqual(new Set(['badcase', 'resolution']))

    for (const fixtureName of nestedFixtureNames) {
      const image = decodeFixtureImage(
        fixtureName,
        await readFile(resolve(fixtureDirectory, fixtureName)),
      )
      const dimensions = basename(fixtureName).match(/^(\d+)x(\d+)/)
      if (dimensions) {
        expect([image.width, image.height], fixtureName).toEqual([
          Number(dimensions[1]),
          Number(dimensions[2]),
        ])
      }
      expect(
        buildProjectedLayout(image.width, image.height),
        fixtureName,
      ).toHaveLength(60)
    }
  })

  it('keeps every approved fixture at 2560x1440 with 60 labels', async () => {
    const { layout, snapshot, fixtureNames } = await loadFixtureContext()
    expect(fixtureNames.length).toBeGreaterThan(0)

    for (const fixtureName of fixtureNames) {
      const image = decodeFixtureImage(
        fixtureName,
        await readFile(resolve(fixtureDirectory, fixtureName)),
      )
      const labels = JSON.parse(
        await readFile(
          resolve(
            fixtureDirectory,
            `${basename(fixtureName, extname(fixtureName))}.json`,
          ),
          'utf8',
        ),
      ) as Record<string, number>
      expect([image.width, image.height]).toEqual([layout.width, layout.height])
      expect(
        Object.keys(labels)
          .map(Number)
          .sort((left, right) => left - right),
      ).toEqual(Array.from({ length: 60 }, (_, index) => index))
      for (const [slotIndex, abilityId] of Object.entries(labels)) {
        const ability = snapshot.abilities.find((item) => item.id === abilityId)
        expect(Number.isInteger(abilityId), `${fixtureName}:${slotIndex}`).toBe(
          true,
        )
        expect(ability, `${fixtureName}:${slotIndex}`).toBeDefined()
        expect(
          matchesSlotCategory(
            ability!,
            layout.slots[Number(slotIndex)].category,
          ),
          `${fixtureName}:${slotIndex}`,
        ).toBe(true)
      }
    }
  })

  it('keeps projective recognition within the approved fixture baseline', async () => {
    const { snapshot, templates, fixtureNames } = await loadFixtureContext()
    const mismatches: string[] = []

    for (const fixtureName of fixtureNames) {
      const image = decodeFixtureImage(
        fixtureName,
        await readFile(resolve(fixtureDirectory, fixtureName)),
      )
      const expected = JSON.parse(
        await readFile(
          resolve(
            fixtureDirectory,
            `${basename(fixtureName, extname(fixtureName))}.json`,
          ),
          'utf8',
        ),
      ) as Record<string, number>
      const actual: Record<string, number> = {}
      const projectedLayout = buildProjectedLayout(image.width, image.height)
      expect(projectedLayout, fixtureName).toBeDefined()

      for (const [index, slot] of projectedLayout!.entries()) {
        const crop = clampRectToCanvas(
          quadBounds(slot.matchQuad!),
          image.width,
          image.height,
        )
        const projectedCandidates = rankByTemplate(
          signatureFromQuad(
            cropPixels(image, crop),
            crop.width,
            crop.height,
            slot.matchQuad!,
            crop.x,
            crop.y,
          ),
          snapshot.abilities,
          slot.category,
          templates,
        )
        actual[String(index)] = projectedCandidates[0]?.abilityId ?? Number.NaN
      }

      for (const [slotIndex, expectedAbilityId] of Object.entries(expected)) {
        if (actual[slotIndex] !== expectedAbilityId) {
          mismatches.push(
            `${fixtureName}:${slotIndex} expected ${expectedAbilityId}, received ${actual[slotIndex]}`,
          )
        }
      }
    }

    expect(mismatches).toEqual(PROJECTED_RECOGNITION_MISMATCH_BASELINE)
    expect(mismatches.some((mismatch) => mismatch.includes('.jpg:0 '))).toBe(
      false,
    )
  })

  it('keeps manual-layout recognition within the approved baseline', async () => {
    const { layout, snapshot, templates, fixtureNames } =
      await loadFixtureContext()
    const mismatches: string[] = []

    for (const fixtureName of fixtureNames) {
      const image = decodeFixtureImage(
        fixtureName,
        await readFile(resolve(fixtureDirectory, fixtureName)),
      )
      const expected = JSON.parse(
        await readFile(
          resolve(
            fixtureDirectory,
            `${basename(fixtureName, extname(fixtureName))}.json`,
          ),
          'utf8',
        ),
      ) as Record<string, number>
      const actual: Record<string, number> = {}

      for (const [index, slot] of layout.slots.entries()) {
        const rect = clampRectToCanvas(slot.rect, image.width, image.height)
        const crop = cropCenter(rect)
        const candidates = rankByTemplate(
          signatureFromRgba(cropPixels(image, crop), crop.width, crop.height),
          snapshot.abilities,
          slot.category,
          templates,
        )
        actual[String(index)] = candidates[0]?.abilityId ?? Number.NaN
      }

      for (const [slotIndex, expectedAbilityId] of Object.entries(expected)) {
        if (actual[slotIndex] !== expectedAbilityId) {
          mismatches.push(
            `${fixtureName}:${slotIndex} expected ${expectedAbilityId}, received ${actual[slotIndex]}`,
          )
        }
      }
    }

    expect(mismatches).toEqual(MANUAL_RECOGNITION_MISMATCH_BASELINE)
  })
})
