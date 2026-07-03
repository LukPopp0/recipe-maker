import type { StorageAdapter } from '../storage/storage-adapter.js'
import { ALLOWED_CONTENT_TYPES } from './image-rehoster.js'

export interface UploadedFile {
  buffer: Buffer
  contentType: string
  filename: string
}

export interface HostUploadedImageOptions {
  recipeId: string
  storageAdapter: StorageAdapter
  maxBytes: number
  kind: 'main' | 'step'
  index: number
}

// Hosts an already-in-memory uploaded image buffer (Option B manual
// ingestion). Never throws: any validation failure (unsupported MIME,
// oversized buffer) returns a { warning } result instead, mirroring
// rehostRecipeImages's non-critical-failure contract from specs/06.
export async function hostUploadedImage(
  file: UploadedFile,
  options: HostUploadedImageOptions,
): Promise<{ url: string } | { warning: string }> {
  const { recipeId, storageAdapter, maxBytes, kind, index } = options

  const ext = ALLOWED_CONTENT_TYPES[file.contentType]
  if (!ext) {
    return {
      warning: `"${file.filename}" was not uploaded: unsupported content type "${file.contentType || 'unknown'}".`,
    }
  }

  if (file.buffer.length > maxBytes) {
    return {
      warning: `"${file.filename}" was not uploaded: exceeded the ${maxBytes}-byte limit.`,
    }
  }

  const key = `recipes/${recipeId}/${kind}-${index}.${ext}`
  const url = await storageAdapter.put(file.buffer, key, file.contentType)

  return { url }
}
