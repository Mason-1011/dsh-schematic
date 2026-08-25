/**
 * LLM-backed auxiliary features for the schematic viewer: description
 * translation (EN→ZH) and per-plugin topology explanation.
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
import type { Context } from '@deepseek-ai/cordis'

/** HTTP-facing failure: status reaches the route handler, message reaches the page. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
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

/** Structural slice of agentDefaultModel (ctx.get, optional in a profile). */
interface AgentDefaultModel {
  currentSelection(): { provider: string; model: string }
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
 * @returns joined text blocks of the completed stream.
 */
async function generateText(
  ctx: Context,
  req: string,
  system: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string> {
  const kit = await loadKit()
  if (kit === null) throw new HttpError(503, 'LLM 工具不可用(无法定位 @deepseek-ai/dsh-llm)')
  const llm = (ctx as Context & { get?: (name: string) => unknown }).get?.('llm') as LlmService | undefined
  if (llm === undefined) throw new HttpError(503, 'llm 服务未挂载(缺少 DEEPSEEK_API_KEY?)')
  const defaultModel = (ctx as Context & { get?: (name: string) => unknown })
    .get?.('agentDefaultModel') as AgentDefaultModel | undefined
  if (defaultModel === undefined) throw new HttpError(503, 'agentDefaultModel 服务未挂载')
  const { provider, model } = defaultModel.currentSelection()
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

/** Facts handed to the explainer: one node's live snapshot plus its neighborhood. */
export interface ExplainFacts {
  id: string
  label: string
  module: string | null
  state: string | null
  desc: string | null
  cluster: string | null
  provides: string[]
  inject: string[]
  dependsOn: { unit: string; keys: string[] }[]
  dependedBy: { unit: string; keys: string[] }[]
  externalInject: string[]
}

const TRANSLATE_SYSTEM = [
  'Translate the following English text into Simplified Chinese.',
  'The text documents a plugin in a software agent harness: read "seam", "provider", "inject" as software-architecture terms, never their everyday senses.',
  'Keep package names, plugin names, and ctx key names (like `tools`, `llm`) unchanged in English.',
  'Output only the translation as one plain-text paragraph, with no quotes, no Markdown, and no explanations.',
].join('\n')

const EXPLAIN_SYSTEM = [
  'You are explaining one plugin mounted inside the DeepSeek Harness (dsh) agent runtime to a Chinese-speaking developer.',
  'Use ONLY the JSON facts given (a live snapshot of the plugin mount: provided/injected ctx keys, mount state, and neighboring units).',
  'Write concise Simplified Chinese, 100-200 characters, one paragraph: 这个插件是什么、提供哪些服务、依赖哪些服务、在当前拓扑中扮演什么角色.',
  'Do not invent details not present in the facts. Package names and ctx keys stay in English. Plain text only, no Markdown or lists.',
].join('\n')

/**
 * Translate one English description.
 * @param ctx - the running process context.
 * @param text - English source text.
 * @returns Chinese translation.
 */
export function translate(ctx: Context, text: string): Promise<string> {
  return memo(hashOf('translate', text), () =>
    generateText(ctx, text, TRANSLATE_SYSTEM, 400, 30_000))
}

/**
 * Explain one mounted unit from its live facts.
 * @param ctx - the running process context.
 * @param facts - node snapshot plus neighborhood from the live graph.
 * @returns Chinese explanation paragraph.
 */
export function explain(ctx: Context, facts: ExplainFacts): Promise<string> {
  return memo(hashOf('explain', JSON.stringify(facts)), () =>
    generateText(ctx, JSON.stringify(facts, null, 2), EXPLAIN_SYSTEM, 800, 60_000))
}
