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
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { buildGraph, graphModuleNames } from './graph.ts'
import { provideSchematic } from './service.ts'
import { translateBatch, HttpError } from './llm.ts'
import { send, sendJson, readJsonBody } from './http.ts'
import { applyActivity } from './activity/index.ts'
import { journalRows } from './activity/replay.ts'
import { normalizeEditConfig } from './compose/config.ts'
import { handleComposeGet, handleComposePost, type ComposeDeps, type UpdateFailure } from './compose/routes.ts'

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

// The harness's hmr plugin declares this event in its own module augmentation;
// out-of-tree, we declare the slice we consume with the same signature.
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A watched patch-file refresh failed; the previous plugin tree stays.
     * @param filename - Absolute path observed by HMR.
     * @param error - Normalized refresh failure.
     * @mode parallel
     */
    'hmr/config-update-failed'(filename: string, error: Error): Promise<void> | void
  }
}

/** Body limits for one translate-batch request. */
const MAX_BATCH_ITEMS = 200
const MAX_BATCH_ITEM_CHARS = 2_000

/** Structural slice of the apiProxy service's history read (out-of-tree: no type import). */
interface ApiProxyHistorySlice {
  sessions: {
    history(request: {
      rpcId: string
      payload: { sessionId: string; beforeSeq?: number; maxMessages?: number }
    }): Promise<{
      result:
        | { ok: true; value: { events: { event: { type: string; seq: number; time: number; data: unknown } }[]; hasMore: boolean } }
        | { ok: false; error: { message?: string } }
    }>
  }
}

/** History page size in messages; the viewer's 加载更早 pages walk backwards from here. */
const HISTORY_PAGE_MESSAGES = 25
let historyRpcCounter = 0

/**
 * GET /schematic/history?session=&beforeSeq=&maxMessages= — one replayed
 * timeline page: durable session events re-attributed through the live fold,
 * merged with the journal's live-only workflow rows for the same window. The
 * session read rides the host's own session.history RPC (read-only; the
 * endpoint is the server-side twin of the SPA's own history fetch).
 */
async function handleHistory(
  ctx: Context,
  activity: ReturnType<typeof applyActivity>,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  const session = url.searchParams.get('session') ?? ''
  if (!/^[\w-]+$/.test(session)) throw new HttpError(400, 'session 参数不合法')
  const beforeRaw = url.searchParams.get('beforeSeq')
  const beforeSeq = beforeRaw !== null && beforeRaw !== ''
    && Number.isSafeInteger(Number(beforeRaw)) && Number(beforeRaw) >= 0
    ? Number(beforeRaw)
    : undefined
  const maxRaw = Number(url.searchParams.get('maxMessages') ?? '')
  const maxMessages = Number.isSafeInteger(maxRaw) && maxRaw > 0 && maxRaw <= 100 ? maxRaw : HISTORY_PAGE_MESSAGES
  // reflect.get: a functional read of a host service, same as the SPA's own
  // /api/session.history calls — not a plugin dependency the graph should edge.
  const reflect = ctx.reflect as unknown as { get(name: string): unknown }
  const api = reflect.get('apiProxy') as ApiProxyHistorySlice | undefined
  if (api === undefined) throw new HttpError(503, '此部署没有 apiProxy 服务,无法读取会话历史')
  const response = await api.sessions.history({
    rpcId: `schematic-history-${historyRpcCounter++}`,
    payload: { sessionId: session, beforeSeq, maxMessages },
  })
  if (!response.result.ok) {
    throw new HttpError(502, `会话历史读取失败:${response.result.error.message ?? 'unknown'}`)
  }
  // Resolve tool owners against the graph as mounted NOW: the boot-time
  // snapshot predates late-mounting tool plugins, and a replay read can be
  // the first request after boot with no /graph.json poll in between.
  // Same mapping noteModules applies on the /graph.json path: module strings,
  // never the node objects themselves.
  activity.noteGraphModules(graphModuleNames(ctx))
  const events = response.result.value.events.map((entry) => entry.event)
  const rows = activity.collector.replayRows(events)
  if (events.length > 0 && activity.journalDir !== null) {
    let minTime = Infinity
    let maxTime = -Infinity
    for (const event of events) {
      if (event.time < minTime) minTime = event.time
      if (event.time > maxTime) maxTime = event.time
    }
    rows.push(...journalRows(activity.journalDir, session, minTime, maxTime))
  }
  rows.sort((a, b) => b.time - a.time)
  let nextBeforeSeq: number | null = null
  for (const event of events) {
    if (nextBeforeSeq === null || event.seq < nextBeforeSeq) nextBeforeSeq = event.seq
  }
  return sendJson(res, 200, { rows, hasMore: response.result.value.hasMore, nextBeforeSeq })
}

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

