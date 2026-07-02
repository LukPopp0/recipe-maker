import { describe, expect, it } from 'vitest'
import { AppError, ERROR_STATUS_MAP, serializeError } from './errors.js'

describe('ERROR_STATUS_MAP', () => {
  it('maps every error code to its spec-defined HTTP status', () => {
    expect(ERROR_STATUS_MAP.INVALID_INPUT).toBe(400)
    expect(ERROR_STATUS_MAP.INVALID_URL).toBe(400)
    expect(ERROR_STATUS_MAP.URL_FETCH_TIMEOUT).toBe(504)
    expect(ERROR_STATUS_MAP.URL_EXTRACTION_FAILED).toBe(422)
    expect(ERROR_STATUS_MAP.AI_NORMALIZATION_FAILED).toBe(502)
    expect(ERROR_STATUS_MAP.SCHEMA_VALIDATION_FAILED).toBe(422)
    expect(ERROR_STATUS_MAP.IMAGE_DOWNLOAD_FAILED).toBe(502)
    expect(ERROR_STATUS_MAP.RECIPE_NOT_FOUND).toBe(404)
    expect(ERROR_STATUS_MAP.INTERNAL_ERROR).toBe(500)
    expect(ERROR_STATUS_MAP.NOT_IMPLEMENTED).toBe(501)
    expect(ERROR_STATUS_MAP.ROUTE_NOT_FOUND).toBe(404)
  })
})

describe('AppError', () => {
  it('round-trips code, message, and details, and exposes the mapped status', () => {
    const err = new AppError('RECIPE_NOT_FOUND', 'Recipe abc123 not found', { id: 'abc123' })

    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('RECIPE_NOT_FOUND')
    expect(err.message).toBe('Recipe abc123 not found')
    expect(err.details).toEqual({ id: 'abc123' })
    expect(err.status).toBe(404)
  })

  it('defaults details to undefined when not provided', () => {
    const err = new AppError('INVALID_INPUT', 'bad input')

    expect(err.details).toBeUndefined()
    expect(err.status).toBe(400)
  })
})

describe('serializeError', () => {
  it('passes through an AppError as its code, message, and details', () => {
    const err = new AppError('SCHEMA_VALIDATION_FAILED', 'Recipe failed validation', { path: 'steps.0' })

    const result = serializeError(err)

    expect(result).toEqual({
      code: 'SCHEMA_VALIDATION_FAILED',
      message: 'Recipe failed validation',
      details: { path: 'steps.0' },
    })
  })

  it('collapses an unknown Error to INTERNAL_ERROR without leaking its message', () => {
    const err = new Error('leaked db connection string: postgres://user:pass@host/db')

    const result = serializeError(err)

    expect(result.code).toBe('INTERNAL_ERROR')
    expect(result.message).not.toContain('postgres://')
    expect(result.message).not.toContain('leaked db connection string')
  })

  it('collapses a thrown non-Error value to INTERNAL_ERROR without leaking it', () => {
    const result = serializeError('some secret string thrown directly')

    expect(result.code).toBe('INTERNAL_ERROR')
    expect(result.message).not.toContain('some secret string')
  })

  it('collapses a thrown object to INTERNAL_ERROR without leaking its fields', () => {
    const result = serializeError({ apiKey: 'sk-secret-123' })

    expect(result.code).toBe('INTERNAL_ERROR')
    expect(result.message).not.toContain('sk-secret-123')
  })
})
