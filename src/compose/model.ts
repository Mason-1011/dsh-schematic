/**
 * The editable composition model served at GET /schematic/compose.json:
 * every composed entry with its layer provenance (the last layer that set
 * its state), raw config (`!!js` verbatim), live cross-reference, protection
 * tier, and the seam view for provider swaps. Pure derivation from
 * `resolveComposition` + `buildGraph`.
 *
 * @module dsh-schematic/compose/model
 */

import type { Context } from '@deepseek-ai/cordis'
import { buildGraph } from '../graph.ts'
import { deepEqual, type Composition, type PatchEntry } from './layers.ts'
import { readManagedBlock, renderBlockBody } from './block.ts'
import { protectedTier, type ProtectedConfig } from './protected.ts'
import { seamAlternatives, seamOfModule, type SeamAlternative } from './catalog.ts'

/** One composed entry as served to the drawer. */
export interface ModelEntry {
  id: string
  name: string
  /** Loader group path (':'-joined), null at root. */
  groupPath: string | null
  disabled: boolean
  /** 'js-expr' = disabled is a `!!js` node the loader interpolates per boot. */
  disabledSource: 'literal' | 'js-expr' | null
  origin: { layer: 'bundle' | 'user' | 'home' | 'overlay', label: string, managed: boolean }
  config: { raw: string, jsExprFields: string[] } | null
  live: { state: string | null, provides: string[], inject: string[] } | null
  protected: { tier: 'danger' | 'warn', reason: string } | null
}

/** One capability seam with its swappable provider registrars. */
export interface ModelSeam {
  key: string
  /** The unit owning the ctx key (the capability package itself). */
  owner: { id: string, label: string } | null
  /** Live nodes registering providers into the seam (the swappable rows). */
  registrars: { id: string, label: string, entryId: string | null }[]
  /** Live units injecting the key (consumers of the seam). */
  consumers: number
  alternatives: SeamAlternative[]
}

/** The whole GET /compose.json payload body (envelope fields added by routes). */
export interface ComposeModel {
  entries: ModelEntry[]
  seams: ModelSeam[]
  blockYaml: string
}

/** {__jsExpr} node check matching the include's JsExpr construct. */
function isJsExpr(value: unknown): value is { __jsExpr: string } {
  return typeof value === 'object' && value !== null && '__jsExpr' in value
}

/** Collect dotted paths of config fields whose value is a `!!js` node. */
function jsExprFields(config: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(config)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (isJsExpr(value)) out.push(path)
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      out.push(...jsExprFields(value as Record<string, unknown>, path))
    }
  }
  return out
}

/** Flatten a composed tree, dropping group folders but remembering their path. */
export function flattenRows(rows: PatchEntry[], groupPath: string | null = null, out: { row: PatchEntry, groupPath: string | null }[] = []): { row: PatchEntry, groupPath: string | null }[] {
  for (const row of rows) {
    if (row.group !== undefined && Array.isArray(row.config)) {
      flattenRows(row.config, groupPath === null ? String(row.id) : `${groupPath}:${String(row.id)}`, out)
    } else {
      out.push({ row, groupPath })
    }
  }
  return out
}

/**
 * Per-row provenance: for each entry id, the LAST layer whose application
 * introduced or changed the row (snapshots composed per layer prefix; the
 * patch algorithm only rewrites rows in place or appends — the same property
 * `renderConfigDump` relies on).
 */
function rowOrigins(comp: Composition): Map<string, { layer: 'bundle' | 'user' | 'home' | 'overlay', label: string }> {
  const origins = new Map<string, { layer: 'bundle' | 'user' | 'home' | 'overlay', label: string }>()
  const byId = new Map<string, PatchEntry>()
  for (let i = 0; i < comp.layerPatches.length; i++) {
    const layer = comp.layerPatches[i]
    const rows = flattenRows(comp.boot.composeEntries(comp.layerPatches.slice(0, i + 1).map((l) => l.patches)))
    for (const { row } of rows) {
      const id = String(row.id ?? '')
      const previous = byId.get(id)
      if (previous === undefined || !deepEqual(previous, row)) {
        origins.set(id, { layer: layer.kind, label: layer.label })
      }
    }
    for (const { row } of rows) byId.set(String(row.id ?? ''), row)
  }
  return origins
}

