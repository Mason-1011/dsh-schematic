/**
 * The blueprint engine: named, shareable compositions of the optional layer.
 * A blueprint is a POSITIVE member list (enabled ∧ unprotected at save time),
 * an explicit Schematic mount bit, plus the world it was saved against; switching materializes that list
 * against the live tree as a batch of the same ops the workbench already
 * speaks, so the preview→apply pipeline stays the only write path. Storage
 * is one YAML file per blueprint under ~/.dsh/schematic/blueprints/ plus a
 * `.current.json` pointer — never the patch file.
 *
 * @module dsh-schematic/compose/blueprints
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { send, sendJson, readJsonBody } from '../http.ts'
import { HttpError } from '../llm.ts'
import { deepEqual, resolveComposition, type Composition, type Dialect } from './layers.ts'
import { buildComposeModel, type ComposeModel, type ModelEntry } from './model.ts'
import { isInstalled } from './catalog.ts'
import { writePatchAtomic } from './block.ts'
import type { Op } from './ops.ts'
import type { ComposeDeps } from './routes.ts'

/** One saved member: the row to (re)create when the blueprint is switched to. */
export interface BlueprintMember {
  id: string
  /** Module specifier — what an absent member is inserted as. */
  name: string
  /** Parsed config value (`{__jsExpr}` nodes survive verbatim); null = none. */
  config: unknown | null
}

/** A blueprint document — one YAML file in the blueprints directory. */
export interface BlueprintDoc {
  schema: 2
  name: string
  desc: string | null
  /** Whether applying this blueprint keeps the Schematic editor mounted. */
  includeSchematic: boolean
  /** ISO timestamp of the (re)capture. */
  savedAt: string
  /** Every entry id in the composed tree at save time (new-entry reference). */
  world: string[]
  members: BlueprintMember[]
}

/** What materializing a blueprint against the live tree reports, beyond the ops. */
export interface MaterializeReport {
  /** Entries that appeared after the blueprint was saved; switching leaves them exactly as they are. */
  newEntries: { id: string, disabled: boolean }[]
  /** Members whose tree entry now resolves to a different package; never touched, only named. */
  renamed: { id: string, was: string, now: string }[]
}

/** The compose.json `blueprint` field: the pointer plus its divergence. */
export interface BlueprintStatus {
  id: string
  name: string
  /** True when materializing now yields any ops (empty batch ⇔ on the blueprint). */
  diverged: boolean
  pendingOps: number
  /** Why a switch back would currently be refused (e.g. a member's package was uninstalled). */
  blocked: string | null
}

/** The list-row summary of one blueprint file. */
export interface BlueprintMeta {
  id: string
  name: string
  desc: string | null
  savedAt: string
  memberCount: number
  includeSchematic: boolean
}

export type BlueprintCapability = 'model' | 'tools' | 'memory' | 'safety' | 'other'

/** Stable, human-facing capability bucket for the blueprint editor. */
export function capabilityOf(entry: ModelEntry): BlueprintCapability {
  const identity = [entry.id, entry.name, entry.groupPath ?? ''].join(' ').toLowerCase()
  const provides = (entry.live?.provides ?? []).join(' ').toLowerCase()
  // Package identity wins over injected services: a tool that consumes `llm`
  // is still a tool, not a model provider. The @deepseek-ai scope itself is
  // intentionally not a model signal.
  if (/\b(tools?|shell|terminal|browser|web-search|github|filesystem|fs)\b/.test(identity)) return 'tools'
  if (/\b(memory|context|compact|knowledge|vector|embed|checkpoint|projection|persistence)\b/.test(identity)) return 'memory'
  if (/\b(permission|approval|policy|guard|auth|credential|sandbox)\b/.test(identity)) return 'safety'
  if (/\b(llm|model|provider|anthropic|openai)\b/.test(identity)) return 'model'
  if (/\b(llm|model)\b/.test(provides)) return 'model'
  if (/\btools?\b/.test(provides)) return 'tools'
  return 'other'
}

/** Blueprint file ids: slug characters only — never separators or dots. */
const BLUEPRINT_ID_RE = /^[a-z0-9一-鿿][a-z0-9一-鿿-]*$/
const OFFICIAL_BLUEPRINT_SEED_MARKER = '.seeded-official-v1.json'
const OFFICIAL_SCHEMATIC_FLAG_MARKER = '.migrated-official-schematic-v1.json'
const OFFICIAL_BLUEPRINT_IDS = ['dsh-native', 'dsh-no-web', 'dsh-minimal'] as const

/** The blueprints directory, sibling of the journal and the patch backups. */
export function defaultBlueprintsDir(): string {
  return join(homedir(), '.dsh', 'schematic', 'blueprints')
}

/** v0.4 storage kept intact as the read-only migration backup. */
export function defaultLegacyPresetsDir(): string {
  return join(homedir(), '.dsh', 'schematic', 'presets')
}

/** name → file id: [a-z0-9] + CJK runs, capped, then a 6-hex name hash for uniqueness. */
export function blueprintIdOf(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-+|-+$/g, '')
  const base = slug === '' ? 'blueprint' : slug.slice(0, 48)
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 6)
  return `${base}-${hash}`
}

