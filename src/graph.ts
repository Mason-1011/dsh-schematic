/**
 * The live topology snapshot: a three-way join over the running Cordis
 * runtime, recomputed on every request (no second lifecycle truth to keep
 * synchronized — the same stance as dsh's own plugin-inventory).
 *
 *   registry  → which plugins are mounted, their resolved inject keys and state
 *   reflect   → which fiber provides each ctx service key (the live edges)
 *   loader    → config identity for entry-mounted plugins (id, module, disabled)
 *
 * Programmatic mounts (ctx.plugin(), dynamic packages) appear with origin
 * 'runtime'; loader entries with origin 'entry'. Output shape mirrors the
 * static scanner's graph.json so the viewer renders both with one engine.
 */

import { createRequire } from 'node:module'
import { dirname, join, isAbsolute } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Context, Fiber, FiberState } from '@deepseek-ai/cordis'
import { buildClusters, computeRank } from './cluster.ts'

/**
 * Infrastructure ctx keys that never drive clustering, whatever the mounted
 * set's size: the harness's own universal services (the static scanner's
 * computed set) plus services every web composition mounts (webServer,
 * settings). The >= 9-injectors threshold alone cannot see these on a small
 * live profile, where a system-prompt seam would swallow half the client tree.
 */
const INFRA_KEYS: ReadonlySet<string> = new Set([
  'agents', 'connection', 'invariants', 'llm', 'locale', 'remote', 'sessions',
  'slots', 'subagents', 'systemPrompt', 'tools', 'webServer', 'settings',
])

/** Runtime mirror of the cross-package FiberState const enum (see plugin-inventory). */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Fiber state → wire label; DISPOSED fibers are not listed at all. */
const PHASE: Record<number, string> = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.UNLOADING]: 'unloading',
}

/** Local-time "YYYY-MM-DD HH:mm:ss" snapshot stamp; the footer is read at a glance, so no UTC surprise. */
function localStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Directory group → display category; same fixed assignment as tools/scan.mjs. */
const CATEGORY: Record<string, string> = {
  core: 'core-spine',
  llm: 'model-layer',
  shell: 'execution-seams', subprocess: 'execution-seams', terminal: 'execution-seams',
  fs: 'execution-seams', lsp: 'execution-seams', e2b: 'execution-seams', sandbox: 'execution-seams',
  'code-runtime': 'execution-seams',
  web: 'extension-seams', skill: 'extension-seams', subagent: 'extension-seams',
  workflow: 'extension-seams', compaction: 'extension-seams', context: 'extension-seams',
  jobs: 'extension-seams', mcp: 'extension-seams',
  session: 'session-data', 'session-query': 'session-data', todo: 'session-data',
  plan: 'session-data', goal: 'session-data', feedback: 'session-data', spill: 'session-data',
  storage: 'session-data', attachment: 'session-data',
  interaction: 'interaction-policy', guard: 'interaction-policy', identity: 'interaction-policy',
  settings: 'interaction-policy', credentials: 'interaction-policy', preset: 'interaction-policy',
  boot: 'host-protocol', api: 'host-protocol', sdk: 'host-protocol', acp: 'host-protocol',
  typert: 'host-protocol', hooks: 'host-protocol', bundle: 'host-protocol', host: 'host-protocol',
  client: 'web-client',
}

/** One mounted unit in the snapshot (superset fields the viewer fills in later). */
export interface LiveNode {
  id: string
  /** Module specifier from the loader entry; null for programmatic mounts. */
  module: string | null
  /** Display label: module basename, else the plugin's declared name. */
  label: string
  /** 'entry' = mounted from configuration; 'runtime' = programmatic. */
  origin: 'entry' | 'runtime'
  state: string | null
  /** Config identity ('entry' origin) or 'runtime mount' — the search/table "dir". */
  dir: string
  category: string
  group: string
  form: 'service' | 'plugin'
  desc: string | null
  pluginName: string | null
  provides: string[]
  inject: string[]
  softInject: string[]
  cluster?: string
  rank?: number
}

/** The full snapshot served at /schematic/graph.json. */
export interface LiveGraph {
  meta: { mode: 'live'; generated: string; universalKeys: string[] }
  nodes: LiveNode[]
  edges: { from: string; to: string; keys: string[] }[]
  clusters: { id: string; label: string; provider: string; category: string; desc: string | null; seamKeys: string[]; members: string[] }[]
  externalKeys: string[]
}

