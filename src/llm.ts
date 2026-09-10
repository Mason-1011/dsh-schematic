/**
 * LLM-backed feature for the schematic viewer: batched EN→ZH translation of
 * the topology's English descriptions (the whole-page language switch).
 *
 * Calls the running process's own `llm` service (optional — the viewer works
 * without it) through the same discipline as dsh's session-title providers:
 * stream-only generation, assembled with BlockAssembler, frozen options,
 * and a hard deadline. Helpers are loaded from the harness tree by anchored
 * path (this repo has no dependency on @deepseek-ai/dsh-llm; bare names do
 * not resolve from an out-of-tree mount).
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { sendJson, readJsonBody } from './http.ts'

/** HTTP-facing failure: status reaches the route handler, message reaches the page. */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Structural slice of the harness LLM kit (createUserMessage / BlockAssembler / deepFreeze). */
interface LlmKit {
  createUserMessage: (input: unknown) => unknown
  BlockAssembler: new () => {
    push(chunk: unknown): void
    finish: { kind: string; failure?: { message: string; code?: string } }
    blocks(): { type: string; text?: string }[]
  }
  deepFreeze: <T>(value: T) => T
}

/** Structural slice of the llm service (ctx.get('llm'), optional). */
interface LlmService {
  stream(options: unknown): AsyncIterable<unknown>
}

/** Structural slice of the llm service's registry half (same object as LlmService). */
interface LlmRegistry {
  listConfigurableProviders(): { provider: string; displayName: string; settingsNs: string; declared?: boolean }[]
  listModels(provider: string): Promise<readonly { id: string; name: string }[]>
}

/** Structural slice of the credentials service (ctx.get('credentials'), optional). */
interface CredentialsService {
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
  set(ref: string, value: string): Promise<void>
}

/** Structural slice of agentDefaultModel (ctx.get, optional in a profile). */
interface AgentDefaultModel {
  currentSelection(): { provider: string; model: string }
}

/** Reference-only model override for translation (`config.translate`): names a
 * route the harness already knows; the key never lives in plugin config. */
export interface TranslateOverride {
  provider: string
  model: string
}

/**
 * Normalize config.translate: undefined → null (ride the host default);
 * otherwise exactly `{provider, model}` — both non-empty strings, both given
 * or both absent. Fail-loud on unknown keys, the same posture as
 * normalizeEditConfig: a typo'd knob must never silently no-op.
 * @param input - the raw `config.translate` value from the loader row.
 * @returns the override, or null when the host default should be used.
 */
export function normalizeTranslateConfig(input: unknown): TranslateOverride | null {
  if (input === undefined || input === null) return null
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('config.translate 必须是映射对象')
  const section = input as Record<string, unknown>
  for (const key of Object.keys(section)) {
    if (key !== 'provider' && key !== 'model') throw new Error(`config.translate 有未知字段 ${key}`)
  }
  const hasProvider = section.provider !== undefined
  const hasModel = section.model !== undefined
  if (hasProvider !== hasModel) throw new Error('config.translate 的 provider 与 model 必须同时给出或同时缺省')
  if (!hasProvider) return null
  for (const key of ['provider', 'model'] as const) {
    const value = section[key]
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`config.translate.${key} 必须是非空字符串`)
  }
  return { provider: (section.provider as string).trim(), model: (section.model as string).trim() }
}

let kitPromise: Promise<LlmKit | null> | undefined

/** Anchored loader: resolve the harness llm aggregate by name, then by tree layout. */
async function loadKit(): Promise<LlmKit | null> {
  kitPromise ??= (async (): Promise<LlmKit | null> => {
    const bases = [process.cwd(), join(homedir(), '.dsh', 'profiles', 'web')]
    const urls: string[] = []
    for (const base of bases) {
      try {
        urls.push(pathToFileURL(createRequire(join(base, 'x.js')).resolve('@deepseek-ai/dsh-llm')).href)
      } catch { /* not name-resolvable from this base */ }
      for (const rel of ['packages/llm/llm/src/index.ts', 'packages/llm/llm/lib/index.js']) {
        const file = join(base, rel)
        if (existsSync(file)) urls.push(pathToFileURL(file).href)
      }
    }
    for (const url of urls) {
      try {
        const mod = (await import(url)) as unknown as LlmKit
        if (typeof mod.createUserMessage === 'function' && typeof mod.BlockAssembler === 'function') return mod
      } catch { /* candidate unusable — try the next */ }
    }
    return null
  })()
  return kitPromise
}

