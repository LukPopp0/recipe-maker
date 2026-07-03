export interface StepImageAssignmentResult {
  stepImageUrls: (string | undefined)[]
  warnings: string[]
}

/**
 * Sorts files by filename using numeric-aware (natural) sort order.
 * Sorting is case-insensitive and handles numeric sequences correctly.
 * For example, 'file2.jpg' sorts before 'file10.jpg'.
 */
export function sortStepImageFilenames<T extends { filename: string }>(files: T[]): T[] {
  const sorted = [...files]
  sorted.sort((a, b) => {
    return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' })
  })
  return sorted
}

/**
 * Assigns hosted step image URLs to a steps array by index.
 * Creates an array of length stepCount where index i contains the corresponding
 * hosted URL if available, or undefined if there are fewer images than steps.
 * Produces a warning if more images were provided than there are steps.
 */
export function assignStepImageUrls(
  hostedStepImageUrls: string[],
  stepCount: number,
): StepImageAssignmentResult {
  const stepImageUrls: (string | undefined)[] = []
  const warnings: string[] = []

  // Assign images by index up to stepCount
  for (let i = 0; i < stepCount; i++) {
    stepImageUrls.push(hostedStepImageUrls[i] ?? undefined)
  }

  // Warn if more images than steps
  if (hostedStepImageUrls.length > stepCount) {
    const ignoredCount = hostedStepImageUrls.length - stepCount
    warnings.push(
      `${ignoredCount} step image(s) were ignored: more images were uploaded than recipe steps.`,
    )
  }

  return { stepImageUrls, warnings }
}