/**
 * Build the editable model.
 * @param ctx - live Cordis context (for the graph cross-reference).
 * @param comp - the resolved composition.
 * @param protectedConfig - curated-list overrides from plugin config.
 */
export function buildComposeModel(
  ctx: Context,
  comp: Composition,
  protectedConfig: ProtectedConfig,
): ComposeModel {
  const graph = buildGraph(ctx)
  // Loader entry ids from the include tree carry an `include:` prefix in the
  // graph; composed row ids never do. Index nodes under both forms.
  const nodeById = new Map<string, typeof graph.nodes[number]>()
  for (const node of graph.nodes) {
    nodeById.set(node.id, node)
    nodeById.set(node.id.replace(/^include:/, ''), node)
  }
  const injectCount = new Map<string, number>()
  for (const node of graph.nodes) {
    for (const key of node.inject) injectCount.set(key, (injectCount.get(key) ?? 0) + 1)
  }

  const block = readManagedBlock(comp.userText, comp.dialect)
  const managedIds = new Set(block.rows.flatMap((row) =>
    Array.isArray(row.insert) ? row.insert.map((entry) => String(entry.id ?? '')) : []))
  const origins = rowOrigins(comp)

  const entries: ModelEntry[] = flattenRows(comp.composeWith(comp.userPatches), null).map(({ row, groupPath }) => {
    const id = String(row.id ?? '')
    const node = nodeById.get(id) ?? null
    const live = node === null ? null : { state: node.state, provides: node.provides, inject: node.inject }
    const disabledValue = row.disabled
    const verdict = protectedTier(id, live?.provides ?? null, (key) => injectCount.get(key) ?? 0, protectedConfig)
    const origin = origins.get(id) ?? { layer: 'bundle' as const, label: '?' }
    const config = row.config !== undefined && row.config !== null && typeof row.config === 'object' && !Array.isArray(row.config)
      ? {
          raw: comp.dialect.dump(row.config).trimEnd(),
          jsExprFields: jsExprFields(row.config as Record<string, unknown>),
        }
      : null
    return {
      id,
      name: String(row.name),
      groupPath,
      // Live truth first: a mounted fiber is not disabled, whatever the raw
      // row says (a `!!js` disabled only resolves per-boot). Without a fiber,
      // a literal decides; an unevaluated `!!js` that did not mount here
      // counts as disabled in this process.
      disabled: live !== null
        ? false
        : disabledValue === undefined
          ? false
          : isJsExpr(disabledValue) ? true : disabledValue !== false,
      disabledSource: disabledValue === undefined ? null : isJsExpr(disabledValue) ? 'js-expr' : 'literal',
      origin: { layer: origin.layer, label: origin.label, managed: managedIds.has(id) },
      config,
      live,
      protected: verdict === null ? null : { tier: verdict.tier, reason: verdict.reason },
    }
  })

  // Seam view: capability services with curated provider registrars.
  const treeRows = entries.map((e) => ({ id: e.id, module: e.name, disabled: e.disabled, configRaw: e.config?.raw ?? null }))
  const seamKeys = new Set<string>()
  for (const node of graph.nodes) {
    const seam = seamOfModule(node.module ?? '')
    if (seam !== null) seamKeys.add(seam)
  }
  for (const row of treeRows) {
    const seam = seamOfModule(row.module)
    if (seam !== null) seamKeys.add(seam)
  }
  const seams: ModelSeam[] = [...seamKeys].sort().flatMap((key) => {
    const owner = graph.nodes.find((n) => n.provides.includes(key)) ?? null
    const registrars = graph.nodes
      .filter((n) => n.inject.includes(key) && seamOfModule(n.module ?? '') === key)
      .map((n) => ({ id: n.id, label: n.label, entryId: n.origin === 'entry' ? n.id : null }))
    const exceptIds = new Set(registrars.map((r) => r.entryId ?? r.id))
    const alternatives = seamAlternatives(key, exceptIds, treeRows, comp.profile.dir)
    if (owner === null && registrars.length === 0 && alternatives.length === 0) return []
    return [{
      key,
      owner: owner === null ? null : { id: owner.id, label: owner.label },
      registrars,
      consumers: injectCount.get(key) ?? 0,
      alternatives,
    }]
  })

  return { entries, seams, blockYaml: renderBlockBody(block.rows, comp.dialect) }
}