/** Content-hash memoization so repeated clicks on the same target are free. */
const CACHE_CAP = 256
const cache = new Map<string, string>()

function memo(key: string, produce: () => Promise<string>): Promise<string> {
  const hit = cache.get(key)
  if (hit !== undefined) return Promise.resolve(hit)
  return produce().then((value) => {
    if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string)
    cache.set(key, value)
    return value
  })
}

const hashOf = (kind: string, content: string): string =>
  createHash('sha256').update(`${kind}\0${content}`).digest('hex')

/**
 * One auxiliary stream call: kit + service + route + deadline + assembly.
 * @param ctx - the running process context (llm and agentDefaultModel optional).
 * @param req - user prompt text.
 * @param system - auxiliary system prompt.
 * @param maxTokens - output-token cap.
 * @param timeoutMs - end-to-end deadline.
 * @param override - translation's own model choice (config.translate), or null
 * to ride the host's agent default.
 * @returns joined text blocks of the completed stream.
 */
async function generateText(
  ctx: Context,
  req: string,
  system: string,
  maxTokens: number,
  timeoutMs: number,
  override: TranslateOverride | null,
): Promise<string> {
  const kit = await loadKit()
  if (kit === null) throw new HttpError(503, 'LLM 工具不可用(无法定位 @deepseek-ai/dsh-llm)')
  const llm = (ctx as Context & { get?: (name: string) => unknown }).get?.('llm') as LlmService | undefined
  if (llm === undefined) throw new HttpError(503, 'llm 服务未挂载(宿主没有可用的模型路由)')
  let provider: string
  let model: string
  if (override === null) {
    const defaultModel = (ctx as Context & { get?: (name: string) => unknown })
      .get?.('agentDefaultModel') as AgentDefaultModel | undefined
    if (defaultModel === undefined) throw new HttpError(503, 'agentDefaultModel 服务未挂载')
    ;({ provider, model } = defaultModel.currentSelection())
  } else {
    ;({ provider, model } = override)
  }
  const signal = AbortSignal.timeout(timeoutMs)
  const options = kit.deepFreeze({
    provider,
    model,
    // auxiliary one-shots: no reasoning tokens, or the budget goes to thinking
    reasoningEffort: 'off',
    messages: [kit.createUserMessage({
      content: [{ type: 'text', text: req }],
      source: { kind: 'plugin', plugin: 'dsh-schematic' },
    })],
    system,
    maxTokens,
    signal,
  })
  const assembler = new kit.BlockAssembler()
  for await (const chunk of llm.stream(options)) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  switch (assembler.finish.kind) {
    case 'stop':
      break
    case 'error':
    case 'aborted':
      throw new HttpError(502, `模型调用失败:${assembler.finish.failure?.message ?? assembler.finish.kind}`)
    case 'max-tokens':
      throw new HttpError(502, `输出超过 maxTokens(${maxTokens})被截断`)
    default:
      throw new HttpError(502, `不支持的结束状态 "${assembler.finish.kind}"`)
  }
  const blocks = assembler.blocks()
  if (blocks.some((block) => block.type === 'tool-call')) {
    throw new HttpError(502, '辅助调用不允许请求工具')
  }
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join(' ')
    .trim()
  if (text.length === 0) throw new HttpError(502, '模型没有返回文本')
  return text
}

const TRANSLATE_SYSTEM = [
  'Translate the following English text into Simplified Chinese.',
  'The text documents a plugin in a software agent harness: read "seam", "provider", "inject" as software-architecture terms, never their everyday senses.',
  'Keep package names, plugin names, and ctx key names (like `tools`, `llm`) unchanged in English.',
  'Output only the translation as one plain-text paragraph, with no quotes, no Markdown, and no explanations.',
].join('\n')

const BATCH_SYSTEM = [
  'Translate each numbered line of English text into Simplified Chinese.',
  'The texts document plugins in a software agent harness: read "seam", "provider", "inject" as software-architecture terms, never their everyday senses.',
  'Keep package names, plugin names, and ctx key names (like `tools`, `llm`) unchanged in English.',
  'Output exactly one line per input line, same order, each formatted as "n. 译文" with the input line number n.',
  'Never merge, split, reorder, or drop lines; add no quotes, no Markdown, and no commentary.',
].join('\n')

