/**
 * The plugin's own loader-row config (`config.edit` in the schematic row of
 * a patch layer). First knob surface of the package; validated narrow and
 * failing loud on unknown keys — a typo'd knob must never silently no-op.
 *
 * @module dsh-schematic/compose/config
 */

import type { ProtectedConfig } from './protected.ts'

/** The `config.edit` section as declared in cordis.yml/patch YAML. */
export interface EditConfigInput {
  enabled?: unknown
  backupKeep?: unknown
  backupDir?: unknown
  protectedIds?: unknown
  extraProtectedIds?: unknown
}

/** Validated edit config. */
export interface EditConfig {
  enabled: boolean
  backupKeep: number
  /** null → ~/.dsh/schematic/patches. */
  backupDir: string | null
  protected: ProtectedConfig
}

const DEFAULTS: EditConfig = {
  enabled: true,
  backupKeep: 20,
  backupDir: null,
  protected: { protectedIds: null, extraProtectedIds: {} },
}

/**
 * Validate the plugin config's `edit` section.
 * @param input - the raw `config.edit` value (may be undefined).
 * @throws Error naming the first invalid field.
 */
export function normalizeEditConfig(input: unknown): EditConfig {
  if (input === undefined || input === null) return { ...DEFAULTS }
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('config.edit 必须是映射对象')
  const edit = input as EditConfigInput
  const known: (keyof EditConfigInput)[] = ['enabled', 'backupKeep', 'backupDir', 'protectedIds', 'extraProtectedIds']
  for (const key of Object.keys(edit) as (keyof EditConfigInput)[]) {
    if (!known.includes(key)) throw new Error(`config.edit 有未知字段 ${String(key)}`)
  }
  if (edit.enabled !== undefined && typeof edit.enabled !== 'boolean') throw new Error('config.edit.enabled 必须是布尔值')
  if (edit.backupKeep !== undefined && (!Number.isSafeInteger(edit.backupKeep) || (edit.backupKeep as number) < 1)) {
    throw new Error('config.edit.backupKeep 必须是 ≥1 的整数')
  }
  if (edit.backupDir !== undefined && edit.backupDir !== null && typeof edit.backupDir !== 'string') {
    throw new Error('config.edit.backupDir 必须是路径字符串或 null')
  }
  return {
    enabled: (edit.enabled as boolean | undefined) ?? DEFAULTS.enabled,
    backupKeep: (edit.backupKeep as number | undefined) ?? DEFAULTS.backupKeep,
    backupDir: (edit.backupDir as string | null | undefined) ?? DEFAULTS.backupDir,
    protected: {
      protectedIds: validateTierMap(edit.protectedIds, 'protectedIds', true),
      extraProtectedIds: validateTierMap(edit.extraProtectedIds, 'extraProtectedIds', false),
    },
  }
}

/** Validate an id→tier map (`null` allowed only for the wholesale-replace field). */
function validateTierMap(value: unknown, field: string, allowNull: false): Record<string, 'danger' | 'warn'>
function validateTierMap(value: unknown, field: string, allowNull: true): Record<string, 'danger' | 'warn'> | null
function validateTierMap(value: unknown, field: string, allowNull: boolean): Record<string, 'danger' | 'warn'> | null {
  if (value === undefined) return allowNull ? null : {}
  if (value === null && allowNull) return null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`config.edit.${field} 必须是 id → danger|warn 的映射`)
  }
  const out: Record<string, 'danger' | 'warn'> = {}
  for (const [id, tier] of Object.entries(value as Record<string, unknown>)) {
    if (tier !== 'danger' && tier !== 'warn') throw new Error(`config.edit.${field}[${id}] 必须是 danger 或 warn`)
    out[id] = tier
  }
  return out
}
