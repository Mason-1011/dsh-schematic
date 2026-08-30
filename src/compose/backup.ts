/**
 * Full-file backups of the user patch layer, taken before every mutating
 * compose endpoint. Backups live in the plugin's own directory (a sibling
 * of the observation journal), capped and listed with a `.meta.json`
 * sidecar naming why each was taken.
 *
 * @module dsh-schematic/compose/backup
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { HttpError } from '../llm.ts'

/** One listed backup. */
export interface BackupInfo {
  file: string
  time: number
  bytes: number
  reason: string
}

/** The default backup directory (sibling of ~/.dsh/schematic/journal/). */
export function defaultBackupDir(): string {
  return join(homedir(), '.dsh', 'schematic', 'patches')
}

/**
 * Back up the patch file (full bytes) and prune beyond the cap.
 * @param patchPath - the user patch file.
 * @param dir - the backup directory (created when missing).
 * @param keep - how many newest backups to keep.
 * @param reason - why this backup was taken (shown in the list).
 * @returns the backup's file name.
 */
export function makeBackup(patchPath: string, dir: string, keep: number, reason: string): string {
  mkdirSync(dir, { recursive: true })
  // A profile may have no patch file yet; its backup is honestly empty.
  const text = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
  const now = new Date()
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const stamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T`
    + `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}-${pad(now.getMilliseconds(), 3)}Z`
  const base = `${stamp}-${patchPath.split('/').pop()?.replace(/^cordis\./, '') ?? 'cordis.patch.yml'}`
  writeFileSync(join(dir, base), text)
  writeFileSync(join(dir, `${base}.meta.json`), JSON.stringify({
    reason, time: now.getTime(), bytes: Buffer.byteLength(text),
  }))
  pruneBackups(dir, keep)
  return base
}

/** List backups newest-first with their sidecar metadata. */
export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  const out: BackupInfo[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.meta.json')) continue
    try {
      const meta = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Partial<BackupInfo>
      out.push({
        file: file.replace(/\.meta\.json$/, ''),
        time: typeof meta.time === 'number' ? meta.time : 0,
        bytes: typeof meta.bytes === 'number' ? meta.bytes : 0,
        reason: typeof meta.reason === 'string' ? meta.reason : '',
      })
    } catch {
      // an unreadable sidecar still lists its backup, just unannotated
      out.push({ file: file.replace(/\.meta\.json$/, ''), time: 0, bytes: 0, reason: '' })
    }
  }
  return out.sort((a, b) => b.time - a.time || b.file.localeCompare(a.file))
}

/** Delete the oldest backups beyond `keep` (data and sidecar together). */
export function pruneBackups(dir: string, keep: number): void {
  const backups = listBackups(dir)
  for (const backup of backups.slice(keep)) {
    rmSync(join(dir, backup.file), { force: true })
    rmSync(join(dir, `${backup.file}.meta.json`), { force: true })
  }
}

/**
 * The newest backup's full text, for rollback.
 * @throws HttpError 404 when no backup exists.
 */
export function newestBackupText(dir: string): { file: string, text: string } {
  const newest = listBackups(dir)[0]
  if (newest === undefined) throw new HttpError(404, '没有可回滚的备份')
  return { file: newest.file, text: readFileSync(join(dir, newest.file), 'utf8') }
}
