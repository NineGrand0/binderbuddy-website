const WORKFLOW_URL =
  'https://serverless.roboflow.com/jack-firmin/workflows/binder-card-edges-vbinder-card-edges-2-rfdetr-seg-small-t1-logic'

/** Output name from the saved workflow definition. */
const OUTPUT_NAME = 'predictions'

const TIMEOUT_MS = 90_000
const MAX_ATTEMPTS = 3

export class BinderCardEdgesError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'BinderCardEdgesError'
    this.status = status
  }
}

export interface CardEdgePrediction {
  x: number
  y: number
  width: number
  height: number
  confidence: number
  class: string
  class_id: number
  detection_id: string
}

export interface BinderCardEdgesResult {
  image: { width: number; height: number }
  predictions: CardEdgePrediction[]
}

export interface BinderCardEdgesImage {
  type: 'url' | 'base64'
  value: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new BinderCardEdgesError(`A card prediction was missing ${key}.`)
  }
  return value
}

function readPrediction(value: unknown): CardEdgePrediction {
  if (!isRecord(value)) throw new BinderCardEdgesError('A card prediction was not an object.')
  return {
    x: numberField(value, 'x'),
    y: numberField(value, 'y'),
    width: numberField(value, 'width'),
    height: numberField(value, 'height'),
    confidence: numberField(value, 'confidence'),
    class: typeof value.class === 'string' ? value.class : '',
    class_id: numberField(value, 'class_id'),
    detection_id: typeof value.detection_id === 'string' ? value.detection_id : '',
  }
}

function workflowEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (isRecord(payload) && Array.isArray(payload.outputs)) return payload.outputs
  throw new BinderCardEdgesError('Binder card edge detection returned an unexpected response.')
}

export function parseBinderCardEdges(payload: unknown): BinderCardEdgesResult {
  const entries = workflowEntries(payload)
  if (entries.length === 0 || !isRecord(entries[0])) {
    throw new BinderCardEdgesError('Binder card edge detection returned an unexpected response.')
  }
  const output = entries[0][OUTPUT_NAME]
  if (!isRecord(output)) {
    throw new BinderCardEdgesError('Binder card edge detection did not return predictions.')
  }
  const image = output.image
  const rawPredictions = output.predictions
  if (!isRecord(image) || typeof image.width !== 'number' || typeof image.height !== 'number') {
    throw new BinderCardEdgesError('Binder card edge detection did not return an image size.')
  }
  if (!Array.isArray(rawPredictions)) {
    throw new BinderCardEdgesError('Binder card edge detection did not return a prediction list.')
  }
  return {
    image: { width: image.width, height: image.height },
    predictions: rawPredictions.map(readPrediction),
  }
}

function errorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string }
    if (parsed.message) return parsed.message
    if (parsed.error) return parsed.error
  } catch {
    if (body && body.length < 240 && !body.includes('base64')) return body
  }
  return `Binder card edge detection failed (${status}).`
}

function retryable(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runBinderCardEdgesWorkflow(input: {
  apiKey: string
  image: BinderCardEdgesImage
}): Promise<BinderCardEdgesResult> {
  if (!input.apiKey) {
    throw new BinderCardEdgesError('Roboflow is not configured. Add ROBOFLOW_API_KEY on the server.')
  }
  if (input.image.type === 'url' && !input.image.value.startsWith('https://')) {
    throw new BinderCardEdgesError('Workflow image URLs must use https.')
  }
  if (!input.image.value) {
    throw new BinderCardEdgesError('Missing image.')
  }

  const body = JSON.stringify({
    inputs: {
      image: { type: input.image.type, value: input.image.value },
    },
  })

  let lastError = new BinderCardEdgesError('Binder card edge detection failed.')
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(WORKFLOW_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        const text = await response.text()
        lastError = new BinderCardEdgesError(errorMessage(text, response.status), response.status)
        if (!retryable(response.status) || attempt === MAX_ATTEMPTS) throw lastError
      } else {
        return parseBinderCardEdges(await response.json())
      }
    } catch (err) {
      if (err instanceof BinderCardEdgesError) {
        lastError = err
        if (!retryable(err.status) || attempt === MAX_ATTEMPTS) throw err
      } else {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
        lastError = new BinderCardEdgesError(
          timedOut ? 'Binder card edge detection timed out.' : 'Binder card edge detection failed.',
        )
        if (attempt === MAX_ATTEMPTS) throw lastError
      }
    }
    await sleep(400 * attempt)
  }
  throw lastError
}
