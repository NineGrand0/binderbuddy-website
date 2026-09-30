import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import { BinderCardEdgesError, runBinderCardEdgesWorkflow } from './server/binderCardEdges.ts'
import { CardImageError, getCardImage, isAllowedCardImageUrl, isCardImageSize } from './server/cardImages.ts'
import {
  JustTcgError,
  fetchJustTcgPrices,
  resolveJustTcgCard,
  type JustTcgCondition,
} from './server/justtcg.ts'
import { ShareSnapshotError } from './server/shareSchema.ts'
import {
  ShareError,
  createShare,
  deleteShare,
  getSharedBinder,
  regenerateShareToken,
  updateShare,
} from './server/shares.ts'

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
              externalId: typeof payload.externalId === 'string' ? payload.externalId : undefined,
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

function cardImagePlugin(): Plugin {
  return {
    name: 'card-image',
    configureServer(server) {
      server.middlewares.use('/api/card-image', async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams
        const id = params.get('id') || undefined
        const src = params.get('src') || undefined
        const size = params.get('size') ?? 'large'
        if (!isCardImageSize(size)) {
          sendJson(res, 400, { error: 'size must be large or small.' })
          return
        }
        try {
          const image = await getCardImage({ id, src, size })
          res.statusCode = 200
          res.setHeader('Content-Type', 'image/webp')
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          res.setHeader('X-Card-Image-Source', image.source)
          res.end(req.method === 'HEAD' ? undefined : image.body)
        } catch (err) {
          // Let the browser load the original rather than show a broken card
          if (src && isAllowedCardImageUrl(src)) {
            res.statusCode = 302
            res.setHeader('Location', src)
            res.end()
            return
          }
          const status = err instanceof CardImageError ? err.status : 500
          sendJson(res, status, { error: err instanceof Error ? err.message : 'Card image failed.' })
        }
      })
    },
  }
}

const MAX_SHARE_BODY_BYTES = 40 * 1024 * 1024

class BodyTooLargeError extends Error {}

function readLimitedBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new BodyTooLargeError('Binder is too large to share.'))
        req.destroy()
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function bearerKey(req: IncomingMessage): string {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function privateHeaders(res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  res.setHeader('Referrer-Policy', 'no-referrer')
}

function installShareRoutes(middlewares: Connect.Server) {
  // Guest pages: keep them out of search results and don't leak the token via Referer
  middlewares.use((req, res, next) => {
    if (req.url?.startsWith('/s/')) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
      res.setHeader('Referrer-Policy', 'no-referrer')
    }
    next()
  })

  middlewares.use('/api/shared', async (req, res) => {
    privateHeaders(res)
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }
    const token = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\//, ''))
    try {
      const shared = await getSharedBinder(token)
      if (!shared) {
        sendJson(res, 404, { error: 'This binder is no longer available.' })
        return
      }
      sendJson(res, 200, shared)
    } catch {
      sendJson(res, 500, { error: 'Could not load this binder.' })
    }
  })

  middlewares.use('/api/shares', async (req, res) => {
    privateHeaders(res)
    const [shareId = '', action = ''] = (req.url ?? '/').split('?')[0].split('/').filter(Boolean)
    try {
      if (!shareId && req.method === 'POST') {
        const body = JSON.parse(await readLimitedBody(req, MAX_SHARE_BODY_BYTES)) as { snapshot?: unknown }
        sendJson(res, 201, await createShare(body.snapshot))
        return
      }
      if (shareId && !action && req.method === 'PUT') {
        const body = JSON.parse(await readLimitedBody(req, MAX_SHARE_BODY_BYTES)) as { snapshot?: unknown }
        sendJson(res, 200, await updateShare(shareId, bearerKey(req), body.snapshot))
        return
      }
      if (shareId && action === 'regenerate' && req.method === 'POST') {
        sendJson(res, 200, await regenerateShareToken(shareId, bearerKey(req)))
        return
      }
      if (shareId && !action && req.method === 'DELETE') {
        await deleteShare(shareId, bearerKey(req))
        res.statusCode = 204
        res.end()
        return
      }
      sendJson(res, 405, { error: 'Method not allowed' })
    } catch (err) {
      if (err instanceof ShareError) {
        sendJson(res, err.status, { error: err.message })
      } else if (err instanceof ShareSnapshotError || err instanceof SyntaxError) {
        sendJson(res, 400, { error: err.message })
      } else if (err instanceof BodyTooLargeError) {
        sendJson(res, 413, { error: err.message })
      } else {
        sendJson(res, 500, { error: 'Sharing failed.' })
      }
    }
  })
}

function sharePlugin(): Plugin {
  return {
    name: 'binder-shares',
    configureServer(server) {
      installShareRoutes(server.middlewares)
    },
    configurePreviewServer(server) {
      installShareRoutes(server.middlewares)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), roboflowDetectPlugin(), justTcgPlugin(), cardImagePlugin(), sharePlugin()],
  server: {
    // Preview tooling assigns a free port via PORT; plain `npm run dev` keeps 5173
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    // Scratch/debug output — Windows file locks there crash the watcher (EBUSY)
    watch: { ignored: ['**/.cache/**', '**/.data/**'] },
  },
})
