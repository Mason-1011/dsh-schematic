/**
 * The dry-run pipeline behind POST /compose/preview and the shared first
 * half of apply: plan operations → splice the candidate file → recompose
 * both entry trees → diff. Zero writes anywhere; every warning carries what
 * the preview CAN compute, and the UI words the rest as unknown (an
 * unmounted module's provides/inject are only knowable by mounting it).
 *
 * @module dsh-schematic/compose/preview
 */

import type { Context } from '@deepseek-ai/cordis'
import { buildGraph } from '../graph.ts'
import { deepEqual, type Composition, type PatchEntry, type PatchRow } from './layers.ts'
import { readManagedBlock, renderBlockBody, spliceManagedBlock } from './block.ts'
import { buildComposeModel, flattenRows, type ModelEntry } from './model.ts'
import { planOperations, type Op, type TargetRow, type Warning } from './ops.ts'
import { isInstalled } from './catalog.ts'
import type { ProtectedConfig } from './protected.ts'

/** One entry-level change between the current and the candidate tree. */
export interface PreviewEntryDelta {
  id: string
  name: string
  kind: 'removed' | 'added' | 'changed'
  /** Fields that differ, for kind 'changed'; empty otherwise. */
  changes: ('disabled' | 'config')[]
  /** Effective disabled state in the candidate tree (a `!!js` counts as disabled). */
  disabledAfter: boolean
  /** Whether a live mounted node matches this id (removed/changed only). */
  live: boolean
  /** Graph-space node id (`include:`-prefixed) when live; the overlay's key. */
  liveNodeId: string | null
}

/** A ctx key losing its last live provider while units still inject it. */
export interface OrphanedKey {
  key: string
  /** Live units still injecting the key (labels). */
  injectedBy: string[]
}

/** The preview payload: everything the drawer and the graph overlay render. */
export interface Preview {
  baseHash: string
  blockYamlBefore: string
  blockYamlAfter: string
  /** The full candidate file text — byte-for-byte what apply would write. */
  filePreview: string
  fileBytes: number
  entries: PreviewEntryDelta[]
  orphanedKeys: OrphanedKey[]
  warnings: Warning[]
}

/** Tree-level disabled state; a `!!js` value cannot be evaluated here and counts as disabled. */
function effectiveDisabled(row: PatchEntry): boolean {
  const value = row.disabled
  if (value === undefined) return false
  if (typeof value === 'object' && value !== null && '__jsExpr' in value) return true
  return value !== false
}

/** The planner's view of one model entry. */
function targetRowOf(entry: ModelEntry, load: (text: string) => unknown): TargetRow {
  let configKeys: string[] = []
  if (entry.config !== null) {
    const parsed = load(entry.config.raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      configKeys = Object.keys(parsed)
    }
  }
  return {
    id: entry.id,
    name: entry.name,
    disabled: entry.disabled,
    disabledSource: entry.disabledSource,
    configKeys,
    jsExprFields: entry.config?.jsExprFields ?? [],
    managed: entry.origin.managed,
    protected: entry.protected === null ? null : { tier: entry.protected.tier, reason: entry.protected.reason },
  }
}

/**
 * Build the dry-run preview of one operation list.
 * @param ctx - live Cordis context (graph cross-reference).
 * @param comp - the resolved composition (the operation base).
 * @param ops - wire-validated operations, applied in order.
 * @param protectedConfig - curated-list overrides from plugin config.
 * @throws HttpError 422 for invalid operations or a broken managed block.
 */
export function buildPreview(
  ctx: Context,
  comp: Composition,
  ops: Op[],
  protectedConfig: ProtectedConfig,
): Preview {
  const dialect = comp.dialect
  const model = buildComposeModel(ctx, comp, protectedConfig)
  const block = readManagedBlock(comp.userText, dialect)
  const targets = new Map(model.entries.map((entry): [string, TargetRow] => [entry.id, targetRowOf(entry, dialect.load)]))
  const plan = planOperations(targets, block.rows, ops, dialect, (pkg) => isInstalled(pkg, comp.profile.dir))

  const filePreview = spliceManagedBlock(comp.userText, plan.rows, dialect)
  // The candidate's parsed rows are exactly what the harness's HMR will read
  // as the user layer on reload — recomposing them is the dry run.
  const afterPatches = dialect.load(filePreview) as PatchRow[]
  const beforeById = new Map(flattenRows(comp.composeWith(comp.userPatches), null)
    .map(({ row }): [string, PatchEntry] => [String(row.id ?? ''), row]))
  const afterById = new Map(flattenRows(comp.composeWith(afterPatches), null)
    .map(({ row }): [string, PatchEntry] => [String(row.id ?? ''), row]))

  const graph = buildGraph(ctx)
  const liveNodeIdByEntry = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.origin === 'entry') liveNodeIdByEntry.set(node.id.replace(/^include:/, ''), node.id)
  }

  const entries: PreviewEntryDelta[] = []
  const disappearing = new Set<string>()
  for (const [id, before] of beforeById) {
    const nodeId = liveNodeIdByEntry.get(id) ?? null
    const after = afterById.get(id)
    if (after === undefined) {
      entries.push({ id, name: String(before.name), kind: 'removed', changes: [], disabledAfter: true, live: nodeId !== null, liveNodeId: nodeId })
      disappearing.add(id)
      continue
    }
    const changes: ('disabled' | 'config')[] = []
    if (effectiveDisabled(before) !== effectiveDisabled(after)) changes.push('disabled')
    if (!deepEqual(before.config ?? null, after.config ?? null)) changes.push('config')
    if (changes.length === 0) continue
    entries.push({ id, name: String(before.name), kind: 'changed', changes, disabledAfter: effectiveDisabled(after), live: nodeId !== null, liveNodeId: nodeId })
    if (changes.includes('disabled') && effectiveDisabled(after)) disappearing.add(id)
  }
  for (const [id, after] of afterById) {
    if (beforeById.has(id)) continue
    entries.push({ id, name: String(after.name), kind: 'added', changes: [], disabledAfter: effectiveDisabled(after), live: false, liveNodeId: null })
  }

  // Orphan detection over the live graph: a ctx key whose every live provider
  // disappears, while other units still inject it. Ghost additions cannot be
  // counted as replacement providers — their provides are unknown until mount.
  const providersOfKey = new Map<string, { entryId: string | null }[]>()
  for (const node of graph.nodes) {
    const entryId = node.origin === 'entry' ? node.id.replace(/^include:/, '') : null
    for (const key of node.provides) {
      const list = providersOfKey.get(key) ?? []
      list.push({ entryId })
      providersOfKey.set(key, list)
    }
  }
  const orphanedKeys: OrphanedKey[] = []
  const warnings: Warning[] = [...plan.warnings]
  for (const [key, providers] of providersOfKey) {
    const remaining = providers.some((p) => p.entryId === null || !disappearing.has(p.entryId))
    if (remaining) continue
    const injectedBy = graph.nodes.filter((n) => n.inject.includes(key)).map((n) => n.label)
    if (injectedBy.length === 0) continue
    orphanedKeys.push({ key, injectedBy })
    warnings.push({ level: 'warn', code: 'ORPHANED_KEY', keys: [key], detail: injectedBy.join('、') })
  }
  orphanedKeys.sort((a, b) => a.key.localeCompare(b.key))

  return {
    baseHash: comp.hash,
    blockYamlBefore: model.blockYaml,
    blockYamlAfter: renderBlockBody(plan.rows, dialect),
    filePreview,
    fileBytes: Buffer.byteLength(filePreview, 'utf8'),
    entries,
    orphanedKeys,
    warnings,
  }
}
