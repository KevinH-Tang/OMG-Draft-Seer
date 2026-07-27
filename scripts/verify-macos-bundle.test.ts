import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundledFrontendResourcePaths,
  containsTestWebDriverBridge,
  findUniqueBundleArtifact,
  hasOnlyArm64MacosSlice,
  missingEmbeddedRuntimeResources,
  parseMacosArchitectures,
  parseMacosBundleOptions,
  requiredRuntimeResourcePaths,
} from './verify-macos-bundle'
import type { Snapshot } from '../src/types'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('macOS bundle verifier', () => {
  it('resolves explicit bundle directories and arm64 requirements', () => {
    const root = join('fixtures', 'project')

    expect(
      parseMacosBundleOptions(['--require-arm64', '--require-dmg'], root),
    ).toEqual({
      bundleDirectory: resolve(
        root,
        'src-tauri',
        'target',
        'release',
        'bundle',
      ),
      requireArm64: true,
      requireDmg: true,
      requireRuntimeAssets: false,
    })
    expect(
      parseMacosBundleOptions(['--bundle-dir', 'artifacts/bundle'], root)
        .bundleDirectory,
    ).toBe(resolve(root, 'artifacts/bundle'))
  })

  it('requires exactly one matching artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'omg-macos-bundle-'))
    temporaryDirectories.push(directory)

    await expect(
      findUniqueBundleArtifact(directory, '.app', 'macOS app'),
    ).rejects.toThrow('found 0')

    await writeFile(join(directory, 'not-an-app.app'), '')
    await expect(
      findUniqueBundleArtifact(directory, '.app', 'macOS app'),
    ).rejects.toThrow('found 0')

    await mkdir(join(directory, 'OMG-Draft-Seer.app'))
    await expect(
      findUniqueBundleArtifact(directory, '.app', 'macOS app'),
    ).resolves.toBe(join(directory, 'OMG-Draft-Seer.app'))

    await mkdir(join(directory, 'Duplicate.app'))
    await expect(
      findUniqueBundleArtifact(directory, '.app', 'macOS app'),
    ).rejects.toThrow('found 2')
  })

  it('requires a single arm64 executable slice', () => {
    expect(hasOnlyArm64MacosSlice(['arm64'])).toBe(true)
    expect(hasOnlyArm64MacosSlice(['x86_64', 'arm64'])).toBe(false)
    expect(hasOnlyArm64MacosSlice(['x86_64'])).toBe(false)
  })

  it('derives each embedded runtime path from the snapshot candidates', () => {
    const snapshot = {
      abilities: [
        { id: 1, isHero: true },
        { id: 2, isHero: false },
        { id: 3, isHero: false },
      ],
      abilityStats: [{ abilityId: 2 }],
    } as Snapshot

    expect(requiredRuntimeResourcePaths(snapshot)).toEqual([
      '/assets/ability-icons/2.png',
      '/assets/hero-icons/1.png',
      '/data/icon-signatures.json',
      '/data/snapshots/latest.json',
    ])
  })

  it('includes every generated frontend file in the embedded-resource verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'omg-macos-frontend-'))
    temporaryDirectories.push(directory)
    await mkdir(join(directory, 'assets'))
    await mkdir(join(directory, 'heroes', 'selection'), { recursive: true })
    await writeFile(join(directory, 'index.html'), '<!doctype html>')
    await writeFile(join(directory, 'assets', 'index.js'), 'console.log(1)')
    await writeFile(join(directory, 'heroes', 'selection', 'axe.png'), 'png')

    await expect(bundledFrontendResourcePaths(directory)).resolves.toEqual([
      '/assets/index.js',
      '/heroes/selection/axe.png',
      '/index.html',
    ])
  })

  it('checks every architecture slice for frontend assets, runtime data, and the test-only bridge', () => {
    const requiredPaths = [
      '/index.html',
      '/assets/index.js',
      '/data/snapshots/latest.json',
      '/assets/ability-icons/2.png',
    ]
    const completeSlice = `${requiredPaths.join('\n')}\n`

    expect(parseMacosArchitectures('x86_64 arm64')).toEqual(['x86_64', 'arm64'])
    expect(
      missingEmbeddedRuntimeResources(completeSlice, requiredPaths),
    ).toEqual([])
    expect(
      missingEmbeddedRuntimeResources(
        '/data/snapshots/latest.json',
        requiredPaths,
      ),
    ).toEqual([
      '/index.html',
      '/assets/index.js',
      '/assets/ability-icons/2.png',
    ])
    expect(containsTestWebDriverBridge(completeSlice)).toBe(false)
    expect(
      containsTestWebDriverBridge(`${completeSlice}TAURI_WEBDRIVER_PORT`),
    ).toBe(true)
  })
})