/** Validate a blueprint id from the wire (path-traversal safe by construction). */
function safeId(id: string): string {
  if (!BLUEPRINT_ID_RE.test(id)) throw new HttpError(400, `蓝图 id 不合法:${id}`)
  return id
}

/**
 * Capture the live tree as a blueprint: members are the enabled, unprotected
 * entries (the protected tiers are the implicit core — only the dedicated
 * includeSchematic bit may govern a protected entry), the world is every
 * entry id, for post-save new-entry detection.
 * With `pick`, capture becomes curation instead: the members are exactly the
 * picked entries (disabled ones included — picking means "this should be on
 * after a switch"), each with its current config; ids that are protected or
 * absent from the tree land in `skipped` instead of silently vanishing.
 * @param entries - the composed model entries.
 * @param name - user-chosen blueprint name.
 * @param desc - optional description.
 * @param dialect - the include's YAML dialect (`!!js` verbatim).
 * @param pick - optional member ids to curate from (undefined = capture now).
 */
export function captureBlueprint(
  entries: ModelEntry[], name: string, desc: string | null, dialect: Dialect, pick?: string[],
  configById: Record<string, unknown> = {},
  includeSchematic = entries.some((entry) => entry.id === 'schematic' && !entry.disabled),
): { doc: BlueprintDoc, skipped: string[] } {
  const wanted = pick === undefined ? null : new Set(pick)
  const members = entries
    .filter((e) => wanted === null
      ? !e.disabled && e.protected === null
      : wanted.has(e.id) && e.protected === null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      // raw came from dialect.dump; loading it back yields the parsed value
      // (`{__jsExpr}` nodes included), which the blueprint file stores as-is.
      config: Object.hasOwn(configById, e.id)
        ? configById[e.id]
        : e.config === null ? null : dialect.load(e.config.raw),
    }))
  const memberIds = new Set(members.map((m) => m.id))
  // picked but not a member: protected (blueprints never govern them) or unknown id
  const skipped = wanted === null ? [] : [...wanted].filter((id) => !memberIds.has(id))
  return { doc: { schema: 2, name, desc, includeSchematic, savedAt: new Date().toISOString(), world: entries.map((e) => e.id), members }, skipped }
}

/**
 * Materialize a blueprint against the live tree as a workbench op batch:
 * disable enabled non-members the blueprint knows about, align every member
 * (enable / insert / setConfig). Entries absent from the saved world — new
 * since the blueprint was made — are left exactly as they are and named in the
 * report; the same honesty refuses a whole batch whose absent members'
 * packages are no longer installed (the planner would let bare inserts of
 * uninstalled packages through, and the harness would reject the reload).
 * @param doc - the blueprint to switch to.
 * @param entries - the composed model entries.
 * @param dialect - the include's YAML dialect.
 * @param isInstalledFn - whether a package resolves from the profile.
 * @throws HttpError 422 when a member to insert is not installed.
 */
export function materializeBlueprint(
  doc: BlueprintDoc,
  entries: ModelEntry[],
  dialect: Dialect,
  isInstalledFn: (packageName: string) => boolean,
): { ops: Op[], report: MaterializeReport } {
  const ops: Op[] = []
  const report: MaterializeReport = { newEntries: [], renamed: [] }
  const byId = new Map(entries.map((e) => [e.id, e] as const))
  const memberIds = new Set(doc.members.map((m) => m.id))
  const world = new Set(doc.world)

  // Schematic is the one protected entry a blueprint governs explicitly.
  // Keeping it outside `members` preserves the protected-core invariant;
  // this dedicated bit makes the self-hosting consequence impossible to
  // trigger accidentally through ordinary member curation.
  const schematic = byId.get('schematic')
  if (doc.includeSchematic) {
    if (schematic?.disabled === true) ops.push({ kind: 'enable', id: 'schematic' })
    else if (schematic === undefined) {
      if (!isInstalledFn('dsh-schematic')) {
        throw new HttpError(422, '蓝图要求搭载 schematic，但 dsh-schematic 未安装')
      }
      ops.push({ kind: 'insert', id: 'schematic', name: 'dsh-schematic' })
    }
  } else if (schematic !== undefined && !schematic.disabled) {
    ops.push({ kind: 'disable', id: 'schematic' })
  }

  for (const e of entries) {
    if (memberIds.has(e.id) || e.disabled || e.protected !== null || !world.has(e.id)) continue
    ops.push({ kind: 'disable', id: e.id })
  }

  const missing: string[] = []
  for (const m of doc.members) {
    const e = byId.get(m.id)
    if (e === undefined) {
      if (!isInstalledFn(m.name)) missing.push(m.name)
      else {
        ops.push(m.config === null
          ? { kind: 'insert', id: m.id, name: m.name }
          : { kind: 'insert', id: m.id, name: m.name, config: dialect.dump(m.config).trimEnd() })
      }
      continue
    }
    if (e.name !== m.name) {
      // The id now names a different package: the blueprint's opinion of this
      // slot is stale. Touch nothing, name it in the report.
      report.renamed.push({ id: m.id, was: m.name, now: e.name })
      continue
    }
    if (e.disabled) ops.push({ kind: 'enable', id: m.id })
    if (m.config !== null && (e.config === null || !deepEqual(dialect.load(e.config.raw), m.config))) {
      ops.push({ kind: 'setConfig', id: m.id, config: dialect.dump(m.config).trimEnd() })
    }
  }
  if (missing.length > 0) {
    // Same atomicity as a provider swap: refuse the batch rather than degrade
    // it (a bare insert of an uninstalled package would pass the planner and
    // have the harness reject the reload).
    throw new HttpError(422, `蓝图成员未安装:${missing.join('、')};先运行「dsh plugin --profile <name> add <包名>」再切换`)
  }

  for (const e of entries) {
    if (!world.has(e.id)) report.newEntries.push({ id: e.id, disabled: e.disabled })
  }
  return { ops, report }
}

