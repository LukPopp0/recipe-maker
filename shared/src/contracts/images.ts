// One stored image no saved recipe references, as listed for the admin
// cleanup (deployment spec section 8).
export type UnusedImage = {
  key: string
  url: string
  sizeBytes: number
  modifiedAt: string
}

// Where an image sits in a recipe: the main image or a step (index 0-5).
export type ImageSlot = 'main' | number

// A remote image that could not be re-hosted. `warning` is the exact string
// added to the response warnings for that image.
export type UnhostedImage = {
  slot: ImageSlot
  url: string
  warning: string
}
