// One stored image no saved recipe references, as listed for the admin
// cleanup (deployment spec section 8).
export type UnusedImage = {
  key: string
  url: string
  sizeBytes: number
  modifiedAt: string
}
