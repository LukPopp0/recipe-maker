import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { AppError } from '../../lib/errors.js'
import { parseManualUploadBody, type ParsedManualUpload } from './manual-upload-parser.js'

// Builds a throwaway Hono app that exposes parseManualUploadBody as a route
// handler, so we exercise real multipart parsing via Hono's own parseBody
// rather than mocking Hono internals.
function buildTestApp() {
  const app = new Hono()
  app.post('/x', async (c) => {
    const parsed = await parseManualUploadBody(c)
    return c.json(serializeForAssertions(parsed))
  })
  return app
}

// FormData Files aren't JSON-serializable, so summarize them for the test's
// JSON response assertions.
function serializeForAssertions(parsed: ParsedManualUpload) {
  return {
    ingredientsText: parsed.ingredientsText,
    stepsText: parsed.stepsText,
    mainImage: { filename: parsed.mainImage.filename, contentType: parsed.mainImage.contentType },
    stepImages: parsed.stepImages.map((f) => ({ filename: f.filename, contentType: f.contentType })),
  }
}

function makeFile(name: string, contents = 'fake-image-bytes') {
  return new File([contents], name, { type: 'image/png' })
}

async function postFormData(app: Hono, formData: FormData) {
  const request = new Request('http://x/x', { method: 'POST', body: formData })
  return app.request(request)
}

type SerializedUpload = ReturnType<typeof serializeForAssertions>

async function postFormDataForBody(app: Hono, formData: FormData): Promise<SerializedUpload> {
  const response = await postFormData(app, formData)
  return (await response.json()) as SerializedUpload
}

describe('parseManualUploadBody', () => {
  it('throws INVALID_INPUT when ingredientsText is missing', async () => {
    const app = buildTestApp()
    const formData = new FormData()
    formData.set('stepsText', 'Step one.')
    formData.set('mainImage', makeFile('main.png'))

    const response = await postFormData(app, formData)

    expect(response.status).toBe(500)
  })

  it('throws INVALID_INPUT when mainImage is missing', async () => {
    let caughtError: unknown
    const app = new Hono()
    app.post('/x', async (c) => {
      try {
        return c.json(serializeForAssertions(await parseManualUploadBody(c)))
      } catch (err) {
        caughtError = err
        throw err
      }
    })

    const formData = new FormData()
    formData.set('ingredientsText', '2 eggs')
    formData.set('stepsText', 'Step one.')

    await postFormData(app, formData)

    expect(caughtError).toBeInstanceOf(AppError)
    expect((caughtError as AppError).code).toBe('INVALID_INPUT')
    expect((caughtError as AppError).message).toBe('mainImage is required.')
  })

  it('rejects a missing ingredientsText with the correct message', async () => {
    let caughtError: unknown
    const app = new Hono()
    app.post('/x', async (c) => {
      try {
        return c.json(serializeForAssertions(await parseManualUploadBody(c)))
      } catch (err) {
        caughtError = err
        throw err
      }
    })

    const formData = new FormData()
    formData.set('stepsText', 'Step one.')
    formData.set('mainImage', makeFile('main.png'))

    await postFormData(app, formData)

    expect(caughtError).toBeInstanceOf(AppError)
    expect((caughtError as AppError).code).toBe('INVALID_INPUT')
    expect((caughtError as AppError).message).toBe('ingredientsText is required.')
  })

  it('returns a single-element stepImages array when only one step image is uploaded', async () => {
    const app = buildTestApp()
    const formData = new FormData()
    formData.set('ingredientsText', '2 eggs')
    formData.set('stepsText', 'Step one.')
    formData.set('mainImage', makeFile('main.png'))
    formData.append('stepImages', makeFile('step-1.png'))

    const body = await postFormDataForBody(app, formData)

    expect(body.stepImages).toHaveLength(1)
    expect(body.stepImages[0].filename).toBe('step-1.png')
  })

  it('returns all step images when three are uploaded', async () => {
    const app = buildTestApp()
    const formData = new FormData()
    formData.set('ingredientsText', '2 eggs')
    formData.set('stepsText', 'Step one.')
    formData.set('mainImage', makeFile('main.png'))
    formData.append('stepImages', makeFile('step-1.png'))
    formData.append('stepImages', makeFile('step-2.png'))
    formData.append('stepImages', makeFile('step-3.png'))

    const body = await postFormDataForBody(app, formData)

    expect(body.stepImages).toHaveLength(3)
    expect(body.stepImages.map((f: { filename: string }) => f.filename)).toEqual([
      'step-1.png',
      'step-2.png',
      'step-3.png',
    ])
  })

  it('normalizes \\r\\n newlines to \\n in ingredientsText', async () => {
    const app = buildTestApp()
    const formData = new FormData()
    formData.set('ingredientsText', '  2 eggs\r\n1 cup flour\r\n  ')
    formData.set('stepsText', 'Step one.')
    formData.set('mainImage', makeFile('main.png'))

    const body = await postFormDataForBody(app, formData)

    expect(body.ingredientsText).toBe('2 eggs\n1 cup flour')
  })
})
