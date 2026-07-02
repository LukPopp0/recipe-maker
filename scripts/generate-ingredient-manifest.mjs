import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIngredientManifest } from './lib/build-ingredient-manifest.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE_DIR = resolve(__dirname, '../shared/assets/ingredients')
const OUTPUT_FILE = resolve(__dirname, '../shared/src/generated/ingredient-manifest.json')

const manifest = await buildIngredientManifest(SOURCE_DIR)
await mkdir(dirname(OUTPUT_FILE), { recursive: true })
await writeFile(OUTPUT_FILE, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Wrote ${manifest.length} ingredient assets to ${OUTPUT_FILE}`)
