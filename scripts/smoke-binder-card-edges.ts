import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runBinderCardEdgesWorkflow } from '../server/binderCardEdges.ts'

const SAMPLE_IMAGE = 'https://images.pokemontcg.io/sv3pt5/198.png'

function apiKeyFromFile(): string | undefined {
  try {
    const text = readFileSync(resolve('.env.local'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^ROBOFLOW_API_KEY=(.*)$/)
      if (!match) continue
      return match[1].trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    return undefined
  }
  return undefined
}

const apiKey = process.env.ROBOFLOW_API_KEY || apiKeyFromFile()
if (!apiKey) {
  console.error('Set ROBOFLOW_API_KEY in .env.local before running this smoke test.')
  process.exit(1)
}

const imageResponse = await fetch(SAMPLE_IMAGE)
if (!imageResponse.ok) {
  console.error(`Could not download the sample image (${imageResponse.status}).`)
  process.exit(1)
}
const bytes = Buffer.from(await imageResponse.arrayBuffer())
const result = await runBinderCardEdgesWorkflow({
  apiKey,
  image: { type: 'base64', value: bytes.toString('base64') },
})

const keys = ['x', 'y', 'width', 'height', 'confidence', 'class', 'class_id', 'detection_id'] as const
if (!(result.image.width > 0) || !(result.image.height > 0)) {
  throw new Error('Expected image width and height.')
}
if (!Array.isArray(result.predictions) || result.predictions.length === 0) {
  throw new Error('Expected at least one prediction.')
}
for (const prediction of result.predictions) {
  for (const key of keys) {
    if (prediction[key] === undefined || prediction[key] === null) {
      throw new Error(`Expected prediction key ${key}.`)
    }
  }
}
if (JSON.stringify(result).includes('"points"')) {
  throw new Error('Polygon points were included in the result.')
}

console.log(
  `Binder Card Edges smoke test passed: ${result.predictions.length} cards on a ${result.image.width}x${result.image.height} image.`,
)
