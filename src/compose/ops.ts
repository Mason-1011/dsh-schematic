/**
 * Operation planning: validate a client operation list and reduce it to the
 * next managed-block row set. Pure — no I/O; the only YAML work is parsing
 * config text with the include's own dialect. Later ops on the same id win,
 * mirroring how patch layers compose.
 *
 * @module dsh-schematic/compose/ops
 */

import type { Dialect, PatchRow } from './layers.ts'
import { HttpError } from '../llm.ts'

/** One client-requested composition edit. */
export type Op =
  | { kind: 'disable', id: string }
  | { kind: 'enable', id: string }
  | { kind: 'setConfig', id: string, config: string }
  | { kind: 'insert', id: string, name: string, config?: string }
  | { kind: 'swap', seam: string, from: string, to: { id?: string, name?: string, config?: string } }

/** Preview warning codes; the viewer maps each to bilingual prose. */
export type WarningCode =
  | 'SELF_DISABLE'
  | 'FREEZE_JS_EXPR'
  | 'KEY_CONFLICT_RISK'
  | 'ORPHANED_KEY'
  | 'CONFIG_FIELD_DROPPED'
  | 'BOOT_CRITICAL'

/** One preview warning: code + the values its prose names. */
export interface Warning {
  level: 'info' | 'warn' | 'danger'
  code: WarningCode
  ids?: string[]
  keys?: string[]
  /** e.g. the install command for NOT_INSTALLED. */
  detail?: string
}

/** What the planner needs to know about one composed row. */
export interface TargetRow {
  id: string
  name: string
  disabled: boolean
  disabledSource: 'literal' | 'js-expr' | null
  /** Config keys the row carries (dropped-field warnings). */
  configKeys: string[]
  /** Config fields whose value is a `!!js` node (freeze warnings). */
  jsExprFields: string[]
  /** The row was inserted by our managed block. */
  managed: boolean
  protected: { tier: 'danger' | 'warn', reason: string } | null
}

/** The reduced plan: the next managed-block rows plus warnings. */
export interface Plan {
  rows: PatchRow[]
  warnings: Warning[]
}

/** Parse and narrow one op list from the wire. @throws HttpError 400. */
export function parseOps(input: unknown): Op[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'operations 必须是数组')
  return input.map((raw, index): Op => {
    const base = `operations[${index}]`
    if (typeof raw !== 'object' || raw === null) throw new HttpError(400, `${base} 必须是对象`)
    const op = raw as Record<string, unknown>
    const kind = op.kind
    const id = typeof op.id === 'string' ? op.id : null
    const name = typeof op.name === 'string' ? op.name : null
    const config = typeof op.config === 'string' ? op.config : undefined
    switch (kind) {
      case 'disable':
      case 'enable':
        if (id === null) throw new HttpError(400, `${base}.id 必须是字符串`)
        return { kind, id } as Op
      case 'setConfig':
        if (id === null || config === undefined) throw new HttpError(400, `${base} 需要 id 和 config`)
        return { kind, id, config } as Op
      case 'insert':
        if (id === null || name === null) throw new HttpError(400, `${base} 需要 id 和 name`)
        return { kind, id, name, ...(config !== undefined ? { config } : {}) } as Op
      case 'swap': {
        const seam = typeof op.seam === 'string' ? op.seam : null
        const from = typeof op.from === 'string' ? op.from : null
        const toRaw = op.to
        if (seam === null || from === null || typeof toRaw !== 'object' || toRaw === null) {
          throw new HttpError(400, `${base} 需要 seam、from 和 to`)
        }
        const to = toRaw as Record<string, unknown>
        const toId = typeof to.id === 'string' ? to.id : undefined
        const toName = typeof to.name === 'string' ? to.name : undefined
        const toConfig = typeof to.config === 'string' ? to.config : undefined
        if (toId === undefined && toName === undefined) throw new HttpError(400, `${base}.to 需要 id 或 name`)
        return { kind: 'swap', seam, from, to: { ...(toId !== undefined ? { id: toId } : {}), ...(toName !== undefined ? { name: toName } : {}), ...(toConfig !== undefined ? { config: toConfig } : {}) } }
      }
      default:
        throw new HttpError(400, `${base}.kind 必须是 disable|enable|setConfig|insert|swap`)
    }
  })
}

/**
 * Reduce operations to the next managed-block row set.
 * @param targets - composed rows by id (TargetRow view of the model).
 * @param currentRows - the managed block's current rows.
 * @param ops - validated client operations, applied in order.
 * @param dialect - the include's YAML dialect.
 * @param isInstalled - whether a package name resolves from the profile.
 * @throws HttpError 422 for an invalid operation (unknown id, name guard,
 *  duplicate id, unparsable config).
 */
