/**
 * dsh-schematic — live plugin-topology viewer for DeepSeek Harness.
 *
 * Host half of the dual-face plugin: mounts into a running dsh process,
 * serves the viewer page and its live data under the /schematic prefix of
 * the harness web server. Data is recomputed per request from the Cordis
 * runtime (registry × reflect × loader) — see graph.ts. LLM-backed
 * translation/explanation endpoints (see llm.ts) degrade to 503 when the
 * host exposes no `llm` service.
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
import { explain, translate, HttpError } from './llm.ts'
import type { ExplainFacts } from './llm.ts'

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

/** Live neighborhood facts for one node, from a fresh snapshot. */
function factsOf(
  graph: ReturnType<typeof buildGraph>,
  id: string,
): ExplainFacts | null {
  const node = graph.nodes.find((n) => n.id === id)
  if (node === undefined) return null
  const byId = new Map(graph.nodes.map((n) => [n.id, n.label]))
  const clusterLabel = node.cluster === undefined
    ? null
    : (graph.clusters.find((c) => c.id === node.cluster)?.label ?? null)
  const provided = new Set(graph.nodes.flatMap((n) => n.provides))
  return {
    id: node.id,
    label: node.label,
    module: node.module,
    state: node.state,
    desc: node.desc,
    cluster: clusterLabel,
    provides: node.provides,
    inject: node.inject,
    dependsOn: graph.edges
      .filter((e) => e.from === id)
      .map((e) => ({ unit: byId.get(e.to) ?? e.to, keys: e.keys })),
    dependedBy: graph.edges
      .filter((e) => e.to === id)
      .map((e) => ({ unit: byId.get(e.from) ?? e.from, keys: e.keys })),
    externalInject: node.inject.filter((k) => !provided.has(k)),
  }
}

async function handleApi(ctx: Context, req: IncomingMessage, sub: string, res: ServerResponse): Promise<void> {
  const body = sub === '/api/translate' || sub === '/api/explain' ? await readJsonBody(req) : null
  if (sub === '/api/translate') {
    const text = (body as { text?: unknown } | null)?.text
    if (typeof text !== 'string' || text.length === 0 || text.length > 4000) {
      throw new HttpError(400, 'text 必须是 1–4000 字符的字符串')
    }
    return sendJson(res, 200, { zh: await translate(ctx, text) })
  }
  if (sub === '/api/explain') {
    const id = (body as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || id.length === 0 || id.length > 300) {
      throw new HttpError(400, 'id 必须是非空字符串')
    }
    const facts = factsOf(buildGraph(ctx), id)
    if (facts === null) throw new HttpError(404, `拓扑中不存在插件 "${id}"`)
    return sendJson(res, 200, { zh: await explain(ctx, facts) })
  }
  send(res, 404, 'text/plain', 'not found')
}

export function apply(ctx: Context): void {
  const webServer = (ctx as Context & { webServer: WebRouteReg }).webServer
  const html = readFileSync(fileURLToPath(new URL('./web/index.html', import.meta.url)), 'utf8')
  const clientDir = fileURLToPath(new URL('./../dist/', import.meta.url))

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const sub = new URL(req.url ?? '/', 'http://x').pathname.slice(PREFIX.length)
    try {
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
          return send(res, 200, 'application/json', JSON.stringify(buildGraph(ctx)))
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
