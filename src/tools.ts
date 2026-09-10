/**
 * The model's blueprint workbench: the same cores the HTTP routes use, exposed
 * as dsh agent tools so a user can curate and switch wiring blueprints in
 * conversation. Capability, not observation edge — every call flows through
 * the harness's own tool pipeline and lands in the activity timeline
 * attributed to this plugin, honestly; nothing here writes session logs.
 *
 * Switching is the one side-effecting tool: it runs the exact apply pipeline
 * the browser's Apply button runs (dry-run preview, base freeze, full-file
 * backup, atomic write, harness hot reload), then watches the reload-failure
 * map for ~3s. A conversation has no banner, so the tool owes the model the
 * outcome — including the rollback path when the harness refuses the reload.
 *
 * All imports from @deepseek-ai/dsh-tools are type-only (erased by the
 * build); dist stays node-builtins-only at runtime, as it has always been.
 *
 * @module dsh-schematic/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { buildGraph } from './graph.ts'
import { HttpError } from './llm.ts'
import { isInstalled } from './compose/catalog.ts'
import type { Composition } from './compose/layers.ts'
import { buildComposeModel } from './compose/model.ts'
import { buildPreview } from './compose/preview.ts'
import { readPatchFile, writePatchAtomic } from './compose/block.ts'
import { defaultBackupDir, makeBackup } from './compose/backup.ts'
import type { ComposeDeps, UpdateFailure } from './compose/routes.ts'
import {
  currentBlueprintStatus, materializeBlueprint, requireEditableComp, saveBlueprintCore, storeOf,
} from './compose/blueprints.ts'

/** How long the switch tool waits for a hot-reload rejection before calling the reload clean. */
const RELOAD_WATCH_MS = 3_000
/** Poll cadence of that watch. */
const RELOAD_POLL_MS = 250

/** One JSON-Schema string node with a description (the subset the registry enforces). */
const str = (description: string): { type: 'string', description: string } => ({ type: 'string', description })

/** Render one tool value as indented JSON (the cordis_inspect_list precedent). */
const renderJson = (_args: unknown, value: unknown): { type: 'text', text: string }[] =>
  [{ type: 'text', text: JSON.stringify(value, null, 2) }]

/** Read `{id?|name?}` from tool args and resolve it to a blueprint id. @throws 400/404. */
async function resolveBlueprintArg(ctx: Context, deps: ComposeDeps, args: unknown): Promise<{ comp: Composition, id: string }> {
  const raw = args as { id?: unknown, name?: unknown } | null
  const hasId = raw?.id !== undefined && raw?.id !== null
  const hasName = raw?.name !== undefined && raw?.name !== null
  if (hasId === hasName) throw new HttpError(400, 'id 与 name 必须恰好给一个')
  const comp = await requireEditableComp(ctx, deps)
  const store = storeOf(comp)
  if (hasId) {
    if (typeof raw?.id !== 'string' || raw.id === '') throw new HttpError(400, 'id 必须是非空字符串')
    return { comp, id: raw.id }
  }
  if (typeof raw?.name !== 'string' || raw.name === '') throw new HttpError(400, 'name 必须是非空字符串')
  const hit = store.list().find((p) => p.name === raw.name)
  if (hit === undefined) throw new HttpError(404, `没有叫 ${raw.name} 的蓝图`)
  return { comp, id: hit.id }
}

/**
 * Switch the live wiring to a blueprint: materialize → preview → freeze →
 * backup → write → hot reload, then watch the failure map. Mirrors
 * handleApply in routes.ts step for step (minus the HTTP staleness dance —
 * the comp here was resolved this call, and the base freeze still compares
 * bytes on disk before writing).
 */