/** Return a new document with selected live, unprotected entries adopted. */
export function adoptBlueprintEntries(
  doc: BlueprintDoc, entries: ModelEntry[], entryIds: string[], dialect: Dialect,
): BlueprintDoc {
  const wanted = new Set(entryIds)
  const world = new Set(doc.world)
  const members = new Map(doc.members.map((member) => [member.id, member] as const))
  for (const entry of entries) {
    if (!wanted.has(entry.id) || entry.protected !== null) continue
    world.add(entry.id)
    if (entry.disabled) members.delete(entry.id)
    else members.set(entry.id, {
      id: entry.id,
      name: entry.name,
      config: entry.config?.value ?? (entry.config === null ? null : dialect.load(entry.config.raw)),
    })
  }
  return { ...doc, savedAt: new Date().toISOString(), world: [...world], members: [...members.values()] }
}

/** Narrow a parsed value into a BlueprintDoc. @throws HttpError 422. */
export function parseBlueprintDoc(value: unknown, legacy = false): BlueprintDoc {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(422, '蓝图必须是映射对象')
  const raw = value as Record<string, unknown>
  if (raw.schema !== (legacy ? 1 : 2)) throw new HttpError(422, `蓝图 schema 必须是 ${legacy ? 1 : 2}`)
  const name = raw.name
  if (typeof name !== 'string' || name.trim() === '' || name.length > 80) throw new HttpError(422, '蓝图 name 必须是 1–80 字符的字符串')
  const desc = raw.desc === undefined || raw.desc === null ? null : raw.desc
  if (desc !== null && (typeof desc !== 'string' || desc.length > 200)) throw new HttpError(422, '蓝图 desc 必须是最多 200 字符的字符串')
  const savedAt = raw.savedAt
  if (typeof savedAt !== 'string' || savedAt === '') throw new HttpError(422, '蓝图 savedAt 必须是非空字符串')
  const world = raw.world
  if (!Array.isArray(world) || world.some((w) => typeof w !== 'string')) throw new HttpError(422, '蓝图 world 必须是字符串数组')
  const membersRaw = raw.members
  if (!Array.isArray(membersRaw)) throw new HttpError(422, '蓝图 members 必须是数组')
  const ids = new Set<string>()
  const members = membersRaw.map((m, index): BlueprintMember => {
    if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new HttpError(422, `members[${index}] 必须是映射对象`)
    const row = m as Record<string, unknown>
    const id = row.id
    const pkgName = row.name
    const config = row.config === undefined ? null : row.config
    if (typeof id !== 'string' || id === '') throw new HttpError(422, `members[${index}].id 必须是非空字符串`)
    if (typeof pkgName !== 'string' || pkgName === '') throw new HttpError(422, `members[${index}].name 必须是非空字符串`)
    if (config !== null && (typeof config !== 'object' || Array.isArray(config))) throw new HttpError(422, `members[${index}].config 必须是映射对象`)
    if (ids.has(id)) throw new HttpError(422, `members 中 id 重复:${id}`)
    ids.add(id)
    return { id, name: pkgName, config }
  })
  const includeSchematic = raw.includeSchematic === undefined ? true : raw.includeSchematic
  if (typeof includeSchematic !== 'boolean') throw new HttpError(422, '蓝图 includeSchematic 必须是布尔值')
  return { schema: 2, name: name.trim(), desc, includeSchematic, savedAt, world, members }
}

export interface BlueprintMigrationResult {
  migrated: string[]
  skipped: string[]
  marker: string | null
}

/**
 * One-way, idempotent schema-1 preset migration. Legacy files are never
 * changed or removed: the old directory is the rollback backup by design.
 */
