/**
 * The /schematic/compose* HTTP surface: the composition model at GET
 * /compose.json, with preview/apply/rollback/clear joining from the later
 * milestones. Same error envelope as the rest of the host routes.
 *
 * @module dsh-schematic/compose/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { sendJson, readJsonBody } from '../http.ts'
import { HttpError } from '../llm.ts'
import { resolveComposition, type Composition } from './layers.ts'
import { buildComposeModel } from './model.ts'
import { readManagedBlock, removeManagedBlock, spliceManagedBlock, validatePatchFile, writePatchAtomic, readPatchFile } from './block.ts'
import { listBackups, defaultBackupDir, makeBackup, newestBackupText, type BackupInfo } from './backup.ts'
import { parseOps, type Op } from './ops.ts'
import { buildPreview } from './preview.ts'
import type { EditConfig } from './config.ts'

/** One recorded harness reload failure (from the hmr/config-update-failed listener). */
export interface UpdateFailure {
  time: number
  filename: string
  message: string
  /** Hash of the file bytes the failure was about; a later successful reload of different bytes retires it. */
  hash: string
}

/** Everything the compose routes need beyond ctx. */
export interface ComposeDeps {
  editConfig: EditConfig
  /** Newest-last failure snapshots by watched filename. */
  updateFailures: Map<string, UpdateFailure>
}

/**
 * GET /schematic/compose.json — the editable composition model.
 * @param ctx - live Cordis context.
 * @param res - the HTTP response.
 * @param deps - edit config and the reload-failure map.
 */
export async function handleComposeGet(ctx: Context, res: ServerResponse, deps: ComposeDeps): Promise<void> {
  const comp = await resolveComposition(ctx)
  const block = readManagedBlock(comp.userText, comp.dialect)
  // The failure is actionable only while the bytes it failed on are still the
  // bytes on disk. The harness emits no success event, but drift === null
  // means the current file loaded; matching the failure's byte hash against
  // the live file's retires stale banners after a fix or a rollback.
  const failure = deps.updateFailures.get(comp.profile.patchPath) ?? null
  const lastError = failure !== null && failure.hash === comp.hash ? failure : null
  const backupsDir = deps.editConfig.backupDir ?? defaultBackupDir()
  const backups: BackupInfo[] = listBackups(backupsDir)

  if (comp.drift !== null || !deps.editConfig.enabled) {
    return sendJson(res, 200, {
      profile: comp.profile,
      patch: {
        hash: comp.hash, bytes: comp.bytes, mtime: comp.mtime,
        hasManagedBlock: block.startLine !== -1, managedRowCount: block.rows.length,
        otherRowCount: Math.max(0, comp.userPatches.length - block.rows.length),
      },
      layers: comp.layers,
      entries: [],
      seams: [],
      blockYaml: '',
      backups,
      lastError,
      editable: false,
      notEditableReason: !deps.editConfig.enabled ? 'disabled-by-config' : comp.drift,
      driftDetail: comp.driftDetail,
    })
  }

  const model = buildComposeModel(ctx, comp, deps.editConfig.protected)
  sendJson(res, 200, {
    profile: comp.profile,
    patch: {
      hash: comp.hash, bytes: comp.bytes, mtime: comp.mtime,
      hasManagedBlock: block.startLine !== -1, managedRowCount: block.rows.length,
      otherRowCount: Math.max(0, comp.userPatches.length - block.rows.length),
    },
    layers: comp.layers,
    entries: model.entries,
    seams: model.seams,
    blockYaml: model.blockYaml,
    backups,
    lastError,
    editable: true,
    notEditableReason: null,
  })
}

/** Resolve the composition and enforce the read-only gates. @throws 503. */
async function requireEditable(ctx: Context, deps: ComposeDeps): Promise<Composition> {
  const comp = await resolveComposition(ctx)
  if (comp.drift !== null) throw new HttpError(503, `组合层与磁盘不一致(${comp.drift}),编辑已锁定;请刷新模型`)
  if (!deps.editConfig.enabled) throw new HttpError(503, '组合编辑已被 config.edit.enabled=false 关闭')
  return comp
}

/** The configured or default backup directory. */
function backupDirOf(deps: ComposeDeps): string {
  return deps.editConfig.backupDir ?? defaultBackupDir()
}

/** sha256 of a text, the same shape as `Composition.hash`. */
function hashOf(text: string): string {
  return 'sha256:' + createHash('sha256').update(text).digest('hex')
}

/** Parse the shared `{baseHash, operations}` request shape. @throws 400. */
function readOpBody(body: unknown): { baseHash: string, ops: Op[] } {
  const raw = body as { baseHash?: unknown, operations?: unknown } | null
  const baseHash = raw?.baseHash
  if (typeof baseHash !== 'string' || baseHash === '') throw new HttpError(400, 'baseHash 必须是非空字符串')
  return { baseHash, ops: parseOps(raw?.operations) }
}

/** The stale-base refusal: someone wrote between the GET and this POST. */
function refuseStale(res: ServerResponse, diskText: string): void {
  sendJson(res, 409, { error: 'patch 文件已被其他方修改,请刷新模型后再编辑', hash: hashOf(diskText) })
}

/**
 * POST /schematic/compose/* — preview (dry run), apply (backup → write →
 * harness HMR), rollback (restore the newest backup), clear (drop the whole
 * managed block). Every write is preceded by a full backup and a staleness
 * check; apply reruns the exact preview pipeline.
 * @param ctx - live Cordis context.
 * @param req - the HTTP request (JSON body).
 * @param sub - the sub-path under /schematic.
 * @param res - the HTTP response.
 * @param deps - edit config and the reload-failure map.
 */
