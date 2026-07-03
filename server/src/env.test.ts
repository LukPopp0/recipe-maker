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
    expect(env.URL_FETCH_TIMEOUT_MS).toBe(8000)
    expect(env.URL_MAX_REDIRECTS).toBe(3)
    expect(env.URL_MAX_RESPONSE_BYTES).toBe(5_000_000)
    expect(env.IMAGE_DATA_DIR).toBe(path.resolve('./data/images'))
    expect(env.IMAGE_MAX_BYTES).toBe(8_000_000)
    expect(env.MANUAL_REQUEST_MAX_BYTES).toBe(20_000_000)
    expect(env.PUBLIC_BASE_URL).toBe('http://localhost:8787')
  })

  it('derives PUBLIC_BASE_URL default from a non-default PORT', () => {
    const env = loadServerEnv({ PORT: '4000' })

    expect(env.PUBLIC_BASE_URL).toBe('http://localhost:4000')
  })

  it('parses and resolves provided values', () => {
    const env = loadServerEnv({
      PORT: '4000',
      NODE_ENV: 'production',
      RECIPE_DATA_DIR: './tmp/recipes',
      DEFAULT_MAIN_IMAGE_URL: 'https://example.com/default.png',
      URL_FETCH_TIMEOUT_MS: '15000',
      URL_MAX_REDIRECTS: '5',
      URL_MAX_RESPONSE_BYTES: '1000000',
      IMAGE_DATA_DIR: './tmp/images',
      IMAGE_MAX_BYTES: '2000000',
      MANUAL_REQUEST_MAX_BYTES: '3000000',
      PUBLIC_BASE_URL: 'https://recipes.example.com',
    })

    expect(env.PORT).toBe(4000)
    expect(env.NODE_ENV).toBe('production')
    expect(env.RECIPE_DATA_DIR).toBe(path.resolve('./tmp/recipes'))
    expect(env.DEFAULT_MAIN_IMAGE_URL).toBe('https://example.com/default.png')
    expect(env.URL_FETCH_TIMEOUT_MS).toBe(15000)
    expect(env.URL_MAX_REDIRECTS).toBe(5)
    expect(env.URL_MAX_RESPONSE_BYTES).toBe(1000000)
    expect(env.IMAGE_DATA_DIR).toBe(path.resolve('./tmp/images'))
    expect(env.IMAGE_MAX_BYTES).toBe(2000000)
    expect(env.MANUAL_REQUEST_MAX_BYTES).toBe(3000000)
    expect(env.PUBLIC_BASE_URL).toBe('https://recipes.example.com')
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
