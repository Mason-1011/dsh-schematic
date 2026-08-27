/**
 * dsh-schematic — live plugin-topology viewer for DeepSeek Harness.
 *
 * Host half of the dual-face plugin: mounts into a running dsh process,
 * serves the viewer page and its live data under the /schematic prefix of
 * the harness web server. Data is recomputed per request from the Cordis
 * runtime (registry × reflect × loader) — see graph.ts. The whole-page
 * language switch is backed by /api/translate-batch (see llm.ts), which
 * degrades to 503 when the host exposes no `llm` service.
 *
 * Dev mount (source launch, no build):
 *   pnpm dsh web --patch ~/Projects/dsh-schematic/dev.cordis.yml
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { buildGraph } from './graph.ts'
import { translateBatch, HttpError } from './llm.ts'
import { applyActivity } from './activity/index.ts'

export const name = 'dsh-schematic'
export const inject = ['loader', 'webServer']

/** Structural slice of the webServer service (out-of-tree: no type import). */
interface WebRouteReg {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

const PREFIX = '/schematic'
const MAX_BODY_BYTES = 64 * 1024

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json', JSON.stringify(value))
}

/** Read one JSON request body under the size cap. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new HttpError(413, '请求体过大'))
        return
      }
      parts.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8') || 'null'))
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON'))
      }
    })
    req.on('error', (err) => reject(new HttpError(400, `读取请求体失败:${err.message}`)))
  })
}

/** Body limits for one translate-batch request. */
const MAX_BATCH_ITEMS = 200
const MAX_BATCH_ITEM_CHARS = 2_000

async function handleApi(ctx: Context, req: IncomingMessage, sub: string, res: ServerResponse): Promise<void> {
  if (sub !== '/api/translate-batch') {
    send(res, 404, 'text/plain', 'not found')
    return
  }
  const body = await readJsonBody(req)
  const texts = (body as { texts?: unknown } | null)?.texts
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_BATCH_ITEMS
    || texts.some((s) => typeof s !== 'string' || s.length === 0 || s.length > MAX_BATCH_ITEM_CHARS)) {
    throw new HttpError(400, `texts 必须是 1–${MAX_BATCH_ITEMS} 条、每条 1–${MAX_BATCH_ITEM_CHARS} 字符的字符串数组`)
  }
  return sendJson(res, 200, { zh: await translateBatch(ctx, texts) })
}

export function apply(ctx: Context): void {
  const webServer = (ctx as Context & { webServer: WebRouteReg }).webServer
  const html = readFileSync(fileURLToPath(new URL('./web/index.html', import.meta.url)), 'utf8')
  const clientDir = fileURLToPath(new URL('./../dist/', import.meta.url))

  const activity = applyActivity(ctx)
  // Tool attribution resolves against currently mounted modules; refresh on
  // every graph build so HMR-mounted tools re-resolve without a restart.
  const noteModules = (nodes: { module: string | null }[]): void => {
    activity.noteGraphModules(new Set(nodes.flatMap((node) => node.module ?? [])))
  }
  noteModules(buildGraph(ctx).nodes)
  activity.collector.logDrift()

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const sub = new URL(req.url ?? '/', 'http://x').pathname.slice(PREFIX.length)
    try {
      if (sub === '/events') {
        // The SSE layer owns the whole response lifecycle from here on.
        activity.events.handle(req, res)
        return
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (sub === '' || sub === '/') return send(res, 200, 'text/html; charset=utf-8', html)
        if (sub === '/engine.js') {
          try {
            return send(res, 200, 'text/javascript; charset=utf-8',
              readFileSync(join(clientDir, 'engine.js'), 'utf8'))
          } catch {
            return send(res, 404, 'text/plain', 'engine.js not built — run node scripts/build-client.mjs')
          }
        }
        if (sub === '/graph.json') {
          const graph = buildGraph(ctx)
          graph.serviceReads = activity.traffic.snapshot()
          noteModules(graph.nodes)
          return send(res, 200, 'application/json', JSON.stringify(graph))
        }
        return send(res, 404, 'text/plain', 'not found')
      }
      if (req.method === 'POST' && sub.startsWith('/api/')) {
        return await handleApi(ctx, req, sub, res)
      }
      send(res, 405, 'text/plain', 'method not allowed')
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message })
      ctx.logger.warn(err instanceof Error ? err : new Error(String(err)))
      sendJson(res, 500, { error: '服务器内部错误' })
    }
  }

  ctx.effect(() => webServer.register({ kind: 'prefix', path: PREFIX, handler: (req, res) => {
    void handle(req, res)
  } }), 'dsh-schematic: /schematic routes')
}
