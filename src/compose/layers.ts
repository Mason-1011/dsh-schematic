/**
 * Composition resolution: locate the running profile from the live loader,
 * re-read every patch layer, and split the live flattened patch list into
 * (known prefix, frozen overlay tail). The single source of truth for "what
 * is composed, from which layer" — every compose endpoint builds on it.
 *
 * The harness packages needed for an offline recomposition
 * (`@deepseek-ai/dsh-app-boot`, `@deepseek-ai/cordis-plugin-include`,
 * `js-yaml`) are resolved through ONE anchor — the profile directory — the
 * same parent-walk the launcher's own fallback anchor uses (profile
 * node_modules, then the healed `~/.dsh/profiles/node_modules`). No static
 * imports: a dev checkout symlinked into a profile realpath-escapes it, so
 * `import.meta.url`-anchored resolution would miss; the profile anchor is
 * correct in every layout and keeps the host bundle free of new imports.
 *
 * @module dsh-schematic/compose/layers
 */

import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { HttpError } from '../llm.ts'

/** A loader patch row, exactly as `cordis-plugin-include` defines it. */
export interface PatchRow {
  id?: string
  insert?: PatchEntry[]
  name?: string
  [key: string]: unknown
}

/** An inserted entry (one row of an `insert` list, or of the composed tree). */
export interface PatchEntry {
  id?: string
  name: string
  group?: unknown
  config?: unknown
  disabled?: unknown
  [key: string]: unknown
}

/** The root Include entry's slice as mounted by the dsh launcher. */
interface RootIncludeEntry {
  options: {
    id: string
    name: string
    config?: { path?: string, patches?: PatchRow[] }
  }
}

/** Structural slice of the loader service (out-of-tree: no type import). */
interface LoaderSlice {
  entries(): Iterable<{ options: { id: string } } & RootIncludeEntry>
}

/** The YAML dialect handle: parse and print with the include's own schema. */
export interface Dialect {
  /** Parse text; `!!js` scalars come back as `{ __jsExpr }` nodes. Throws on invalid YAML. */
  load(text: string): unknown
  /** Serialize with `!!js` round-tripped verbatim. */
  dump(value: unknown): string
}

/** One bundle layer in `dsh.profile.bundles` order. */
export interface LayerInfo {
  kind: 'bundle' | 'user' | 'home' | 'overlay'
  label: string
  rows: number
}

/** One layer's patch rows, in application order (the provenance source). */
export interface LayerPatches {
  kind: LayerInfo['kind']
  label: string
  patches: PatchRow[]
}

/**
 * A resolved composition. `composeWith` recomposes the whole tree offline —
 * byte-identical in semantics to what the launcher/HMR path mounts.
 */
export interface Composition {
  profile: { name: string, dir: string, patchPath: string }
  /** sha256 of the user patch file's current bytes; the staleness token. */
  hash: string
  bytes: number
  mtime: number
  /** The user patch file's raw text (bytes outside our markers are untouchable). */
  userText: string
  userPatches: PatchRow[]
  homePatches: PatchRow[]
  /** Launcher layers above the user layers, frozen for the process lifetime. */
  overlays: PatchRow[]
  /** Every layer in application order with its patch rows (provenance source). */
  layerPatches: LayerPatches[]
  /** Every layer in application order, with row counts for the UI. */
  layers: LayerInfo[]
  dialect: Dialect
  /** The loader's app-boot module (loadProfile/composeEntries/…), lazily imported. */
  boot: BootModule
  /**
   * Non-null when the live flattened list no longer matches the on-disk
   * layers (bundle updated under the process, composition changed elsewhere):
   * the model is served read-only, never edited from a wrong base.
   */
  drift: string | null
  /** First differing patch row when drift: {index, expected, live}, else null. */
  driftDetail: { index: number, expected: unknown, live: unknown } | null
  /** Recompose the full entry tree over the given user-layer rows. */
  composeWith(userPatches: PatchRow[]): PatchEntry[]
}

/** The app-boot slices the compose endpoints use. */
export interface BootModule {
  loadProfile: (binName: string, name: string, installAnchor: string) => {
    name: string
    dir: string
    patchPath: string
    layers: { packageName: string, patches: PatchRow[] }[]
  }
  loadOptionalPatches: (binName: string, file: string) => PatchRow[] | undefined
  composeEntries: (layers: readonly PatchRow[][], warn?: (message: string) => void) => PatchEntry[]
}

/** Structural equality over parsed patch data (plain values, arrays, `__jsExpr` objects). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  for (const key of ka) {
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}

/** Cache of profile-anchored module imports; the modules never change under us. */
interface DialectModules {
  yaml: { load(text: string, opts: { schema: unknown }): unknown, dump(value: unknown, opts: { schema: unknown, noRefs: boolean, lineWidth: number }): string }
  schema: unknown
  boot: BootModule
}
let modulesCache: { profileDir: string, mods: DialectModules } | null = null

/** Pick a CJS/ESM namespace or its `.default`, whichever carries the member. */
function pickNamespace<T, K extends keyof T>(namespace: T & { default?: T }, member: K): T {
  const has = (holder: T): boolean =>
    holder !== null && typeof holder === 'object' && (holder as Record<string, unknown>)[member as string] !== undefined
  if (has(namespace)) return namespace
  if (namespace.default !== undefined && has(namespace.default)) return namespace.default
  throw new HttpError(503, `组合层依赖加载异常:缺少 ${String(member)}`)
}

