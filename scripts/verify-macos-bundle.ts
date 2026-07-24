import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { constants, type Dirent } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { isHeroAbility } from '../src/core/ability-category.ts'
import type { Snapshot } from '../src/types.ts'

const APP_BINARY_NAME = 'omg-draft-seer'

export interface MacosBundleOptions {
  bundleDirectory: string
  requireArm64: boolean
  requireDmg: boolean
  requireRuntimeAssets: boolean
}

function usage(): string {
  return [
    'Usage: npm run verify:macos-bundle -- [options]',
    '',
    'Options:',
    '  --bundle-dir <path>  Bundle directory to inspect.',
    '  --target <triple>    Resolve bundle directory under src-tauri/target/<triple>/release/bundle.',
    '  --require-arm64      Require arm64 as the only executable slice.',
    '  --require-dmg        Require exactly one DMG in the bundle directory.',
    '  --require-runtime-assets  Verify every runtime resource is embedded in each executable slice.',
  ].join('\n')
}

export function parseMacosBundleOptions(
  argv: readonly string[],
  projectRoot = process.cwd(),
): MacosBundleOptions {
  let bundleDirectory = resolve(projectRoot, 'src-tauri/target/release/bundle')
  let requireArm64 = false
  let requireDmg = false
  let requireRuntimeAssets = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--require-dmg') {
      requireDmg = true
      continue
    }
    if (argument === '--require-arm64') {
      requireArm64 = true
      continue
    }
    if (argument === '--require-runtime-assets') {
      requireRuntimeAssets = true
      continue
    }
    if (argument === '--bundle-dir' || argument === '--target') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value for ${argument}.\n\n${usage()}`)
      bundleDirectory =
        argument === '--bundle-dir'
          ? resolve(projectRoot, value)
          : resolve(
              projectRoot,
              'src-tauri',
              'target',
              value,
              'release',
              'bundle',
            )
      index += 1
      continue
    }
    if (argument === '--help' || argument === '-h') throw new Error(usage())
    throw new Error(`Unknown option: ${argument}.\n\n${usage()}`)
  }

  return { bundleDirectory, requireArm64, requireDmg, requireRuntimeAssets }
}

export async function findUniqueBundleArtifact(
  directory: string,
  suffix: string,
  label: string,
): Promise<string> {
  let entries: Dirent<string>[]
  try {
    entries = await readdir(directory, {
      encoding: 'utf8',
      withFileTypes: true,
    })
  } catch (error) {
    throw new Error(`Could not read ${label} directory: ${directory}`, {
      cause: error,
    })
  }

  const isApp = suffix === '.app'
  const matches = entries
    .filter(
      (entry) =>
        entry.name.endsWith(suffix) &&
        (isApp ? entry.isDirectory() : entry.isFile()),
    )
    .map((entry) => join(directory, entry.name))
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${label} ending in ${suffix} in ${directory}; found ${matches.length}.`,
    )
  }
  return matches[0]
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${command} ${args.join(' ')} failed: ${stderr.trim() || error.message}`,
              { cause: error },
            ),
          )
          return
        }
        resolveOutput(stdout.trim())
      },
    )
  })
}

export function hasOnlyArm64MacosSlice(
  architectures: readonly string[],
): boolean {
  return architectures.length === 1 && architectures[0] === 'arm64'
}

export function parseMacosArchitectures(lipoArchitectures: string): string[] {
  return lipoArchitectures.trim().split(/\s+/).filter(Boolean)
}

export function requiredRuntimeResourcePaths(snapshot: Snapshot): string[] {
  const statisticalAbilityIds = new Set(
    snapshot.abilityStats.map((stat) => stat.abilityId),
  )
  const paths = ['/data/icon-signatures.json', '/data/snapshots/latest.json']

  for (const ability of snapshot.abilities) {
    if (!isHeroAbility(ability) && !statisticalAbilityIds.has(ability.id))
      continue
    const category = isHeroAbility(ability) ? 'hero-icons' : 'ability-icons'
    paths.push(`/assets/${category}/${ability.id}.png`)
  }

  return [...new Set(paths)].sort()
}

export async function bundledFrontendResourcePaths(
  directory: string,
  relativeDirectory = '',
): Promise<string[]> {
  const entries = await readdir(directory, {
    encoding: 'utf8',
    withFileTypes: true,
  })
  const paths: string[] = []

  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name
    if (entry.isDirectory()) {
      paths.push(
        ...(await bundledFrontendResourcePaths(
          join(directory, entry.name),
          relativePath,
        )),
      )
      continue
    }
    if (entry.isFile()) paths.push(`/${relativePath}`)
  }

  return paths.sort()
}

export function missingEmbeddedRuntimeResources(
  binaryStrings: string,
  requiredPaths: readonly string[],
): string[] {
  return requiredPaths.filter((path) => !binaryStrings.includes(path))
}

export function containsTestWebDriverBridge(binaryStrings: string): boolean {
  return binaryStrings.includes('TAURI_WEBDRIVER_PORT')
}

async function runtimeResourcePaths(projectRoot: string): Promise<string[]> {
  const snapshotPath = join(
    projectRoot,
    'public',
    'data',
    'snapshots',
    'latest.json',
  )
  const frontendDirectory = join(projectRoot, 'dist')
  const [snapshotSource, frontendPaths] = await Promise.all([
    readFile(snapshotPath, 'utf8'),
    bundledFrontendResourcePaths(frontendDirectory),
  ])
  const snapshot = JSON.parse(snapshotSource) as Snapshot
  return [
    ...new Set([...requiredRuntimeResourcePaths(snapshot), ...frontendPaths]),
  ].sort()
}

function embeddedRuntimeAssetError(
  architecture: string,
  missingPaths: readonly string[],
): Error {
  const preview = missingPaths.slice(0, 8).join(', ')
  const suffix =
    missingPaths.length > 8 ? `, and ${missingPaths.length - 8} more` : ''
  return new Error(
    `The ${architecture} executable slice is missing ${missingPaths.length} runtime resource path(s): ${preview}${suffix}`,
  )
}

async function verifyEmbeddedRuntimeAssets(
  executablePath: string,
  requiredPaths: readonly string[],
): Promise<string[]> {
  const architectures = parseMacosArchitectures(
    await run('lipo', ['-archs', executablePath]),
  )
  if (architectures.length === 0)
    throw new Error(
      `Could not determine macOS executable architectures: ${executablePath}`,
    )

  const temporaryDirectory =
    architectures.length > 1
      ? await mkdtemp(join(tmpdir(), 'omg-draft-seer-macos-slice-'))
      : undefined

  try {
    for (const architecture of architectures) {
      const slicePath = temporaryDirectory
        ? join(temporaryDirectory, architecture)
        : executablePath
      if (temporaryDirectory)
        await run('lipo', [
          '-thin',
          architecture,
          executablePath,
          '-output',
          slicePath,
        ])

      const binaryStrings = await run('strings', [slicePath])
      if (containsTestWebDriverBridge(binaryStrings)) {
        throw new Error(
          `The ${architecture} executable slice contains the test-only TAURI_WEBDRIVER_PORT bridge.`,
        )
      }

      const missingPaths = missingEmbeddedRuntimeResources(
        binaryStrings,
        requiredPaths,
      )
      if (missingPaths.length > 0)
        throw embeddedRuntimeAssetError(architecture, missingPaths)
    }
  } finally {
    if (temporaryDirectory)
      await rm(temporaryDirectory, { recursive: true, force: true })
  }

  return architectures
}

export async function verifyMacosBundle(
  options: MacosBundleOptions,
  projectRoot = process.cwd(),
): Promise<{
  appPath: string
  dmgPath?: string
  lipoInfo: string
  runtimeAssetArchitectures?: string[]
}> {
  const appPath = await findUniqueBundleArtifact(
    join(options.bundleDirectory, 'macos'),
    '.app',
    'macOS app',
  )
  const executablePath = join(appPath, 'Contents', 'MacOS', APP_BINARY_NAME)
  await access(executablePath, constants.X_OK)

  const lipoInfo = await run('lipo', ['-info', executablePath])
  if (options.requireArm64) {
    const architectures = parseMacosArchitectures(
      await run('lipo', ['-archs', executablePath]),
    )
    if (!hasOnlyArm64MacosSlice(architectures)) {
      throw new Error(
        `Expected an arm64-only macOS executable, received: ${architectures.join(' ') || lipoInfo}`,
      )
    }
  }

  const dmgPath = options.requireDmg
    ? await findUniqueBundleArtifact(
        join(options.bundleDirectory, 'dmg'),
        '.dmg',
        'DMG',
      )
    : undefined
  const runtimeAssetArchitectures = options.requireRuntimeAssets
    ? await verifyEmbeddedRuntimeAssets(
        executablePath,
        await runtimeResourcePaths(projectRoot),
      )
    : undefined

  return { appPath, dmgPath, lipoInfo, runtimeAssetArchitectures }
}

async function main(): Promise<void> {
  const options = parseMacosBundleOptions(process.argv.slice(2))
  const result = await verifyMacosBundle(options)
  console.log(`Verified macOS app: ${result.appPath}`)
  console.log(result.lipoInfo)
  if (result.runtimeAssetArchitectures) {
    console.log(
      `Verified embedded runtime resources and no test WebDriver bridge for: ${result.runtimeAssetArchitectures.join(', ')}`,
    )
  }
  if (result.dmgPath) console.log(`Verified DMG: ${result.dmgPath}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
