import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadServerEnv } from './env.js'

describe('loadServerEnv', () => {
  it('applies defaults when no env vars are set', () => {
    const env = loadServerEnv({})

    expect(env.PORT).toBe(8787)
    expect(env.NODE_ENV).toBe('development')
    expect(env.RECIPE_DATA_DIR).toBe(path.resolve('./data/recipes'))
    expect(env.DEFAULT_MAIN_IMAGE_URL).toBeUndefined()
  })

  it('parses and resolves provided values', () => {
    const env = loadServerEnv({
      PORT: '4000',
      NODE_ENV: 'production',
      RECIPE_DATA_DIR: './tmp/recipes',
      DEFAULT_MAIN_IMAGE_URL: 'https://example.com/default.png',
    })

    expect(env.PORT).toBe(4000)
    expect(env.NODE_ENV).toBe('production')
    expect(env.RECIPE_DATA_DIR).toBe(path.resolve('./tmp/recipes'))
    expect(env.DEFAULT_MAIN_IMAGE_URL).toBe('https://example.com/default.png')
  })

  it('resolves an already-absolute RECIPE_DATA_DIR unchanged', () => {
    const absolute = path.resolve('/var/data/recipes')
    const env = loadServerEnv({ RECIPE_DATA_DIR: absolute })

    expect(env.RECIPE_DATA_DIR).toBe(absolute)
  })

  it('throws descriptively on an invalid NODE_ENV', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/)
  })

  it('throws descriptively on a non-numeric PORT', () => {
    expect(() => loadServerEnv({ PORT: 'not-a-number' })).toThrow(/PORT/)
  })
})