/**
 * Translate one English description.
 * @param ctx - the running process context.
 * @param text - English source text.
 * @param override - translation's own model choice, or null for the host default.
 * @returns Chinese translation.
 */
export function translate(ctx: Context, text: string, override: TranslateOverride | null): Promise<string> {
  return memo(hashOf('translate', text), () =>
    generateText(ctx, text, TRANSLATE_SYSTEM, 400, 30_000, override))
}

/** Lines per single model call in a batch; small enough to keep numbering reliable. */
const BATCH_CHUNK = 16

/**
 * Translate one chunk in a single numbered-lines call.
 * @returns per-item translations, or throws on any numbering/shape mismatch.
 */
async function translateChunk(ctx: Context, texts: string[], override: TranslateOverride | null): Promise<string[]> {
  const req = texts.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const out = await generateText(ctx, req, BATCH_SYSTEM, 4_000, 90_000, override)
  const lines = out.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length !== texts.length) {
    throw new HttpError(502, `批量翻译行数不匹配(期望 ${texts.length},得到 ${lines.length})`)
  }
  return lines.map((line, i) => {
    const m = line.match(/^\d+[.、:]\s*(.+)$/s)
    if (!m) throw new HttpError(502, `批量翻译第 ${i + 1} 行缺少编号前缀`)
    return m[1].trim()
  })
}

/** Two concurrent lanes keep a 100-item batch near half a minute end to end. */
const BATCH_CONCURRENCY = 2

/**
 * Translate a batch of English descriptions: cached items answered locally,
 * the rest through chunked numbered-lines calls with a per-item fallback when
 * a chunk's shape does not validate.
 * @param ctx - the running process context.
 * @param texts - English source texts (order preserved).
 * @param override - translation's own model choice, or null for the host default.
 * @returns Chinese translations, same length and order as `texts`.
 */
export async function translateBatch(ctx: Context, texts: string[], override: TranslateOverride | null): Promise<string[]> {
  const out = new Array<string | undefined>(texts.length).fill(undefined)
  const wanted = new Map<string, number[]>()
  texts.forEach((s, i) => {
    const hit = cache.get(hashOf('translate', s))
    if (hit !== undefined) { out[i] = hit; return }
    const lanes = wanted.get(s) ?? []
    lanes.push(i)
    wanted.set(s, lanes)
  })
  const unique = [...wanted.keys()]
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += BATCH_CHUNK) chunks.push(unique.slice(i, i + BATCH_CHUNK))
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor++] as string[]
      let results: string[]
      try {
        results = await translateChunk(ctx, chunk, override)
      } catch {
        // numbered-lines output broke shape: retry the chunk item by item
        results = await Promise.all(chunk.map((s) => translate(ctx, s, override).catch((err) => {
          throw err instanceof HttpError ? err : new HttpError(502, '单条翻译失败')
        })))
      }
      chunk.forEach((s, j) => {
        const lanes = wanted.get(s)
        if (lanes === undefined) return
        for (const i of lanes) out[i] = results[j]
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, chunks.length) }, worker))
  return out as string[]
}

// ------- the settings surface behind /api/translate/* -------
// The viewer's translation settings: pick another route the harness already
// knows, and store its key through the host's own credential seam — never in
// plugin config, never echoed back.

/** dsh-llm's legality rule for a user-supplied key: printable ASCII, no spaces. */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/** Reject a malformed key before it reaches the credential store. */
function assertApiKeyShape(value: string): void {
  if (!LEGAL_API_KEY.test(value)) throw new HttpError(400, 'API key 含非法字符(仅限可见 ASCII)')
}

/**
 * The credential ref a provider route reads its key from. deepseek-official's
 * ref is a constant of its adapter; pi-ai routes use the ref the Models page
 * itself derives when a route has no explicit profile (`<ROUTE>_API_KEY`,
 * uppercased, dashes to underscores — the existing zai-coding-cn profile
 * matches). A profile that declares a different apiKeyEnv than the derivation
 * is not readable from here; the key-test endpoint tells the honest truth.
 */
function refForProvider(provider: string): string {
  if (provider === 'deepseek-official') return 'DEEPSEEK_API_KEY'
  return `${provider.toUpperCase().replaceAll('-', '_')}_API_KEY`
}