export function migrateLegacyBlueprints(
  dialect: Dialect,
  legacyDir = defaultLegacyPresetsDir(),
  blueprintDir = defaultBlueprintsDir(),
): BlueprintMigrationResult {
  const marker = join(blueprintDir, '.migrated-from-presets.json')
  if (!existsSync(legacyDir) || existsSync(marker)) return { migrated: [], skipped: [], marker: existsSync(marker) ? marker : null }
  mkdirSync(blueprintDir, { recursive: true })
  const migrated: string[] = []
  const skipped: string[] = []
  for (const file of readdirSync(legacyDir).filter((name) => name.endsWith('.yml')).sort()) {
    const id = file.slice(0, -4)
    if (!BLUEPRINT_ID_RE.test(id) || existsSync(join(blueprintDir, file))) {
      skipped.push(id)
      continue
    }
    try {
      const parsed = dialect.load(readFileSync(join(legacyDir, file), 'utf8'))
      const doc = parseBlueprintDoc(parsed, true)
      writePatchAtomic(join(blueprintDir, file), dialect.dump(doc))
      migrated.push(id)
    } catch {
      skipped.push(id)
    }
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(join(legacyDir, '.current.json'), 'utf8'))
    const id = (raw as { id?: unknown }).id
    if (typeof id === 'string' && BLUEPRINT_ID_RE.test(id) && existsSync(join(blueprintDir, `${id}.yml`))) {
      writePatchAtomic(join(blueprintDir, '.current.json'), `${JSON.stringify({ id }, null, 2)}\n`)
    }
  } catch { /* no valid legacy current pointer */ }
  writePatchAtomic(marker, `${JSON.stringify({ schema: 1, migratedAt: new Date().toISOString(), legacyDir, migrated, skipped }, null, 2)}\n`)
  return { migrated, skipped, marker }
}

/**
 * Blueprint file storage: one YAML doc per `<id>.yml` plus the `.current.json`
 * pointer. The directory is injectable for tests; writes are tmp+rename
 * (writePatchAtomic — the same atomic shape the harness's include uses).
 */
export class BlueprintStore {
  private readonly dir: string
  private readonly dialect: Dialect

  constructor(dir: string, dialect: Dialect) {
    this.dir = dir
    this.dialect = dialect
  }

