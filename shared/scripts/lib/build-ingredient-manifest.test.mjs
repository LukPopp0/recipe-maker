import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIngredientManifest } from './build-ingredient-manifest.mjs'

describe('buildIngredientManifest', () => {
  let dir

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ingredient-manifest-'))
    await writeFile(join(dir, 'garlic.png'), '')
    await writeFile(join(dir, 'Onion-Red.JPG'), '')
    await writeFile(join(dir, 'notes.txt'), '')
    await writeFile(join(dir, '.DS_Store'), '')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns only image files, sorted, excluding dotfiles and non-images', async () => {
    const result = await buildIngredientManifest(dir)
    expect(result).toEqual(['garlic.png', 'Onion-Red.JPG'])
  })
})
