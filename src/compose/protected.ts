/**
 * Protected-entry tiers for composition edits. Two confirmation tiers, no
 * silent blocks: `danger` requires typing the entry id (losing the editor
 * itself), `warn` shows a specific reason. A structure-aware fallback tier
 * catches heavily-injected entries the curated lists never named.
 *
 * @module dsh-schematic/compose/protected
 */

/** Why an entry is protected; the UI maps each key to bilingual text. */
export type ProtectedReason =
  | 'self'
  | 'hotReload'
  | 'pageServer'
  | 'spaRoster'
  | 'settingsSecrets'
  | 'durability'
  | 'manyDependents'

export interface ProtectedVerdict {
  tier: 'danger' | 'warn'
  reason: ProtectedReason
}

/** Losing this entry loses the editor itself; restore is a hand edit. */
const DANGER_IDS: ReadonlySet<string> = new Set(['schematic'])

/**
 * The composition's own machinery: the watch-only HMR instance and its timer
 * (they hot-reload every edit we write), the server this page is served
 * from, the SPA boot roster, settings/credentials plumbing, and the session
 * durability chain.
 */
const WARN_IDS: Record<string, ProtectedReason> = {
  timer: 'hotReload',
  hmr: 'hotReload',
  webserver: 'pageServer',
  'web-runtime': 'spaRoster',
  'typert-gateway': 'spaRoster',
  connection: 'spaRoster',
  locale: 'spaRoster',
  settings: 'settingsSecrets',
  credentials: 'settingsSecrets',
  session: 'durability',
  'session-persistence-jsonl': 'durability',
  'session-query-sqlite': 'durability',
  storage: 'durability',
  'storage-json': 'durability',
  'storage-domain': 'durability',
}

/** Entry-id prefixes whose rows are the web SPA's own boot roster/transport. */
const WARN_PREFIXES: readonly [prefix: string, reason: ProtectedReason][] = [
  ['ui-', 'spaRoster'],
  ['client-', 'spaRoster'],
]

/** Live injectors of a key at or above this count make the provider `warn`. */
const MANY_INJECTORS = 8

/** Config overrides from the plugin's own loader row (`config.edit`). */
export interface ProtectedConfig {
  /** Replace the curated lists wholesale; null keeps them. */
  protectedIds: Record<string, 'danger' | 'warn'> | null
  /** Append to whatever lists are in effect. */
  extraProtectedIds: Record<string, 'danger' | 'warn'>
}

/**
 * The protection tier of one entry, or null when editing it needs no extra
 * confirmation beyond the standard preview.
 * @param id - the loader entry id.
 * @param injectCountOf - live injector count for a ctx key (fallback tier).
 * @param config - curated-list overrides from plugin config.
 * @param provides - the entry's live provided keys (fallback tier).
 */
export function protectedTier(
  id: string,
  provides: readonly string[] | null,
  injectCountOf: (key: string) => number,
  config: ProtectedConfig,
): ProtectedVerdict | null {
  const overridden = config.protectedIds?.[id] ?? config.extraProtectedIds[id]
  if (overridden !== undefined) return { tier: overridden, reason: overridden === 'danger' ? 'self' : 'spaRoster' }
  if (DANGER_IDS.has(id)) return { tier: 'danger', reason: 'self' }
  if (WARN_IDS[id] !== undefined) return { tier: 'warn', reason: WARN_IDS[id] }
  for (const [prefix, reason] of WARN_PREFIXES) {
    if (id.startsWith(prefix)) return { tier: 'warn', reason }
  }
  if (provides !== null && provides.some((key) => injectCountOf(key) >= MANY_INJECTORS)) {
    return { tier: 'warn', reason: 'manyDependents' }
  }
  return null
}
