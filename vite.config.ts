import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { BinderCardEdgesError, runBinderCardEdgesWorkflow } from './server/binderCardEdges.ts'
import {
  JustTcgError,
  fetchJustTcgPrices,
  resolveJustTcgCard,
  type JustTcgCondition,
} from './server/justtcg.ts'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const CONDITIONS = new Set(['NM', 'LP', 'MP', 'HP', 'Damaged'])

function isCondition(value: unknown): value is JustTcgCondition {
  return typeof value === 'string' && CONDITIONS.has(value)
}

function roboflowDetectPlugin(): Plugin {
  return {
    name: 'roboflow-detect',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/api/detect') return next()
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Use POST /api/detect.' })
          return
        }
        const env = loadEnv(server.config.mode, process.cwd(), '')
        const key = env.ROBOFLOW_API_KEY
        if (!key) {
          sendJson(res, 503, {
            error: 'Roboflow is not configured. Add ROBOFLOW_API_KEY on the server.',
          })
          return
        }
        try {
          const raw = await readBody(req)
          const payload = JSON.parse(raw) as { image?: string }
          const image = payload.image?.replace(/^data:image\/\w+;base64,/, '')
          if (!image) {
            sendJson(res, 400, { error: 'Missing image.' })
            return
          }
          const result = await runBinderCardEdgesWorkflow({
            apiKey: key,
            image: { type: 'base64', value: image },
          })
          sendJson(res, 200, {
            predictions: result.predictions,
            note: 'Boxes came from Binder Card Edges. Check each outline before you save.',
          })
        } catch (err) {
          const status = err instanceof BinderCardEdgesError && err.status ? err.status : 500
          const message = err instanceof Error ? err.message : 'Card detection failed.'
          sendJson(res, status >= 400 && status < 600 ? status : 500, { error: message })
        }
      })
    },
  }
}

function justTcgPlugin(): Plugin {
  return {
    name: 'justtcg-pricing',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/api/justtcg/resolve' && url !== '/api/justtcg/prices') return next()
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `Use POST ${url}.` })
          return
        }

        const env = loadEnv(server.config.mode, process.cwd(), '')
        const key = env.JUSTTCG_API_KEY
        if (!key) {
          sendJson(res, 503, {
            error: 'JustTCG is not configured. Add JUSTTCG_API_KEY to .env.local and restart the dev server.',
          })
          return
        }

        try {
          const raw = await readBody(req)
          const payload = JSON.parse(raw) as Record<string, unknown>

          if (url === '/api/justtcg/resolve') {
            const condition = payload.condition
            if (!isCondition(condition)) {
              sendJson(res, 400, { error: 'condition must be NM, LP, MP, HP, or Damaged.' })
              return
            }
            const result = await resolveJustTcgCard({
              apiKey: key,
              name: String(payload.name ?? ''),
              set: String(payload.set ?? ''),
              number: String(payload.number ?? ''),
              condition,
              printing: typeof payload.printing === 'string' ? payload.printing : undefined,
            })
            sendJson(res, 200, result)
            return
          }

          const itemsRaw = Array.isArray(payload.items) ? payload.items : []
          const items = itemsRaw
            .map((item) => {
              if (!item || typeof item !== 'object') return null
              const row = item as { justtcgVariantId?: unknown; condition?: unknown }
              if (typeof row.justtcgVariantId !== 'string' || !isCondition(row.condition)) return null
              return { justtcgVariantId: row.justtcgVariantId, condition: row.condition }
            })
            .filter((item): item is { justtcgVariantId: string; condition: JustTcgCondition } => Boolean(item))

          if (items.length === 0) {
            sendJson(res, 400, { error: 'items must include justtcgVariantId and condition.' })
            return
          }

          const results = await fetchJustTcgPrices({
            apiKey: key,
            items,
            force: Boolean(payload.force),
          })
          sendJson(res, 200, { results })
        } catch (err) {
          const status = err instanceof JustTcgError ? err.status : 500
          const message = err instanceof Error ? err.message : 'JustTCG request failed.'
          sendJson(res, status >= 400 && status < 600 ? status : 500, { error: message })
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), roboflowDetectPlugin(), justTcgPlugin()],
  server: {
    // Scratch/debug output — Windows file locks there crash the watcher (EBUSY)
    watch: { ignored: ['**/.cache/**'] },
  },
})
