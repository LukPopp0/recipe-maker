import type { Context } from 'hono'
import { AppError } from '../../lib/errors.js'
import type { UploadedFile } from '../images/upload-image-hoster.js'

export interface ParsedManualUpload {
  ingredientsText: string
  stepsText: string
  mainImage: UploadedFile
  stepImages: UploadedFile[]
}

// Trims leading/trailing whitespace and normalizes CRLF/CR newlines to LF, per
// specs/05's manual-ingestion text-field normalization rule.
function normalizeText(value: string): string {
  return value.trim().replace(/\r\n?/g, '\n')
}

async function toUploadedFile(file: File): Promise<UploadedFile> {
  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
    filename: file.name,
  }
}

// Parses and validates the multipart body of a manual-ingestion request
// (POST /ingest/manual): two text fields (ingredientsText, stepsText), one
// required mainImage file, and zero or more stepImages files. Does not call
// any Gemini/hosting logic - that's the caller's job (Task 7 route wiring).
export async function parseManualUploadBody(c: Context): Promise<ParsedManualUpload> {
  const body = await c.req.parseBody({ all: true })

  const rawIngredientsText = body.ingredientsText
  if (typeof rawIngredientsText !== 'string' || normalizeText(rawIngredientsText) === '') {
    throw new AppError('INVALID_INPUT', 'ingredientsText is required.')
  }

  const rawStepsText = body.stepsText
  if (typeof rawStepsText !== 'string' || normalizeText(rawStepsText) === '') {
    throw new AppError('INVALID_INPUT', 'stepsText is required.')
  }

  const rawMainImage = body.mainImage
  if (!(rawMainImage instanceof File)) {
    throw new AppError('INVALID_INPUT', 'mainImage is required.')
  }

  // Hono's parseBody({ all: true }) returns a bare File (not an array) when
  // only one file is uploaded under a repeated field name - coerce to an
  // array so callers always get a consistent shape.
  const rawStepImages = body.stepImages
  const stepImageFiles = rawStepImages === undefined ? [] : Array.isArray(rawStepImages) ? rawStepImages : [rawStepImages]

  const stepImages = await Promise.all(
    stepImageFiles.filter((entry): entry is File => entry instanceof File).map((file) => toUploadedFile(file)),
  )

  return {
    ingredientsText: normalizeText(rawIngredientsText),
    stepsText: normalizeText(rawStepsText),
    mainImage: await toUploadedFile(rawMainImage),
    stepImages,
  }
}