/** Live service implementations from the reflect store, keyed by isolation symbol. */
function liveImpls(ctx: Context): { name: string; fiber: Fiber }[] {
  const store = (ctx.reflect as unknown as { store: Record<symbol, { name: string; fiber: Fiber } | undefined> }).store
  return Object.getOwnPropertySymbols(store)
    .map((key) => store[key])
    .filter((impl): impl is { name: string; fiber: Fiber } => impl !== undefined)
}

// Description lookup anchors: bare package specifiers must resolve inside the
// harness installation, never inside this repo. Dev runs launch from the
// checkout (process.cwd()); installed profiles resolve from their node_modules.
const descCache = new Map<string, string | null>()
let requireAnchors: NodeJS.Require | null = null

function pkgDesc(nearDir: string): string | null {
  let dir = nearDir
  for (let i = 0; i < 4; i++) {
    try {
      const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (typeof pj.name === 'string') return typeof pj.description === 'string' ? pj.description : null
    } catch { /* no package.json here — walk up */ }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function descOf(spec: string | null): string | null {
  if (!spec || spec.startsWith('cordis:')) return null
  if (descCache.has(spec)) return descCache.get(spec) ?? null
  let out: string | null = null
  try {
    if (isAbsolute(spec)) {
      out = pkgDesc(dirname(spec))
    } else {
      requireAnchors ??= (() => {
        const bases = [process.cwd(), join(homedir(), '.dsh', 'profiles', 'web')]
        const working = bases.filter((b) => {
          try { createRequire(join(b, 'x.js')).resolve('@deepseek-ai/cordis'); return true } catch { return false }
        })
        return working.length ? createRequire(join(working[0], 'x.js')) : null
      })()
      if (requireAnchors) out = pkgDesc(dirname(requireAnchors.resolve(spec)))
    }
  } catch { /* unresolvable specifier — description stays null */ }
  descCache.set(spec, out)
  return out
}

/** '<group>/<pkg>'-style category from a module specifier: dsh-fs-local → execution-seams. */
function categoryOf(spec: string | null): string {
  if (!spec) return 'other'
  const base = spec.replace(/^@[\w-]+\//, '').replace(/^dsh-/, '')
  const token = base.split('/')[0]?.split('-')[0] ?? ''
  return CATEGORY[token] ?? 'other'
}

/**
 * Build the live snapshot: mounted units, injector→provider edges, clusters, ranks.
 * @param ctx - any live runtime context of the process being visualized.
 * @returns the graph served to the viewer.
 */
export function buildGraph(ctx: Context): LiveGraph {
  const impls = liveImpls(ctx)

  // every non-disposed fiber the registry knows; loader entries identify
  // themselves via the Fiber.entry augmentation (vendor loader). Internal
  // descendants of an entry's fiber carry the SAME .entry, so config identity
  // belongs to the fiber whose parent lives outside that entry — everything
  // below it is the package's private tree, absorbed into the unit.
  const fibers: Fiber[] = []
  const runtimes = (ctx.registry as unknown as { values(): Iterable<{ fibers: Iterable<Fiber> }> }).values()
  for (const runtime of runtimes) {
    for (const fiber of runtime.fibers) {
      if (fiber.uid !== null) fibers.push(fiber)
    }
  }

  type EntryRef = { options: { group?: unknown; id: string; name: string }; id: string }
  const entryOf = (f: Fiber): EntryRef | undefined => (f as Fiber & { entry?: EntryRef }).entry
  const isUnit = (f: Fiber): boolean => {
    const entry = entryOf(f)
    if (entry === undefined) return true // programmatic mount (ctx.plugin)
    if (entry.options.group) return false // config folder, not a plugin
    const parent = f.parent.fiber
    return parent === undefined || parent === f || entryOf(parent) !== entry
  }

  const unitFibers = fibers.filter(isUnit)
  const unitSet = new Set(unitFibers)
  // A fiber belongs to its nearest unit ancestor — usually itself. Service
  // attribution and dependency edges ride the same ownership, so a package's
  // internal children contribute their provides/inject to the entry unit,
  // mirroring the static scanner's package-level view.
  const nearestUnit = (start: Fiber): Fiber | undefined => {
    let current: Fiber = start
    while (true) {
      if (unitSet.has(current)) return current
      const parent = current.parent.fiber
      if (parent === current) return undefined
      current = parent
    }
  }
  const ownerOf = new Map<Fiber, Fiber>()
  for (const fiber of fibers) {
    const owner = nearestUnit(fiber)
    if (owner) ownerOf.set(fiber, owner)
  }

  const providesOf = new Map<Fiber, string[]>()
  const ownerFiberOf = new Map(impls.map((impl) => [impl.name, nearestUnit(impl.fiber)]))
  for (const impl of impls) {
    const owner = ownerFiberOf.get(impl.name)
    if (!owner) continue
    if (!providesOf.has(owner)) providesOf.set(owner, [])
    providesOf.get(owner)!.push(impl.name)
  }
  const injectOf = new Map<Fiber, Set<string>>()
  for (const fiber of fibers) {
    const owner = ownerOf.get(fiber)
    if (!owner) continue
    if (!injectOf.has(owner)) injectOf.set(owner, new Set())
    for (const key of Object.keys(fiber.inject)) injectOf.get(owner)!.add(key)
  }

  const idOf = new Map<Fiber, string>()
  const nodes: LiveNode[] = []
  for (const fiber of unitFibers) {
    const entry = entryOf(fiber)
    const isEntry = entry !== undefined
    const id = isEntry ? entry!.id : `dyn:${fiber.uid}`
    idOf.set(fiber, id)
    const module = isEntry ? entry!.options.name : null
    const runtimeName = (fiber.runtime as unknown as { name?: string } | null)?.name ?? null
    const label = module ? module.replace(/^@[\w-]+\//, '').replace(/^dsh-/, '') : (runtimeName ?? id)
    const provides = (providesOf.get(fiber) ?? []).sort()
    nodes.push({
      id,
      module,
      label,
      origin: isEntry ? 'entry' : 'runtime',
      state: PHASE[fiber.state as number] ?? null,
      dir: isEntry ? entry!.id.replace(/^include:/, '') : 'runtime mount',
      category: categoryOf(module),
      group: categoryOf(module) === 'other' ? 'other' : label.split('-')[0] ?? 'other',
      form: provides.length ? 'service' : 'plugin',
      desc: descOf(module),
      pluginName: runtimeName,
      provides,
      inject: [...(injectOf.get(fiber) ?? [])].sort(),
      softInject: [],
    })
  }

  // edges: injector unit → provider unit per ctx key, aggregated per pair
  const pairKeys = new Map<string, Set<string>>()
  const external = new Set<string>()
  const keyInjectCount = new Map<string, number>()
  for (const n of nodes) {
    for (const k of n.inject) keyInjectCount.set(k, (keyInjectCount.get(k) ?? 0) + 1)
  }
  for (const fiber of fibers) {
    const owner = ownerOf.get(fiber)
    if (!owner) continue
    const from = idOf.get(owner)
    if (!from) continue
    for (const key of Object.keys(fiber.inject)) {
      const provider = ownerFiberOf.get(key)
      if (!provider) { external.add(key); continue }
      const to = idOf.get(provider)
      if (!to || to === from) continue
      const pair = `${from} ${to}`
      if (!pairKeys.has(pair)) pairKeys.set(pair, new Set())
      pairKeys.get(pair)!.add(key)
    }
  }
  const edges = [...pairKeys].map(([pair, keys]) => {
    const [from, to] = pair.split(' ')
    return { from, to, keys: [...keys].sort() }
  })

  const { clusters, universalKeys } = buildClusters(nodes, edges, keyInjectCount, INFRA_KEYS)
  const catById = new Map(nodes.map((n) => [n.id, n.category]))
  // the provider's category is the cluster's pill category on the overview
  const wireClusters = clusters.map((c) => ({ ...c, category: catById.get(c.provider) ?? 'other' }))
  const clusterOf = new Map<string, string>()
  for (const c of clusters) for (const m of c.members) clusterOf.set(m, c.id)
  const rank = computeRank(nodes, edges)
  for (const n of nodes) {
    n.cluster = clusterOf.get(n.id)
    n.rank = rank.get(n.id) ?? 0
  }

  return {
    meta: { mode: 'live', generated: localStamp(new Date()), universalKeys },
    nodes,
    edges,
    clusters: wireClusters,
    externalKeys: [...external].sort(),
  }
}