export async function handleComposePost(
  ctx: Context, req: IncomingMessage, sub: string, res: ServerResponse, deps: ComposeDeps,
): Promise<void> {
  if (sub === '/compose/preview') return await handlePreview(ctx, req, res, deps)
  if (sub === '/compose/apply') return await handleApply(ctx, req, res, deps)
  if (sub === '/compose/rollback') return await handleRollback(ctx, res, deps)
  if (sub === '/compose/clear') return await handleClear(ctx, req, res, deps)
  sendJson(res, 404, { error: `unknown compose endpoint: ${sub}` })
}

/** POST /compose/preview — zero-write dry run. */
async function handlePreview(ctx: Context, req: IncomingMessage, res: ServerResponse, deps: ComposeDeps): Promise<void> {
  const { baseHash, ops } = readOpBody(await readJsonBody(req))
  const comp = await requireEditable(ctx, deps)
  if (baseHash !== comp.hash) return refuseStale(res, comp.userText)
  sendJson(res, 200, buildPreview(ctx, comp, ops, deps.editConfig.protected))
}

/** POST /compose/apply `{baseHash, operations, confirmIds?}` — backup, write, reload. */
async function handleApply(ctx: Context, req: IncomingMessage, res: ServerResponse, deps: ComposeDeps): Promise<void> {
  const body = await readJsonBody(req) as { confirmIds?: unknown } | null
  const { baseHash, ops } = readOpBody(body)
  const confirmRaw = body?.confirmIds
  if (confirmRaw !== undefined && (!Array.isArray(confirmRaw) || confirmRaw.some((c) => typeof c !== 'string'))) {
    throw new HttpError(400, 'confirmIds 必须是字符串数组')
  }
  const confirmIds = new Set(confirmRaw as string[] | undefined ?? [])

  const comp = await requireEditable(ctx, deps)
  if (baseHash !== comp.hash) return refuseStale(res, comp.userText)
  const preview = buildPreview(ctx, comp, ops, deps.editConfig.protected)

  // The danger tier (only ever the editor itself) requires the user to have
  // typed each entry id; anything less would let one click remove the UI.
  const dangerIds = [...new Set(preview.warnings.filter((w) => w.level === 'danger').flatMap((w) => w.ids ?? []))]
  const unconfirmed = dangerIds.filter((id) => !confirmIds.has(id))
  if (unconfirmed.length > 0) {
    throw new HttpError(422, `危险操作需要逐个确认:请在 confirmIds 中加入 ${unconfirmed.join('、')}`)
  }

  // Freeze the base: the bytes that produced this preview must still be the
  // bytes on disk right before the write, or refuse instead of clobbering.
  const onDisk = readPatchFile(comp.profile.patchPath)
  if (onDisk !== comp.userText) return refuseStale(res, onDisk)

  const backupFile = makeBackup(comp.profile.patchPath, backupDirOf(deps), deps.editConfig.backupKeep, 'apply')
  writePatchAtomic(comp.profile.patchPath, preview.filePreview)
  sendJson(res, 200, {
    applied: true,
    backup: { file: backupFile, reason: 'apply' },
    hash: hashOf(preview.filePreview),
    preview,
  })
}

/** POST /compose/rollback — restore the newest backup (itself backed up first). */
async function handleRollback(ctx: Context, res: ServerResponse, deps: ComposeDeps): Promise<void> {
  // A rescue action: allowed even under composition drift, only the config
  // kill-switch gates it.
  const comp = await resolveComposition(ctx)
  if (!deps.editConfig.enabled) throw new HttpError(503, '组合编辑已被 config.edit.enabled=false 关闭')
  const { file, text } = newestBackupText(backupDirOf(deps))
  validatePatchFile(text, comp.dialect)
  const backupFile = existsSync(comp.profile.patchPath)
    ? makeBackup(comp.profile.patchPath, backupDirOf(deps), deps.editConfig.backupKeep, 'rollback')
    : null
  writePatchAtomic(comp.profile.patchPath, text)
  sendJson(res, 200, {
    restored: file,
    backup: backupFile === null ? null : { file: backupFile, reason: 'rollback' },
    hash: hashOf(text),
  })
}

/** POST /compose/clear `{baseHash}` — drop the whole managed block, markers included. */
async function handleClear(ctx: Context, req: IncomingMessage, res: ServerResponse, deps: ComposeDeps): Promise<void> {
  const { baseHash } = readOpBodyShape(await readJsonBody(req))
  const comp = await requireEditable(ctx, deps)
  if (baseHash !== comp.hash) return refuseStale(res, comp.userText)
  const block = readManagedBlock(comp.userText, comp.dialect)
  if (block.startLine === -1) {
    return sendJson(res, 200, { cleared: true, removedRowCount: 0, backup: null, hash: comp.hash })
  }
  const candidate = removeManagedBlock(comp.userText, comp.dialect)
  const onDisk = readPatchFile(comp.profile.patchPath)
  if (onDisk !== comp.userText) return refuseStale(res, onDisk)
  const backupFile = makeBackup(comp.profile.patchPath, backupDirOf(deps), deps.editConfig.backupKeep, 'clear')
  writePatchAtomic(comp.profile.patchPath, candidate)
  sendJson(res, 200, {
    cleared: true,
    removedRowCount: block.rows.length,
    backup: { file: backupFile, reason: 'clear' },
    hash: hashOf(candidate),
  })
}

/** Extract just `{baseHash}` without requiring operations. @throws 400. */
function readOpBodyShape(body: unknown): { baseHash: string } {
  const raw = body as { baseHash?: unknown } | null
  const baseHash = raw?.baseHash
  if (typeof baseHash !== 'string' || baseHash === '') throw new HttpError(400, 'baseHash 必须是非空字符串')
  return { baseHash }
}