/** The route translation would call right now: the override, else the host default. */
function effectiveSelection(ctx: Context, override: TranslateOverride | null): { provider: string; model: string } | null {
  if (override !== null) return override
  const defaultModel = (ctx as Context & { get?: (name: string) => unknown })
    .get?.('agentDefaultModel') as AgentDefaultModel | undefined
  const selection = defaultModel?.currentSelection()
  if (selection === undefined) return null
  return { provider: selection.provider, model: selection.model }
}

/**
 * /schematic/api/translate/* — status/providers/models for the settings form
 * and key storage through the credentials service. There is deliberately no
 * key-test endpoint: model discovery answers catalog routes from its built-in
 * registry without touching the endpoint, so a "test" built on it passes
 * bogus keys. The honest probe is one real translate-batch call after the
 * save — the exact path translation itself takes.
 * @param ctx - the running process context.
 * @param req - the request (method + body).
 * @param sub - path below /api/translate ('/status.json', '/providers.json',
 * '/models.json', '/key').
 * @param res - the response.
 * @param override - translation's own model choice (config.translate).
 */
export async function handleTranslateApi(
  ctx: Context,
  req: IncomingMessage,
  sub: string,
  res: ServerResponse,
  override: TranslateOverride | null,
): Promise<void> {
  const get = (ctx as Context & { get?: (name: string) => unknown }).get
  const llm = get?.('llm') as (LlmService & LlmRegistry) | undefined
  const credentials = get?.('credentials') as CredentialsService | undefined
  if (sub === '/status.json' && req.method === 'GET') {
    const effective = effectiveSelection(ctx, override)
    let key: { ref: string; configured: boolean; source?: string; writable: boolean } | null = null
    if (effective !== null && credentials !== undefined) {
      const info = await credentials.describe(refForProvider(effective.provider))
      key = { ref: refForProvider(effective.provider), ...info }
    }
    return sendJson(res, 200, {
      override,
      default: override === null ? effective : effectiveSelection(ctx, null),
      effective,
      llmMounted: llm !== undefined,
      credentials: key,
    })
  }
  if (sub === '/providers.json' && req.method === 'GET') {
    if (llm === undefined) throw new HttpError(503, 'llm 服务未挂载(宿主没有可用的模型路由)')
    const effective = effectiveSelection(ctx, override)
    const active = effective?.provider ?? null
    const providers = llm.listConfigurableProviders()
      .map((p) => ({ provider: p.provider, displayName: p.displayName, declared: p.declared === true, active: p.provider === active }))
    return sendJson(res, 200, { providers })
  }
  if (sub === '/models.json' && req.method === 'GET') {
    if (llm === undefined) throw new HttpError(503, 'llm 服务未挂载(宿主没有可用的模型路由)')
    const provider = new URL(req.url ?? '/', 'http://x').searchParams.get('provider') ?? ''
    if (provider === '') throw new HttpError(400, 'provider 查询参数必填')
    return sendJson(res, 200, { models: (await llm.listModels(provider)).map((m) => ({ id: m.id, name: m.name })) })
  }
  if (sub === '/key' && req.method === 'POST') {
    if (credentials === undefined) throw new HttpError(503, 'credentials 服务未挂载,key 无处可存')
    const body = (await readJsonBody(req)) as { ref?: unknown; provider?: unknown; value?: unknown } | null
    const ref = typeof body?.ref === 'string' && body.ref !== ''
      ? body.ref
      : typeof body?.provider === 'string' && body.provider !== '' ? refForProvider(body.provider) : null
    if (ref === null) throw new HttpError(400, 'ref 与 provider 必须给出其一')
    if (typeof body?.value !== 'string' || body.value === '') throw new HttpError(400, 'value 必须是非空字符串')
    if (body.value.length > 4096) throw new HttpError(400, 'value 过长(>4096 字符)')
    assertApiKeyShape(body.value)
    const info = await credentials.describe(ref)
    if (!info.writable) throw new HttpError(409, `引用 ${ref} 不可写(环境变量层优先生效,请在环境里修改)`)
    await credentials.set(ref, body.value)
    return sendJson(res, 200, { ref, ...(await credentials.describe(ref)) }) // describe, never the value
  }
  return sendJson(res, 404, { error: 'not found' })
}