  /** Every blueprint, newest capture first. Files we did not write (stem not a valid id) are not blueprints. */
  list(): BlueprintMeta[] {
    if (!existsSync(this.dir)) return []
    const metas = readdirSync(this.dir)
      .filter((file) => file.endsWith('.yml') && BLUEPRINT_ID_RE.test(file.slice(0, -4)))
      .map((file): BlueprintMeta => {
        const doc = this.read(file.slice(0, -4))
        return { id: file.slice(0, -4), name: doc.name, desc: doc.desc, savedAt: doc.savedAt, memberCount: doc.members.length, includeSchematic: doc.includeSchematic }
      })
    metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.name.localeCompare(b.name))
    return metas
  }

  /** Read one blueprint. @throws 400 (id shape), 404 (absent), 422 (corrupt). */
  read(id: string): BlueprintDoc {
    const stem = safeId(id)
    const file = join(this.dir, `${stem}.yml`)
    if (!existsSync(file)) throw new HttpError(404, `蓝图 ${id} 不存在`)
    let parsed: unknown
    try {
      parsed = this.dialect.load(readFileSync(file, 'utf8'))
    } catch (error) {
      throw new HttpError(422, `蓝图文件 ${stem}.yml 不是合法 YAML:${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      return parseBlueprintDoc(parsed)
    } catch (error) {
      throw new HttpError(422, `蓝图文件 ${stem}.yml 不合法:${error instanceof HttpError ? error.message : String(error)}`)
    }
  }

  /**
   * Write a blueprint. Without `id` the file id is derived from the name and a
   * same-name save is refused (rename or use the overwrite path); with `id`
   * the existing file is recaptured in place.
   * @returns the list-row summary.
   */
  save(doc: BlueprintDoc, id?: string): BlueprintMeta {
    this.ensureDir()
    const finalId = id === undefined ? safeId(blueprintIdOf(doc.name)) : safeId(id)
    const file = join(this.dir, `${finalId}.yml`)
    if (id === undefined && existsSync(file)) {
      throw new HttpError(422, `同名蓝图已存在(${doc.name});请换个名字,或打开该蓝图用「覆盖保存」`)
    }
    writePatchAtomic(file, this.dialect.dump(doc))
    return { id: finalId, name: doc.name, desc: doc.desc, savedAt: doc.savedAt, memberCount: doc.members.length, includeSchematic: doc.includeSchematic }
  }

  /** Delete one blueprint; deleting the current one clears the pointer with it. @throws 404. */
  remove(id: string): void {
    const stem = safeId(id)
    const file = join(this.dir, `${stem}.yml`)
    if (!existsSync(file)) throw new HttpError(404, `蓝图 ${id} 不存在`)
    rmSync(file)
    if (this.currentId() === id) this.setCurrentId(null)
  }

  /** The current-blueprint pointer, null when absent, malformed, or dangling. */
  currentId(): string | null {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(this.dir, '.current.json'), 'utf8'))
      const id = (raw as { id?: unknown }).id
      if (typeof id !== 'string') return null
      return existsSync(join(this.dir, `${safeId(id)}.yml`)) ? id : null
    } catch {
      return null
    }
  }

  /** Point at a blueprint (must exist) or clear the pointer. */
  setCurrentId(id: string | null): void {
    this.ensureDir()
    if (id === null) {
      try { rmSync(join(this.dir, '.current.json')) } catch { /* absent is already clear */ }
      return
    }
    safeId(id)
    if (!existsSync(join(this.dir, `${id}.yml`))) throw new HttpError(404, `蓝图 ${id} 不存在`)
    writePatchAtomic(join(this.dir, '.current.json'), `${JSON.stringify({ id }, null, 2)}\n`)
  }

  /** The blueprint's YAML text, verbatim (the export payload). @throws 404. */
  yamlOf(id: string): string {
    const file = join(this.dir, `${safeId(id)}.yml`)
    if (!existsSync(file)) throw new HttpError(404, `蓝图 ${id} 不存在`)
    return readFileSync(file, 'utf8')
  }

  private ensureDir(): void {
    try {
      mkdirSync(this.dir, { recursive: true })
    } catch (error) {
      throw new HttpError(503, `蓝图目录不可创建(${this.dir}):${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * One-time normalization for official blueprints created before the
 * includeSchematic field existed. Their descriptions already promised a
 * stock/minimal composition without this editor, so only those three files
 * receive OFF — arbitrary user blueprints keep the backward-compatible ON.
 * An explicit flag is never overwritten.
 */
export function migrateOfficialSchematicFlags(
  dialect: Dialect,
  blueprintDir = defaultBlueprintsDir(),
): string[] {
  const marker = join(blueprintDir, OFFICIAL_SCHEMATIC_FLAG_MARKER)
  if (existsSync(marker)) return []
  mkdirSync(blueprintDir, { recursive: true })
  const migrated: string[] = []
  for (const id of OFFICIAL_BLUEPRINT_IDS) {
    const file = join(blueprintDir, `${id}.yml`)
    if (!existsSync(file)) continue
    try {
      const raw = dialect.load(readFileSync(file, 'utf8'))
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)
        || Object.hasOwn(raw, 'includeSchematic')) continue
      const doc = parseBlueprintDoc(raw)
      writePatchAtomic(file, dialect.dump({ ...doc, includeSchematic: false }))
      migrated.push(id)
    } catch { /* a corrupt official-looking file remains untouched and loud on normal read */ }
  }
  writePatchAtomic(marker, `${JSON.stringify({ schema: 1, migratedAt: new Date().toISOString(), migrated }, null, 2)}\n`)
  return migrated
}

/**
 * The compose.json `blueprint` field: the pointer's name and divergence. An
 * empty materialization ⇔ the live tree already IS the blueprint; a switch the
 * engine would currently refuse is reported as blocked, not hidden.
 */
export function currentBlueprintStatus(store: BlueprintStore, comp: Composition, model: ComposeModel): BlueprintStatus | null {
  const id = store.currentId()
  if (id === null) return null
  const doc = store.read(id)
  try {
    const { ops } = materializeBlueprint(doc, model.entries, comp.dialect, (name) => isInstalled(name, comp.profile.dir))
    return { id, name: doc.name, diverged: ops.length > 0, pendingOps: ops.length, blocked: null }
  } catch (error) {
    if (!(error instanceof HttpError)) throw error
    return { id, name: doc.name, diverged: true, pendingOps: 0, blocked: error.message }
  }
}

/**
 * The editable gate, mirrored from routes.ts's requireEditable (kept here —
 * routes imports this module for the status field; the reverse edge would
 * make a runtime cycle). Also the gate the model tools in ../tools.ts share.
 */
export async function requireEditableComp(ctx: Context, deps: ComposeDeps): Promise<Composition> {
  const comp = await resolveComposition(ctx)
  if (comp.drift !== null) throw new HttpError(503, `组合层与磁盘不一致(${comp.drift}),编辑已锁定;请刷新模型`)
  if (!deps.editConfig.enabled) throw new HttpError(503, '组合编辑已被 config.edit.enabled=false 关闭')
  return comp
}

/** The store for this request, on the default directory. */
export function storeOf(comp: Composition): BlueprintStore {
  migrateLegacyBlueprints(comp.dialect)
  migrateOfficialSchematicFlags(comp.dialect)
  return new BlueprintStore(defaultBlueprintsDir(), comp.dialect)
}

/** Seed the three official starting points once; existing ids are never overwritten. */
export function seedOfficialBlueprints(
  entries: ModelEntry[],
  dialect: Dialect,
  blueprintDir = defaultBlueprintsDir(),
): string[] {
  const marker = join(blueprintDir, OFFICIAL_BLUEPRINT_SEED_MARKER)
  if (existsSync(marker)) return []
  mkdirSync(blueprintDir, { recursive: true })
  const store = new BlueprintStore(blueprintDir, dialect)
  const existing = new Set(store.list().map((item) => item.id))
  const enabledOfficial = entries.filter((entry) => !entry.disabled && (
    entry.name.startsWith('@deepseek-ai/') || entry.origin.label.startsWith('@deepseek-ai/dsh-')
  ))
  const nativeIds = enabledOfficial.map((entry) => entry.id)
  const noWebIds = enabledOfficial
    .filter((entry) => entry.origin.label !== '@deepseek-ai/dsh-web-app')
    .map((entry) => entry.id)
  const minimalId = /^(llm|llm-|agent$|agent-default-model$|agent-loop$|session$|session-title|settings$|credentials$|subprocess$|sandbox|approval$|permission$|shell-env$|tool-(bash|pwsh|fs|fs-search|str-replace-editor)$|fs-observation-policy$|system-prompt$|session-persistence|token-meter$|compaction-basic$)/
  const minimalIds = enabledOfficial.filter((entry) => minimalId.test(entry.id)).map((entry) => entry.id)
  const definitions = [
    {
      id: 'dsh-native', name: 'dsh 原生', ids: nativeIds,
      desc: '官方 dsh Web profile 的原生能力组合；不包含第三方插件和 schematic 自身。',
    },
    {
      id: 'dsh-no-web', name: 'dsh 不带 Web 版', ids: noWebIds,
      desc: '保留 dsh-base 的代理能力，排除 dsh-web-app；在当前页面热切换时，维持编辑器所需的受保护 Web 核心会暂时保留。',
    },
    {
      id: 'dsh-minimal', name: 'dsh 最小可用版本', ids: minimalIds,
      desc: '仅保留完成一次基本代理任务所需的模型、会话、执行、安全、文件与上下文能力。',
    },
  ]
  const seeded: string[] = []
  for (const definition of definitions) {
    if (existing.has(definition.id)) continue
    const { doc } = captureBlueprint(entries, definition.name, definition.desc, dialect, definition.ids, {}, false)
    store.save(doc, definition.id)
    seeded.push(definition.id)
  }
  writePatchAtomic(marker, `${JSON.stringify({ schema: 1, seededAt: new Date().toISOString(), seeded }, null, 2)}\n`)
  return seeded
}

/** Read `{id}` from a blueprint POST body. @throws 400. */
function readIdBody(body: unknown): string {
  const id = (body as { id?: unknown } | null)?.id
  if (typeof id !== 'string' || id === '') throw new HttpError(400, 'id 必须是非空字符串')
  return id
}

/**
 * The shared save body: validate the fields (unknowns in, 400s out — the
 * HTTP handler and the schematic_blueprint_save tool both land here), then
 * capture or curate and write the file. `id` recaptures an existing blueprint
 * in place (the update path); without it a same-name save is refused.
 */
export async function saveBlueprintCore(
  ctx: Context, deps: ComposeDeps,
  input: { name: unknown, desc: unknown, includeSchematic?: unknown, memberIds?: unknown, memberConfigs?: unknown, memberConfigYaml?: unknown, id?: string },
): Promise<{ blueprint: BlueprintMeta, skipped: string[] }> {
  if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > 80) {
    throw new HttpError(400, 'name 必须是 1–80 字符的字符串')
  }
  if (input.desc !== undefined && input.desc !== null && (typeof input.desc !== 'string' || input.desc.length > 200)) {
    throw new HttpError(400, 'desc 必须是最多 200 字符的字符串')
  }
  if (input.includeSchematic !== undefined && typeof input.includeSchematic !== 'boolean') {
    throw new HttpError(400, 'includeSchematic 必须是布尔值')
  }
  let memberIds: string[] | undefined
  if (input.memberIds !== undefined && input.memberIds !== null) {
    if (!Array.isArray(input.memberIds) || input.memberIds.length > 500 || input.memberIds.some((m) => typeof m !== 'string' || m === '')) {
      throw new HttpError(400, 'memberIds 必须是最多 500 个非空字符串的数组')
    }
    memberIds = [...new Set(input.memberIds)]
  }
  let memberConfigs: Record<string, unknown> = {}
  if (input.memberConfigs !== undefined && input.memberConfigs !== null) {
    if (typeof input.memberConfigs !== 'object' || Array.isArray(input.memberConfigs)) {
      throw new HttpError(400, 'memberConfigs 必须是 id 到配置对象的映射')
    }
    memberConfigs = input.memberConfigs as Record<string, unknown>
    if (Object.values(memberConfigs).some((value) => value !== null && (typeof value !== 'object' || Array.isArray(value)))) {
      throw new HttpError(400, 'memberConfigs 的值必须是配置对象或 null')
    }
  }
  const comp = await requireEditableComp(ctx, deps)
  if (input.memberConfigYaml !== undefined && input.memberConfigYaml !== null) {
    if (typeof input.memberConfigYaml !== 'object' || Array.isArray(input.memberConfigYaml)) {
      throw new HttpError(400, 'memberConfigYaml 必须是 id 到 YAML 的映射')
    }
    for (const [id, yaml] of Object.entries(input.memberConfigYaml as Record<string, unknown>)) {
      if (typeof yaml !== 'string') throw new HttpError(400, `memberConfigYaml.${id} 必须是字符串`)
      let value: unknown
      try { value = comp.dialect.load(yaml) } catch (error) {
        throw new HttpError(422, `${id} 的 YAML 无效:${error instanceof Error ? error.message : String(error)}`)
      }
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        throw new HttpError(422, `${id} 的配置 YAML 必须是映射或 null`)
      }
      memberConfigs[id] = value
    }
  }
  const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
  const desc = typeof input.desc === 'string' ? input.desc : null
  const { doc, skipped } = captureBlueprint(
    model.entries, input.name.trim(), desc, comp.dialect, memberIds, memberConfigs,
    input.includeSchematic as boolean | undefined,
  )
  return { blueprint: storeOf(comp).save(doc, input.id), skipped }
}