/** Plugin config as declared in the schematic loader row (`config.edit`). */
export interface SchConfig {
  edit?: unknown
}

export function apply(ctx: Context, config: SchConfig = {}): void {
  const webServer = (ctx as Context & { webServer: WebRouteReg }).webServer
  // Capability, not observation: siblings that inject 'schematic' get the
  // live graph as a service. The disposer is discarded — provide registered
  // it as an effect on our fiber, so HMR/dispose retracts it with us.
  provideSchematic(ctx)
  const html = readFileSync(fileURLToPath(new URL('./web/index.html', import.meta.url)), 'utf8')
  const clientDir = fileURLToPath(new URL('./../dist/', import.meta.url))

  const editConfig = normalizeEditConfig(config.edit)
  // The harness's own hot-reload failure signal, made visible at
  // compose.json.lastError: one entry per watched patch file, newest-last.
  const updateFailures = new Map<string, UpdateFailure>()
  ctx.on('hmr/config-update-failed', (filename: string, error: Error) => {
    updateFailures.set(filename, {
      time: Date.now(),
      filename,
      message: error instanceof Error ? error.message : String(error),
      // Snapshot the bytes the harness refused, so compose.json can retire
      // the banner once different bytes load (no success event exists).
      hash: 'sha256:' + createHash('sha256').update(hashableFileText(filename)).digest('hex'),
    })
  })
  const composeDeps: ComposeDeps = { editConfig, updateFailures }

  const activity = applyActivity(ctx)
  // Tool attribution resolves against the module set the boot prime inside
  // applyActivity populated; drift-log once so unmounted owners are named.
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
          // Every served snapshot also re-syncs the structural baseline: a
          // missed internal/* event costs at most one poll interval.
          activity.noteTopo(graph)
          return send(res, 200, 'application/json', JSON.stringify(graph))
        }
        if (sub === '/mini.json') {
          // Polled by the composer-side miniature: holding an SSE stream per
          // SPA tab would eat one of the browser's per-origin HTTP/1.1
          // connection slots and starve the SPA's own boot RPCs.
          const since = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('since') ?? '0')
          return sendJson(res, 200, activity.collector.miniSnapshot(Number.isFinite(since) ? Math.max(0, since) : 0))
        }
        if (sub === '/history') {
          return await handleHistory(ctx, activity, new URL(req.url ?? '/', 'http://x'), res)
        }
        if (sub === '/stats.json') {
          // Counters grow on every live row, so this is its own endpoint the
          // viewer polls only while the stats view is open — the graph poll's
          // structural-signature gate would freeze growing counters.
          return sendJson(res, 200, activity.collector.statsSnapshot())
        }
        if (sub === '/compose.json') {
          return await handleComposeGet(ctx, res, composeDeps)
        }
        return send(res, 404, 'text/plain', 'not found')
      }
      if (req.method === 'POST' && sub.startsWith('/compose/')) {
        return await handleComposePost(ctx, req, sub, res, composeDeps)
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

/** The file's text for failure-hash snapshotting; '' when it vanished (a hash of nothing matches nothing). */
function hashableFileText(filename: string): string {
  try {
    return readFileSync(filename, 'utf8')
  } catch {
    return ''
  }
}
