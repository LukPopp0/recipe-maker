// Pluggable object-storage interface per docs/specs/06, mirroring the RecipeRepository
// pattern so a cloud-backed implementation can replace LocalDiskStorageAdapter
// later without touching callers.
export type StoredObject = {
  key: string
  sizeBytes: number
  modifiedAt: Date
}

export interface StorageAdapter {
  // Writes fileBuffer under key and returns the publicly reachable URL for it.
  put(fileBuffer: Buffer, key: string, contentType: string): Promise<string>
  // Reads back the bytes stored at key. Throws AppError('INTERNAL_ERROR', ...)
  // if key does not exist.
  get(key: string): Promise<Buffer>
  // Removes the object at key. Idempotent: does not throw if key is missing.
  delete(key: string): Promise<void>
  // Every object whose key starts with prefix ("recipes/"), for the admin
  // unused-image cleanup. Returns [] when nothing is stored under prefix.
  list(prefix: string): Promise<StoredObject[]>
}