async function switchBlueprintCore(
  ctx: Context, deps: ComposeDeps, comp: Composition, id: string, signal: AbortSignal | undefined,
  confirmSchematicOff: boolean,
): Promise<Record<string, unknown>> {
  const store = storeOf(comp)
  const doc = store.read(id)
  const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
  const { ops, report } = materializeBlueprint(doc, model.entries, comp.dialect,
    (name) => isInstalled(name, comp.profile.dir))

  if (ops.length === 0) {
    store.setCurrentId(id)
    return { switched: false, alreadyOn: true, blueprint: doc.name, report }
  }

  const preview = buildPreview(ctx, comp, ops, deps.editConfig.protected)
  // Belt and braces: blueprint ops only ever touch unprotected entries, so a
  // danger-tier warning here means the protected config changed under us.
  const danger = preview.warnings.filter((w) => w.level === 'danger'
    && !(confirmSchematicOff && w.ids?.every((id) => id === 'schematic')))
  if (danger.length > 0) {
    throw new HttpError(422, `预览出现危险级警告,拒绝切换:${danger.map((w) => w.detail ?? w.code).join('、')}`)
  }

  // Freeze the base, exactly like handleApply.
  const onDisk = readPatchFile(comp.profile.patchPath)
  if (onDisk !== comp.userText) {
    throw new HttpError(409, '补丁文件已被其他写入修改,拒绝切换(以磁盘为准重新发起)')
  }

  const startedAt = Date.now()
  const backupFile = makeBackup(comp.profile.patchPath, deps.editConfig.backupDir ?? defaultBackupDir(), deps.editConfig.backupKeep, 'apply')
  writePatchAtomic(comp.profile.patchPath, preview.filePreview)

  // The harness emits no success event; a failure it does emit names the
  // bytes it refused. Only failures recorded after our write count — a stale
  // entry describes bytes that no longer exist.
  let failure: UpdateFailure | null = null
  for (let waited = 0; failure === null && waited < RELOAD_WATCH_MS; waited += RELOAD_POLL_MS) {
    if (signal?.aborted) break
    await new Promise((resolve) => setTimeout(resolve, RELOAD_POLL_MS))
    const seen = deps.updateFailures.get(comp.profile.patchPath)
    if (seen !== undefined && seen.time >= startedAt) failure = seen
  }

  if (failure === null) {
    store.setCurrentId(id)
    return {
      switched: true, blueprint: doc.name, appliedOps: ops.length,
      disable: ops.filter((o) => o.kind === 'disable').length,
      enable: ops.filter((o) => o.kind === 'enable' || o.kind === 'insert').length,
      setConfig: ops.filter((o) => o.kind === 'setConfig').length,
      report, backup: backupFile,
      reload: 'hot reload issued; no failure recorded within the watch window',
    }
  }
  // Conversation-side switches have no recovery drawer. Restore the exact
  // pre-write bytes immediately. The attribution pointer has not moved yet,
  // so a rejected switch preserves the previously active blueprint as well.
  writePatchAtomic(comp.profile.patchPath, comp.userText)
  await new Promise((resolve) => setTimeout(resolve, RELOAD_POLL_MS * 3))
  return {
    switched: false, rolledBack: true, blueprint: doc.name, appliedOps: ops.length, backup: backupFile, report,
    reload: `REJECTED BY HARNESS: ${failure.message}`,
    note: 'automatic rollback restored the pre-switch patch bytes; the previous plugin tree remains authoritative',
  }
}

/**
 * Build the four schematic tools. Exposed (not just registered) so the test
 * suite can assert the definitions against the registry's own schema rules
 * without standing up a Cordis context.
 */