/**
 * The shared materialize body: read the blueprint and diff it against the live
 * tree as a workbench op batch. Pure compute — the write still belongs to
 * compose/apply (HTTP) or the switch tool's own apply pipeline.
 */
export async function materializeCore(
  ctx: Context, deps: ComposeDeps, id: string, decisions: unknown = undefined,
): Promise<{ id: string, name: string, ops: Op[], report: MaterializeReport, adopted: string[] }> {
  const comp = await requireEditableComp(ctx, deps)
  const store = storeOf(comp)
  let doc = store.read(id)
  const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
  const choice = new Map<string, 'keep' | 'disable' | 'include'>()
  if (decisions !== undefined && decisions !== null) {
    if (typeof decisions !== 'object' || Array.isArray(decisions)) throw new HttpError(400, 'decisions 必须是映射')
    for (const [entryId, value] of Object.entries(decisions as Record<string, unknown>)) {
      if (value !== 'keep' && value !== 'disable' && value !== 'include') throw new HttpError(400, `decisions.${entryId} 无效`)
      choice.set(entryId, value)
    }
  }
  const byId = new Map(model.entries.map((entry) => [entry.id, entry] as const))
  const adopted = [...choice].filter(([, value]) => value === 'include').map(([entryId]) => entryId)
  if (adopted.length > 0) doc = adoptBlueprintEntries(doc, model.entries, adopted, comp.dialect)
  const { ops, report } = materializeBlueprint(doc, model.entries, comp.dialect, (name) => isInstalled(name, comp.profile.dir))
  for (const [entryId, value] of choice) {
    const entry = byId.get(entryId)
    if (value === 'disable' && entry !== undefined && !entry.disabled && entry.protected === null
      && !ops.some((op) => op.kind === 'disable' && op.id === entryId)) ops.push({ kind: 'disable', id: entryId })
  }
  return { id, name: doc.name, ops, report, adopted }
}