async function loadModules(profileDir: string): Promise<DialectModules> {
  if (modulesCache?.profileDir === profileDir) return modulesCache.mods
  const require = createRequire(join(profileDir, 'package.json'))
  const importSpec = async (spec: string): Promise<unknown> => import(pathToFileURL(require.resolve(spec)).href)
  const yaml = pickNamespace(
    await importSpec('js-yaml') as DialectModules['yaml'] & { default?: DialectModules['yaml'] }, 'load')
  const include = pickNamespace(
    await importSpec('@deepseek-ai/cordis-plugin-include') as { entryListSchema: unknown } & { default?: { entryListSchema: unknown } },
    'entryListSchema')
  const boot = pickNamespace(
    await importSpec('@deepseek-ai/dsh-app-boot') as BootModule & { default?: BootModule }, 'loadProfile')
  const mods: DialectModules = { yaml, schema: include.entryListSchema, boot }
  modulesCache = { profileDir, mods }
  return mods
}

/**
 * Resolve the live composition from the loader's own root Include entry.
 * @param ctx - the plugin's live Cordis context.
 * @returns the composition; `drift` non-null means serve read-only.
 * @throws HttpError 503 when the tree was not launched from a dsh profile.
 */
export async function resolveComposition(ctx: Context): Promise<Composition> {
  const loader = (ctx as Context & { loader?: LoaderSlice }).loader
  let root: RootIncludeEntry | undefined
  for (const entry of loader?.entries() ?? []) {
    if (entry.options?.id === 'include' && entry.options.name === 'cordis:include') root = entry
  }
  if (root?.options.config?.path === undefined) {
    throw new HttpError(503, '此进程不是从 dsh profile 启动的,没有可编辑的组合层')
  }
  const profileDir = dirname(fileURLToPath(root.options.config.path))
  const profileName = basename(profileDir)
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const homePath = join(dirname(dirname(profileDir)), 'cordis.patch.yml')

  const mods = await loadModules(profileDir)
  const dialect: Dialect = {
    load: (text) => mods.yaml.load(text, { schema: mods.schema }),
    dump: (value) => mods.yaml.dump(value, { schema: mods.schema, noRefs: true, lineWidth: 100 }),
  }

  const profile = mods.boot.loadProfile('dsh-schematic', profileName,
    createRequire(join(profileDir, 'package.json')).resolve('@deepseek-ai/dsh-app-boot/package.json'))
  const bundlePatches = profile.layers.flatMap((layer) => layer.patches)
  const userPatches = mods.boot.loadOptionalPatches('dsh-schematic', patchPath) ?? []
  const homePatches = mods.boot.loadOptionalPatches('dsh-schematic', homePath) ?? []

  // The live flattened list is exactly what the launcher mounted (boot) or
  // what the last HMR recomposition applied: bundles, user, home, overlays.
  // Raw-row equality is NOT checkable: the include pushes insert rows into
  // the tree by reference and later id-targeted patches mutate those objects
  // in place, so the live copy of an insert row embeds later layers' edits
  // (semantically identical, byte-different). Verify the SEMANTICS instead:
  // composing the live list must yield the identical tree as recomposing the
  // freshly-read layers with the positional split — anything else (bundle
  // updated under the process, layers moved) degrades to read-only.
  const live = root.options.config.patches ?? []
  const boundary = bundlePatches.length + userPatches.length + homePatches.length
  const overlays = live.slice(boundary)
  let drift: string | null = null
  let driftDetail: { index: number, expected: unknown, live: unknown } | null = null
  if (!deepEqual(mods.boot.composeEntries([live]), mods.boot.composeEntries([[...bundlePatches, ...userPatches, ...homePatches], overlays]))) {
    drift = 'composition-drift'
    const liveTree = mods.boot.composeEntries([live])
    const ourTree = mods.boot.composeEntries([[...bundlePatches, ...userPatches, ...homePatches], overlays])
    const len = Math.max(liveTree.length, ourTree.length)
    for (let i = 0; i < len; i++) {
      if (!deepEqual(liveTree[i], ourTree[i])) {
        driftDetail = { index: i, expected: ourTree[i] ?? null, live: liveTree[i] ?? null }
        break
      }
    }
  }

  const stat = existsSync(patchPath) ? statSync(patchPath) : null
  const userText = stat !== null ? readFileSync(patchPath, 'utf8') : ''
  const hash = 'sha256:' + createHash('sha256').update(userText).digest('hex')

  const layerPatches: LayerPatches[] = [
    ...profile.layers.map((layer): LayerPatches => ({ kind: 'bundle', label: layer.packageName, patches: layer.patches })),
    { kind: 'user', label: 'cordis.patch.yml', patches: userPatches },
    { kind: 'home', label: '~/.dsh/cordis.patch.yml', patches: homePatches },
    { kind: 'overlay', label: 'launcher', patches: overlays },
  ]
  const layers: LayerInfo[] = layerPatches.map((layer) => ({ kind: layer.kind, label: layer.label, rows: layer.patches.length }))

  return {
    profile: { name: profileName, dir: profileDir, patchPath },
    hash, bytes: stat?.size ?? 0, mtime: stat?.mtimeMs ?? 0,
    userText, userPatches, homePatches, overlays, layerPatches, layers,
    dialect, boot: mods.boot,
    drift, driftDetail,
    composeWith(next: PatchRow[]): PatchEntry[] {
      return mods.boot.composeEntries(layerPatches.map((layer) => layer.kind === 'user' ? next : layer.patches))
    },
  }
}