export function blueprintToolDefs(ctx: Context, deps: ComposeDeps): ToolDefinition[] {
  const plugins: ToolDefinition = {
    name: 'schematic_plugins',
    description:
      'List every entry in the DeepSeek Harness composition tree of the running profile: '
      + '{id, package, disabled, protected, provides, inject}. Use this to pick memberIds for '
      + 'schematic_blueprint_save. protected is the tier guarding the entry ("danger" | "warn" | null): '
      + 'protected entries are the implicit core — they never join memberIds; only the blueprint-level '
      + 'includeSchematic switch may explicitly govern the editor itself. A currently disabled entry CAN be picked: picking '
      + 'means "this should be on after a switch", so a switch re-enables it with its saved config. '
      + 'provides/inject are live wiring cross-references (empty for disabled entries — they are not mounted).',
    parameters: { type: 'object', properties: {} },
    output: { schema: {}, render: renderJson },
    execute: async () => {
      const comp = await requireEditableComp(ctx, deps)
      const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
      const liveById = new Map(buildGraph(ctx).nodes.map((n) => [n.id.replace(/^include:/, ''), n]))
      return {
        profile: comp.profile.name,
        entries: model.entries.map((e) => {
          const node = liveById.get(e.id)
          return {
            id: e.id,
            package: e.name,
            disabled: e.disabled,
            protected: e.protected === null ? null : e.protected.tier,
            provides: node?.provides ?? [],
            inject: node?.inject ?? [],
          }
        }),
      }
    },
  }

  const list: ToolDefinition = {
    name: 'schematic_blueprint_list',
    description:
      'List the saved wiring blueprints of the running profile, plus the current one and its divergence '
      + '(blueprint.diverged / blueprint.pendingOps: the live tree drifted from the saved member list by that '
      + 'many operations; switching back returns exactly those). blueprint.blocked names why a switch would '
      + 'currently be refused (e.g. a member package is no longer installed).',
    parameters: { type: 'object', properties: {} },
    output: { schema: {}, render: renderJson },
    execute: async () => {
      const comp = await requireEditableComp(ctx, deps)
      const store = storeOf(comp)
      const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
      return { blueprints: store.list(), blueprint: currentBlueprintStatus(store, comp, model) }
    },
  }

  const save: ToolDefinition = {
    name: 'schematic_blueprint_save',
    description:
      'Save a wiring blueprint for the running profile. Omit memberIds to capture the CURRENT wiring '
      + '(the enabled, unprotected entries — same as the UI\'s "save current wiring"). Pass memberIds '
      + '(ids from schematic_plugins) to curate a member list instead: picked entries join even if '
      + 'currently disabled, each with its current config, and everything else is what a switch would '
      + 'disable. Ids that are protected or unknown come back in skipped (refused, not silently '
      + 'dropped) — drop them and re-save. includeSchematic explicitly controls whether the visual '
      + 'editor remains mounted; it defaults to the current running state. Blueprint names are unique: a duplicate name is refused; '
      + 'pick a new name. Switching happens only via schematic_blueprint_switch.',
    parameters: {
      type: 'object',
      properties: {
        name: str('Blueprint name, 1–80 characters. Must not collide with an existing blueprint name.'),
        desc: str('Optional description, at most 200 characters.'),
        includeSchematic: {
          type: 'boolean',
          description: 'Whether applying this blueprint keeps dsh-schematic mounted. Defaults to its current running state.',
        },
        memberIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional curated member entry ids (from schematic_plugins). Omit to capture the current wiring.',
        },
      },
      required: ['name'],
    },
    output: {
      schema: {},
      render: (_args, value) => {
        const v = value as { blueprint?: { name?: string, memberCount?: number }, skipped?: string[] }
        const parts = [`Saved blueprint "${v.blueprint?.name}" (${v.blueprint?.memberCount} members).`]
        const skipped = v.skipped ?? []
        if (skipped.length > 0) parts.push(`Skipped (protected or unknown): ${skipped.join(', ')}.`)
        return [{ type: 'text', text: parts.join(' ') }]
      },
    },
    execute: async (args) => {
      const raw = args as { name?: unknown, desc?: unknown, includeSchematic?: unknown, memberIds?: unknown } | null
      if (typeof raw?.name !== 'string') throw new HttpError(400, 'name 必须是字符串')
      const { blueprint, skipped } = await saveBlueprintCore(ctx, deps, {
        name: raw.name, desc: raw?.desc, includeSchematic: raw?.includeSchematic, memberIds: raw?.memberIds,
      })
      return { blueprint, skipped, hint: 'switch to it with schematic_blueprint_switch' }
    },
  }

  const switchTool: ToolDefinition = {
    name: 'schematic_blueprint_switch',
    description:
      'Switch the live plugin wiring of the running profile to a saved blueprint (by id or name). This '
      + 'runs the same pipeline the schematic UI\'s Apply runs: dry-run preview, full-file backup, '
      + 'atomic patch write, harness hot reload — then reports the reload outcome. Protected entries '
      + 'are never touched except the blueprint-level includeSchematic switch. Entries saved into the blueprint after it was made (new entries) are left '
      + 'exactly as they are and named in the report. If the harness rejects the reload, the previous '
      + 'tree keeps running and the result says so with the rollback path. Confirm the blueprint choice '
      + 'with the user before switching — it changes what the harness runs.',
    parameters: {
      type: 'object',
      properties: {
        id: str('Blueprint id from schematic_blueprint_list. Give exactly one of id / name.'),
        name: str('Blueprint name. Give exactly one of id / name.'),
        confirmSchematicOff: {
          type: 'boolean',
          description: 'Must be true when the target blueprint disables Schematic. Confirm with the user first; the current editor/tool surface will go offline.',
        },
      },
    },
    output: {
      schema: {},
      render: (_args, value) => {
        const v = value as Record<string, unknown>
        if (v.alreadyOn === true) return [{ type: 'text', text: `Already on blueprint "${v.blueprint}"; pointer refreshed, nothing written.` }]
        if (v.rolledBack === true) return [{ type: 'text', text: `Blueprint "${v.blueprint}" was rejected and automatically rolled back. ${v.reload} ${v.note}` }]
        const lines = [`Switched to blueprint "${v.blueprint}": ${v.appliedOps} ops applied, backup ${v.backup}.`]
        lines.push(`Reload: ${v.reload}`)
        if (typeof v.note === 'string') lines.push(v.note)
        return [{ type: 'text', text: lines.join(' ') }]
      },
    },
    execute: async (args, exec) => {
      const { comp, id } = await resolveBlueprintArg(ctx, deps, args)
      const confirm = (args as { confirmSchematicOff?: unknown } | null)?.confirmSchematicOff
      if (confirm !== undefined && typeof confirm !== 'boolean') throw new HttpError(400, 'confirmSchematicOff 必须是布尔值')
      return await switchBlueprintCore(ctx, deps, comp, id, exec.signal, confirm === true)
    },
  }

  return [plugins, list, save, switchTool]
}

/**
 * Register the four schematic tools. Register nothing (and say so once) when
 * edit is disabled — the tools write through the same config gate as the UI.
 * Registration is fiber-scoped: the disposers are effects on our fiber, so
 * HMR/dispose retracts the tools with the plugin. ctx.tools is typed by
 * dsh-tools' module augmentation (it travels with the type-only import);
 * the service is core — the 'tools' inject in index.ts fails fast if it vanishes.
 */
export function registerBlueprintTools(ctx: Context, deps: ComposeDeps): void {
  if (!deps.editConfig.enabled) {
    ctx.logger.info('[dsh-schematic] edit disabled (config.edit.enabled=false); model tools not registered')
    return
  }
  for (const def of blueprintToolDefs(ctx, deps)) {
    ctx.effect(() => ctx.tools.register(def), `dsh-schematic: tool ${def.name}`)
  }
}
