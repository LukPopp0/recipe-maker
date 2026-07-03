import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIngredientManifest } from './lib/build-ingredient-manifest.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE_DIR = resolve(__dirname, '../assets/ingredients')
const OUTPUT_DIR = resolve(__dirname, '../src/generated')
const JSON_OUTPUT = resolve(OUTPUT_DIR, 'ingredient-manifest.json')
const TS_OUTPUT = resolve(OUTPUT_DIR, 'ingredient-manifest.ts')

const manifest = await buildIngredientManifest(SOURCE_DIR)
await mkdir(OUTPUT_DIR, { recursive: true })

// Write JSON
await writeFile(JSON_OUTPUT, JSON.stringify(manifest, null, 2) + '\n')

// Write TypeScript
const tsContent = `// Auto-generated: ingredient image manifest from shared/assets/ingredients.
// Do not edit manually - regenerate with: pnpm --filter shared run generate:manifest

export const INGREDIENT_IMAGE_MANIFEST: readonly string[] = [
${manifest.map((entry) => `  '${entry}',`).join('\n')}
];
`
await writeFile(TS_OUTPUT, tsContent)

console.log(`Wrote ${manifest.length} ingredient assets to ${JSON_OUTPUT} and ${TS_OUTPUT}`)
