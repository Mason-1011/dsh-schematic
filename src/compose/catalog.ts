/**
 * The provider-swap catalog: which packages are alternatives for a capability
 * seam. Curated (a small verified constant, like INFRA_KEYS in graph.ts) —
 * a disabled or absent row's real provides/inject are only knowable by
 * mounting it, so every catalog-derived suggestion carries its state and the
 * UI words it as a suggestion, never a fact.
 *
 * @module dsh-schematic/compose/catalog
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Packages that register a provider INTO a capability service (they inject
 * the seam key and register themselves): module specifier → seam key. These
 * are the swappable rows; the seam key's owner (the capability package) is
 * not swappable itself.
 */
const PROVIDER_MODULES: Record<string, string> = {
  '@deepseek-ai/dsh-fs-local': 'fs',
  '@deepseek-ai/dsh-fs-sandbox': 'fs',
  '@deepseek-ai/dsh-web-search-deepseek': 'web',
  '@deepseek-ai/dsh-web-search-exa': 'web',
  '@deepseek-ai/dsh-web-search-perplexity': 'web',
  '@deepseek-ai/dsh-web-fetch-http': 'web',
  '@deepseek-ai/dsh-llm-deepseek': 'llm',
  '@deepseek-ai/dsh-llm-pi-ai': 'llm',
}

/** One swappable alternative for a seam. */
export interface SeamAlternative {
  /** Package name (module specifier without the loader row's entry id). */
  package: string
  /** 'in-tree' = a row exists in the composed tree; 'installed' = resolvable
   *  from the profile but no row; 'catalog' = not installed anywhere. */
  state: 'in-tree' | 'installed' | 'catalog'
  /** Entry id of the in-tree row, when state is 'in-tree'. */
  id: string | null
  /** Whether the in-tree row is currently disabled. */
  disabled: boolean
  /** The row's current config as raw YAML, when state is 'in-tree'. */
  configRaw: string | null
  /** The copyable install command, when state is 'catalog'. */
  install: string | null
}

/** The seam key a module registers providers into, when curated. */
export function seamOfModule(module: string): string | null {
  return PROVIDER_MODULES[module] ?? null
}

/**
 * Catalog alternatives for a seam: every curated provider module that is not
 * one of the entries being swapped away — in-tree rows with their real
 * config, otherwise the install state from the profile's own anchor.
 * @param seam - the ctx service key.
 * @param exceptEntryIds - the entries being swapped away (never alternatives
 *  to themselves).
 * @param treeRows - composed rows `{id, module, disabled, configRaw}`, used
 *  for in-tree detection and config templates.
 * @param profileDir - the profile directory (resolution anchor).
 */
export function seamAlternatives(
  seam: string,
  exceptEntryIds: ReadonlySet<string>,
  treeRows: { id: string, module: string, disabled: boolean, configRaw: string | null }[],
  profileDir: string,
): SeamAlternative[] {
  const out: SeamAlternative[] = []
  for (const [module, key] of Object.entries(PROVIDER_MODULES)) {
    if (key !== seam) continue
    const row = treeRows.find((r) => r.module === module)
    if (row !== undefined && !exceptEntryIds.has(row.id)) {
      out.push({ package: module, state: 'in-tree', id: row.id, disabled: row.disabled, configRaw: row.configRaw, install: null })
      continue
    }
    if (row !== undefined) continue // an entry being replaced
    const installed = isInstalled(module, profileDir)
    out.push({
      package: module,
      state: installed ? 'installed' : 'catalog',
      id: null,
      disabled: false,
      configRaw: null,
      install: installed ? null : `dsh plugin --profile ${profileDir.split('/').pop()} add ${module}`,
    })
  }
  return out
}

/** Whether a package resolves from the profile's own anchor (pnpm-hoisted or healed fallback). */
export function isInstalled(packageName: string, profileDir: string): boolean {
  try {
    createRequire(join(profileDir, 'package.json')).resolve(`${packageName}/package.json`)
    return true
  } catch {
    return false
  }
}
