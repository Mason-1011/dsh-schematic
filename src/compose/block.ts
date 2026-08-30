/**
 * Managed-block surgery on the profile's user patch file. The file is the
 * user's own; schematic owns only the rows between its versioned markers.
 * Every byte outside `[OPEN line, past-CLOSE line)` is preserved verbatim —
 * header comments, hand-written rows, indentation, trailing newline.
 *
 * @module dsh-schematic/compose/block
 */

import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import type { Dialect, PatchRow } from './layers.ts'
import { HttpError } from '../llm.ts'

/** Format-versioned markers; v1. Bump both to invalidate old blocks loudly. */
const OPEN = '# >>> dsh-schematic v1'
const CLOSE = '# <<< dsh-schematic v1'

/** Marker lines as they appear in the file (documented in the READMEs). */
export const BLOCK_MARKERS = { open: OPEN, close: CLOSE } as const

/** The parsed managed block: row objects plus their line span in the file. */
export interface ManagedBlock {
  rows: PatchRow[]
  /** Line index of OPEN; -1 when the file has no block. */
  startLine: number
  /** Line index PAST CLOSE; -1 when the file has no block. */
  endLine: number
}

/**
 * Read the managed block. Unterminated (one marker without its pair) throws
 * 422 naming the line — never heuristic-repair user text.
 * @param text - the file's full text.
 * @param dialect - the include's own YAML dialect (`!!js` verbatim).
 */
export function readManagedBlock(text: string, dialect: Dialect): ManagedBlock {
  const lines = text.split('\n')
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === OPEN) { start = i; break }
  }
  if (start === -1) return { rows: [], startLine: -1, endLine: -1 }
  const close = lines.indexOf(CLOSE, start + 1)
  if (close === -1) {
    throw new HttpError(422, `受管区块缺少结束标记(第 ${start + 1} 行有「${OPEN}」);请手工补一行「${CLOSE}」再编辑`)
  }
  const body = lines.slice(start + 1, close).join('\n').trim()
  if (body === '') return { rows: [], startLine: start, endLine: close + 1 }
  let parsed: unknown
  try {
    parsed = dialect.load(body)
  } catch (error) {
    throw new HttpError(422, `受管区块内容不是合法 YAML:${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new HttpError(422, '受管区块内容必须是顶层数组(patch 行)')
  }
  return { rows: parsed as PatchRow[], startLine: start, endLine: close + 1 }
}

/**
 * Render the managed block's body (rows → YAML), or '' for no rows.
 * @param rows - the block's patch rows.
 * @param dialect - the include's own YAML dialect (`!!js` verbatim).
 */
export function renderBlockBody(rows: PatchRow[], dialect: Dialect): string {
  return rows.length === 0 ? '' : dialect.dump(rows).trimEnd()
}

/**
 * Splice a new row set into the file text, replacing any existing block (or
 * appending one). Guarantees: bytes outside the block untouched; the result
 * always parses as a top-level patch array (injecting `[]` when our block is
 * the only content); markers appear exactly once.
 * @param text - the file's current full text.
 * @param rows - the next managed row set.
 * @param dialect - the include's own YAML dialect.
 * @returns the candidate file text (not yet written).
 */
export function spliceManagedBlock(text: string, rows: PatchRow[], dialect: Dialect): string {
  const body = renderBlockBody(rows, dialect)
  const block = `${OPEN}\n${body === '' ? '' : body + '\n'}${CLOSE}\n`
  const current = readManagedBlock(text, dialect)
  let next: string
  if (current.startLine === -1) {
    const head = text === '' || text.endsWith('\n') ? text : text + '\n'
    next = head + block
  } else {
    const lines = text.split('\n')
    next = [
      ...lines.slice(0, current.startLine),
      ...block.slice(0, -1).split('\n'),
      ...lines.slice(current.endLine),
    ].join('\n')
  }
  // Empty-layer guard: a comments-only or empty file parses to null and the
  // launcher's parsePatchList throws on the next boot. When our block is
  // empty and nothing else is in the file, inject `[]` before the marker.
  if (dialect.load(next) === null && rows.length === 0 && !fileHasSequenceItem(next)) {
    const lines = next.split('\n')
    lines.splice(lines.indexOf(OPEN), 0, '[]')
    next = lines.join('\n')
  }
  validatePatchFile(next, dialect)
  return next
}

/** Whether the text has any top-level sequence item outside comments/blanks. */
function fileHasSequenceItem(text: string): boolean {
  return text.split('\n').some((line) => line !== '' && !line.startsWith('#'))
}

/**
 * Remove the managed block entirely — clear's write shape. Unlike an empty
 * splice, no marker pair stays behind. Same empty-layer `[]` guard and
 * validation as a splice.
 * @param text - the file's current full text.
 * @param dialect - the include's own YAML dialect.
 * @returns the candidate file text with the block gone (not yet written).
 */
export function removeManagedBlock(text: string, dialect: Dialect): string {
  const current = readManagedBlock(text, dialect)
  let next = text
  if (current.startLine !== -1) {
    const lines = text.split('\n')
    next = [...lines.slice(0, current.startLine), ...lines.slice(current.endLine)].join('\n')
  }
  if (dialect.load(next) === null && !fileHasSequenceItem(next)) {
    const lines = next.split('\n')
    lines.push('[]')
    next = lines.join('\n')
  }
  validatePatchFile(next, dialect)
  return next
}

/**
 * Validate a candidate patch file: must parse as a top-level array of
 * mappings under the include's dialect — exactly what the launcher's
 * `parsePatchList` demands at boot (an empty or comments-only file fails
 * there too, so no null exceptions here).
 * @throws HttpError 422 with the parser's own message on failure.
 */
export function validatePatchFile(text: string, dialect: Dialect): void {
  let parsed: unknown
  try {
    parsed = dialect.load(text)
  } catch (error) {
    throw new HttpError(422, `YAML 解析失败:${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new HttpError(422, 'patch 文件必须是顶层数组(loader patch 行);空文件或纯注释文件需要一行 []')
  }
  parsed.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new HttpError(422, `patch 第 ${index + 1} 行必须是映射对象`)
    }
  })
  const opens = text.split('\n').filter((line) => line === OPEN).length
  const closes = text.split('\n').filter((line) => line === CLOSE).length
  if (opens > 1 || closes > 1) {
    throw new HttpError(422, `受管标记必须最多一对(现在 ${opens} 开 ${closes} 闭)`)
  }
}

/**
 * Atomically write the patch file (tmp + rename in the same directory,
 * preserving the current file mode), the way the harness's own include
 * writes back.
 * @param path - the user patch file path.
 * @param text - the validated candidate text.
 */
export function writePatchAtomic(path: string, text: string): void {
  let mode = 0o644
  try { mode = statSync(path).mode & 0o777 } catch { /* new file keeps the default */ }
  const tmp = `${path}.schematic.tmp`
  writeFileSync(tmp, text, { mode })
  renameSync(tmp, path)
}

/** Read the file's current bytes (fresh; the staleness check depends on it). */
export function readPatchFile(path: string): string {
  return readFileSync(path, 'utf8')
}