export function planOperations(
  targets: Map<string, TargetRow>,
  currentRows: PatchRow[],
  ops: Op[],
  dialect: Dialect,
  isInstalled: (packageName: string) => boolean,
): Plan {
  const warnings: Warning[] = []
  // Row state by target id: one patch row per id, keys merged per op.
  const rows = new Map<string, PatchRow>()
  const inserted = new Map<string, { name: string, config?: Record<string, unknown> }>()
  const rowOf = (id: string): PatchRow => {
    const existing = rows.get(id)
    if (existing !== undefined) return existing
    const fresh: PatchRow = { id }
    rows.set(id, fresh)
    return fresh
  }
  // Seed with the current block's id-targeted rows and insert rows.
  for (const row of currentRows) {
    if (typeof row.id === 'string' && row.insert === undefined) rows.set(row.id, { ...row })
    for (const entry of Array.isArray(row.insert) ? row.insert : []) {
      if (typeof entry.id !== 'string') continue
      const config = entry.config
      inserted.set(entry.id, {
        name: String(entry.name),
        ...(isConfigObject(config) ? { config: config as Record<string, unknown> } : {}),
      })
    }
  }
  const targetOf = (id: string): TargetRow => {
    const target = targets.get(id)
    if (target === undefined) throw new HttpError(422, `条目 ${id} 不在组合树中`)
    return target
  }

  for (const op of ops) {
    switch (op.kind) {
      case 'disable': {
        const target = targetOf(op.id)
        if (inserted.has(op.id)) {
          inserted.delete(op.id)
          rows.delete(op.id)
        } else {
          rowOf(op.id).disabled = true
        }
        pushProtection(warnings, target)
        if (target.disabledSource === 'js-expr') {
          warnings.push({ level: 'warn', code: 'FREEZE_JS_EXPR', ids: [op.id], detail: 'disabled' })
        }
        break
      }
      case 'enable': {
        const target = targetOf(op.id)
        rowOf(op.id).disabled = false
        if (target.disabledSource === 'js-expr') {
          warnings.push({ level: 'warn', code: 'FREEZE_JS_EXPR', ids: [op.id], detail: 'disabled' })
        }
        break
      }
      case 'setConfig': {
        const target = targetOf(op.id)
        const parsed = parseConfig(op.config, dialect, op.id)
        const dropped = target.configKeys.filter((key) => !(key in parsed))
        if (dropped.length > 0) {
          warnings.push({ level: 'warn', code: 'CONFIG_FIELD_DROPPED', ids: [op.id], keys: dropped })
        }
        rowOf(op.id).config = parsed
        if (target.jsExprFields.length > 0) {
          warnings.push({ level: 'warn', code: 'FREEZE_JS_EXPR', ids: [op.id], keys: target.jsExprFields })
        }
        break
      }
      case 'insert': {
        assertNewId(op.id, targets, inserted)
        const parsed = op.config !== undefined ? parseConfig(op.config, dialect, op.id) : undefined
        inserted.set(op.id, { name: op.name, ...(parsed !== undefined ? { config: parsed } : {}) })
        rows.delete(op.id)
        break
      }
      case 'swap': {
        const from = targetOf(op.from)
        if (inserted.has(op.from)) {
          inserted.delete(op.from)
          rows.delete(op.from)
        } else {
          rowOf(op.from).disabled = true
          pushProtection(warnings, from)
        }
        if (op.to.id !== undefined && op.to.name === undefined && targets.has(op.to.id)) {
          // An existing row takes over: enable it.
          const target = targets.get(op.to.id)!
          rowOf(op.to.id).disabled = false
          if (target.disabledSource === 'js-expr') {
            warnings.push({ level: 'warn', code: 'FREEZE_JS_EXPR', ids: [op.to.id], detail: 'disabled' })
          }
        } else {
          const id = op.to.id ?? idFromPackageName(op.to.name!)
          const name = op.to.name ?? targets.get(id)?.name
          if (name === undefined) throw new HttpError(422, `swap 目标 ${id} 无法解析包名`)
          // A swap is an atomic replacement: when the target package cannot be
          // inserted, refuse the batch rather than degrade it to a bare
          // disable of the old provider. The install command is the remedy.
          if (!isInstalled(name)) {
            throw new HttpError(422, `swap 目标 ${name} 未安装,无法替换;先运行「dsh plugin --profile <name> add ${name}」再换`)
          }
          assertNewId(id, targets, inserted)
          const toConfig = op.to.config !== undefined ? parseConfig(op.to.config, dialect, id) : undefined
          inserted.set(id, { name, ...(toConfig !== undefined ? { config: toConfig } : {}) })
          rows.delete(id)
        }
        warnings.push({ level: 'info', code: 'KEY_CONFLICT_RISK', ids: [op.from], keys: [op.seam] })
        break
      }
    }
  }

  const out: PatchRow[] = []
  for (const [id, row] of rows) {
    if (inserted.has(id)) continue
    out.push(compact(row))
  }
  if (inserted.size > 0) {
    out.push({ insert: [...inserted].map(([id, spec]) => ({
      id,
      name: spec.name,
      ...(spec.config !== undefined ? { config: spec.config } : {}),
    })) })
  }
  return { rows: out, warnings }
}

/** A config value that is a mapping (the only shape a loader config takes). */
function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A config string → object under the include dialect. @throws 422. */
function parseConfig(text: string, dialect: Dialect, id: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = dialect.load(text)
  } catch (error) {
    throw new HttpError(422, `${id} 的 config 不是合法 YAML:${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(422, `${id} 的 config 必须是映射对象`)
  }
  return parsed as Record<string, unknown>
}

function assertNewId(id: string, targets: Map<string, TargetRow>, inserted: Map<string, unknown>): void {
  if (targets.has(id) || inserted.has(id)) {
    throw new HttpError(422, `条目 id ${id} 已存在;loader 会因重复 id 拒绝整棵树`)
  }
}

function pushProtection(warnings: Warning[], target: TargetRow): void {
  if (target.protected === null) return
  // The danger tier is only ever the editor itself; it gets dedicated prose
  // with the manual-recovery steps instead of the generic boot warning.
  const code: WarningCode = target.protected.tier === 'danger' ? 'SELF_DISABLE' : 'BOOT_CRITICAL'
  warnings.push({ level: target.protected.tier, code, ids: [target.id], detail: target.protected.reason })
}

/** `@deepseek-ai/dsh-web-search-exa` → `web-search-exa`. */
export function idFromPackageName(packageName: string): string {
  return packageName.replace(/^@[\w-]+\//, '').replace(/^dsh-/, '')
}

/** Drop undefined-valued keys so the dumped YAML stays clean. */
function compact(row: PatchRow): PatchRow {
  const out: PatchRow = {}
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) out[key] = value
  }
  return out
}