/**
 * GET /schematic/blueprints — the list. Divergence of the current blueprint rides
 * compose.json's `blueprint` field (computed on the same refresh cycle), not here.
 * @param ctx - live Cordis context.
 * @param res - the HTTP response.
 * @param deps - edit config and the reload-failure map.
 */
export async function handleBlueprintsGet(ctx: Context, res: ServerResponse, deps: ComposeDeps): Promise<void> {
  const comp = await resolveComposition(ctx)
  const store = storeOf(comp)
  if (!existsSync(join(defaultBlueprintsDir(), OFFICIAL_BLUEPRINT_SEED_MARKER))) {
    seedOfficialBlueprints(buildComposeModel(ctx, comp, deps.editConfig.protected).entries, comp.dialect)
  }
  sendJson(res, 200, { blueprints: store.list() })
}

/** GET /schematic/blueprints/detail?id= — editable document plus capability metadata. */
export async function handleBlueprintDetail(ctx: Context, url: URL, res: ServerResponse, deps: ComposeDeps): Promise<void> {
  const comp = await resolveComposition(ctx)
  const store = storeOf(comp)
  const id = url.searchParams.get('id') ?? ''
  const document = store.read(id)
  const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
  const entries = model.entries.map((entry) => ({
    ...entry,
    capability: capabilityOf(entry),
  }))
  const world = new Set(document.world)
  const unmanaged = entries.filter((entry) => !world.has(entry.id) && entry.protected === null)
    .map((entry) => ({ id: entry.id, name: entry.name, disabled: entry.disabled, capability: entry.capability }))
  const memberYaml = Object.fromEntries(document.members.map((member) => [
    member.id,
    member.config === null ? '' : comp.dialect.dump(member.config).trimEnd(),
  ]))
  return sendJson(res, 200, { id, document, memberYaml, entries, unmanaged })
}

/**
 * GET /schematic/blueprints/export?id= — one blueprint's YAML text.
 */
export async function handleBlueprintsExport(ctx: Context, url: URL, res: ServerResponse, deps: ComposeDeps): Promise<void> {
  const comp = await resolveComposition(ctx)
  send(res, 200, 'text/yaml; charset=utf-8', storeOf(comp).yamlOf(url.searchParams.get('id') ?? ''))
}

/**
 * POST /schematic/blueprints/* — save (capture the live tree), update
 * (recapture over an existing id), materialize (pure compute, never writes),
 * current (set/clear the pointer), delete, import (validate foreign YAML).
 * save/update/materialize additionally gate on composition drift; every
 * patch-file write still happens only through compose/apply.
 * @param ctx - live Cordis context.
 * @param req - the HTTP request (JSON body).
 * @param sub - the sub-path under /schematic.
 * @param res - the HTTP response.
 * @param deps - edit config and the reload-failure map.
 */
