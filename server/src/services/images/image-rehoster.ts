import type { CanonicalRecipe } from 'shared'
import { AppError } from '../../lib/errors.js'
import { readBodyBytesWithLimit, resolveAndCheckHost, validateUrlSyntax } from '../url-ingestion/url-security.js'
import type { StorageAdapter } from '../storage/storage-adapter.js'

// MIME types permitted for re-hosted images per specs/06.
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Default hard timeout for downloading main_image, mirroring the spirit of
// URL_FETCH_TIMEOUT_MS's default (env.ts) for the page fetch. Callers should
// pass env.URL_FETCH_TIMEOUT_MS explicitly where available; this is only the
// fallback when timeoutMs is omitted.
const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 8000

export interface RehostRecipeImagesOptions {
  recipeId: string
  storageAdapter: StorageAdapter
  maxBytes: number
  // main_image is skipped (left untouched, not re-downloaded) when it already
  // equals the configured default image URL - it's already a hosted asset,
  // not a candidate extracted from the source page.
  defaultMainImageUrl?: string
  // Reserved for Phase 3 (manual/Option B ingestion) reuse; Option A never
  // produces step images (specs/04), so Phase 2 callers always pass [].
  stepImages?: string[]
  // Hard timeout (ms) for downloading main_image. Defaults to
  // DEFAULT_IMAGE_FETCH_TIMEOUT_MS if not provided.
  timeoutMs?: number
}

export interface RehostRecipeImagesResult {
  recipe: CanonicalRecipe
  warnings: string[]
}

function isRemoteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

// Downloads recipe.main_image (when it's a remote http(s) URL that isn't
// already the configured default) and re-hosts it via storageAdapter, per
// specs/06's re-hosting rules. Never throws: any failure (bad MIME, oversized,
// network error, blocked/invalid URL, timeout) leaves main_image untouched and
// appends a warning string, so finalSanitize's default-fallback can take over
// downstream.
//
// main_image is attacker-controllable: it's scraped from candidate image URLs
// on the source recipe page and picked by Gemini, so it goes through the same
// SSRF guardrails (validateUrlSyntax + resolveAndCheckHost, per
// url-ingestion/url-security.ts) as the page fetch before ever being
// requested, plus a hard timeout and streaming maxBytes enforcement.
export async function rehostRecipeImages(
  recipe: CanonicalRecipe,
  options: RehostRecipeImagesOptions,
): Promise<RehostRecipeImagesResult> {
  const {
    recipeId,
    storageAdapter,
    maxBytes,
    defaultMainImageUrl,
    timeoutMs = DEFAULT_IMAGE_FETCH_TIMEOUT_MS,
  } = options
  const warnings: string[] = []

  const mainImage = recipe.main_image
  const isDefault = defaultMainImageUrl !== undefined && mainImage === defaultMainImageUrl

  if (!isRemoteHttpUrl(mainImage) || isDefault) {
    return { recipe, warnings }
  }

  let validatedUrl: URL
  try {
    validatedUrl = validateUrlSyntax(mainImage)
    await resolveAndCheckHost(validatedUrl.hostname)
  } catch {
    warnings.push(`Main image was not re-hosted: "${mainImage}" was blocked or invalid.`)
    return { recipe, warnings }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // redirect: 'manual' - a redirect target is not re-validated against the
    // SSRF blocklist, so treat any redirect response as a failure rather than
    // following it (mirrors fetchWithGuardrails re-validating every redirect
    // hop, without reimplementing its full redirect loop for this
    // single-file download).
    const response = await fetch(validatedUrl, {
      redirect: 'manual',
      signal: controller.signal,
    })

    if (!response.ok) {
      warnings.push(`Main image was not re-hosted: request to "${mainImage}" failed with status ${response.status}.`)
      return { recipe, warnings }
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const ext = ALLOWED_CONTENT_TYPES[contentType]
    if (!ext) {
      warnings.push(
        `Main image was not re-hosted: unsupported content type "${contentType || 'unknown'}" for "${mainImage}".`,
      )
      return { recipe, warnings }
    }

    const buffer = await readBodyBytesWithLimit(response, maxBytes, controller)

    const key = `recipes/${recipeId}/main-0.${ext}`
    const hostedUrl = await storageAdapter.put(buffer, key, contentType)

    return { recipe: { ...recipe, main_image: hostedUrl }, warnings }
  } catch (err) {
    if (err instanceof AppError) {
      warnings.push(
        `Main image was not re-hosted: "${mainImage}" exceeded the ${maxBytes}-byte limit.`,
      )
      return { recipe, warnings }
    }
    if (err instanceof Error && err.name === 'AbortError') {
      warnings.push(`Main image was not re-hosted: timed out while downloading "${mainImage}".`)
      return { recipe, warnings }
    }
    const message = err instanceof Error ? err.message : 'unknown error'
    warnings.push(`Main image was not re-hosted: failed to download "${mainImage}" (${message}).`)
    return { recipe, warnings }
  } finally {
    clearTimeout(timer)
  }
}
