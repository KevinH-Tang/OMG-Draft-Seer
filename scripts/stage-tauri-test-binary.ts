import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const releaseBinary = resolve('src-tauri/target/release/omg-draft-seer.exe')
const testBinary = resolve('src-tauri/target/debug/OMG-Draft-Seer.exe')

await mkdir(dirname(testBinary), { recursive: true })
await copyFile(releaseBinary, testBinary)
console.log(`Staged Tauri test binary: ${testBinary}`)