export async function handleBlueprintsPost(
  ctx: Context, req: IncomingMessage, sub: string, res: ServerResponse, deps: ComposeDeps,
): Promise<void> {
  const action = sub.slice('/blueprints/'.length)
  const body = await readJsonBody(req)

  if (action === 'save') {
    const raw = body as { id?: unknown, name?: unknown, desc?: unknown, includeSchematic?: unknown, memberIds?: unknown, memberConfigs?: unknown, memberConfigYaml?: unknown } | null
    if (raw?.id !== undefined && (typeof raw.id !== 'string' || raw.id === '')) throw new HttpError(400, 'id 必须是非空字符串')
    return sendJson(res, 200, await saveBlueprintCore(ctx, deps, {
      name: raw?.name, desc: raw?.desc, includeSchematic: raw?.includeSchematic, memberIds: raw?.memberIds, memberConfigs: raw?.memberConfigs,
      memberConfigYaml: raw?.memberConfigYaml, id: raw?.id as string | undefined,
    }))
  }

  if (action === 'duplicate') {
    const id = readIdBody(body)
    const name = (body as { name?: unknown }).name
    if (typeof name !== 'string' || name.trim() === '' || name.length > 80) throw new HttpError(400, 'name 必须是 1–80 字符的字符串')
    const comp = await requireEditableComp(ctx, deps)
    const store = storeOf(comp)
    const doc = store.read(id)
    const requested = (body as { includeSchematic?: unknown }).includeSchematic
    if (requested !== undefined && typeof requested !== 'boolean') throw new HttpError(400, 'includeSchematic 必须是布尔值')
    return sendJson(res, 200, { blueprint: store.save({ ...doc, name: name.trim(), includeSchematic: requested ?? doc.includeSchematic, savedAt: new Date().toISOString() }) })
  }

  if (action === 'rename') {
    const id = readIdBody(body)
    const name = (body as { name?: unknown }).name
    if (typeof name !== 'string' || name.trim() === '' || name.length > 80) throw new HttpError(400, 'name 必须是 1–80 字符的字符串')
    const comp = await requireEditableComp(ctx, deps)
    const store = storeOf(comp)
    const doc = store.read(id)
    return sendJson(res, 200, { blueprint: store.save({ ...doc, name: name.trim(), savedAt: new Date().toISOString() }, id) })
  }

  if (action === 'update') {
    const id = readIdBody(body)
    const comp = await requireEditableComp(ctx, deps)
    const old = storeOf(comp).read(id)
    return sendJson(res, 200, await saveBlueprintCore(ctx, deps, { name: old.name, desc: old.desc, includeSchematic: old.includeSchematic, id }))
  }

  if (action === 'materialize') {
    return sendJson(res, 200, await materializeCore(ctx, deps, readIdBody(body), (body as { decisions?: unknown }).decisions))
  }

  if (action === 'adopt') {
    const id = readIdBody(body)
    const entryIds = (body as { entryIds?: unknown }).entryIds
    if (!Array.isArray(entryIds) || entryIds.some((entryId) => typeof entryId !== 'string' || entryId === '')) {
      throw new HttpError(400, 'entryIds 必须是非空字符串数组')
    }
    const comp = await requireEditableComp(ctx, deps)
    const store = storeOf(comp)
    const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
    const doc = adoptBlueprintEntries(store.read(id), model.entries, [...new Set(entryIds)], comp.dialect)
    return sendJson(res, 200, { blueprint: store.save(doc, id) })
  }

  if (action === 'current') {
    if (!deps.editConfig.enabled) throw new HttpError(503, '组合编辑已被 config.edit.enabled=false 关闭')
    const comp = await resolveComposition(ctx)
    const store = storeOf(comp)
    const raw = (body as { id?: unknown } | null)?.id
    if (raw !== null && typeof raw !== 'string') throw new HttpError(400, 'id 必须是字符串或 null')
    store.setCurrentId(raw)
    const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
    return sendJson(res, 200, { blueprint: currentBlueprintStatus(store, comp, model) })
  }

  if (action === 'delete') {
    if (!deps.editConfig.enabled) throw new HttpError(503, '组合编辑已被 config.edit.enabled=false 关闭')
    const comp = await resolveComposition(ctx)
    const id = readIdBody(body)
    storeOf(comp).remove(id)
    return sendJson(res, 200, { deleted: id })
  }

  if (action === 'import') {
    if (!deps.editConfig.enabled) throw new HttpError(503, '组合编辑已被 config.edit.enabled=false 关闭')
    const comp = await resolveComposition(ctx)
    const text = (body as { yaml?: unknown } | null)?.yaml
    if (typeof text !== 'string' || text.trim() === '') throw new HttpError(400, 'yaml 必须是非空字符串')
    let parsed: unknown
    try {
      parsed = comp.dialect.load(text)
    } catch (error) {
      throw new HttpError(400, `YAML 解析失败:${error instanceof Error ? error.message : String(error)}`)
    }
    const doc = parseBlueprintDoc(parsed)
    // A foreign doc gets a fresh identity here; only its name can collide.
    const saved = storeOf(comp).save({ ...doc, savedAt: new Date().toISOString() })
    return sendJson(res, 200, { blueprint: saved })
  }

  sendJson(res, 404, { error: `unknown blueprints endpoint: ${sub}` })
}
