/**
 * The observation journal: an append-only JSONL file the plugin owns under
 * ~/.dsh/schematic/journal/, recording the live-only observations the session
 * logs can never reconstruct — workflow phase/log progress, run→session
 * association, unrecorded runs (ralph), jobs-registry callbacks, and
 * agent-status flips. History replay (the /history merge) reads it back
 * alongside the durable session logs: the log is the skeleton, the journal
 * is the flesh.
 *
 * Pure-observer red line: this file is the plugin's own; nothing is ever
 * appended to any session log, and no service is wrapped.
 *
 * Record vocabulary (one JSON object per line, `t` = Unix ms, `ev` = kind):
 *   wf-owner      {run, name, session, recorded} — association resolved at the
 *                 run's first live event; session null marks an orphaned run
 *   wf-phase      {run, title}                   } always journaled: no durable
 *   wf-log        {run, message}                 } twin exists for these
 *   wf-agent      {run, seq, label, phase?}      } only for unrecorded runs:
 *   wf-agent-end  {run, seq, outcome}            } recorded ones live in the
 *   wf-end        {run, stopReason, error?}      } session log already
 *   job           {id, label, status, startedAt}
 *   job-done      {id, label, status, detail?, startedAt, finishedAt}
 *   agent-status  {session, status}
 *   topo-node     {id, label, module, origin, added} — settled graph diff between
 *                 consecutive snapshots (debounced ~750ms); entry-origin units
 *                 only, runtime mounts are noise
 *   topo-provider {key, from, to} — a ctx key's provider unit label changed;
 *                 'host' marks a launcher-provided key, null the unresolved side
 *   topo-state    {label, module, from, to, error?} — a unit flipped into or out
 *                 of 'failed', with the clipped failure reason
 * Service reads (traffic) are deliberately not journaled: per-read moments are
 * the noise floor, and cumulative counts already ride graph.json.
 * The topo-* records are host-scope like job/agent-status: never merged into a
 * session's replay — the live timeline shows them, the journal remembers them.
 *
 * Rotation is per-day; each day's file is capped, and boot prunes old files.
 * Set DSH_SCHEMATIC_JOURNAL=0 to disable writing entirely.
 */

import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One day-file's ceiling; past it the journal closes for the day (once, loudly). */
const MAX_BYTES_PER_DAY = 2_000_000
/** How many day-files boot keeps. */
const KEEP_DAYS = 14

export type JournalEvent =
  | { ev: 'wf-owner'; run: string; name: string; session: string | null; recorded: boolean }
  | { ev: 'wf-phase'; run: string; title: string }
  | { ev: 'wf-log'; run: string; message: string }
  | { ev: 'wf-agent'; run: string; seq: number; label: string; phase?: string }
  | { ev: 'wf-agent-end'; run: string; seq: number; outcome: string }
  | { ev: 'wf-end'; run: string; stopReason: string; error?: string }
  | { ev: 'job'; id: string; label: string; status: string; startedAt: number }
  | { ev: 'job-done'; id: string; label: string; status: string; detail?: string; startedAt: number; finishedAt?: number }
  | { ev: 'agent-status'; session: string; status: 'idle' | 'running' }
  | { ev: 'topo-node'; id: string; label: string; module: string | null; origin: 'entry' | 'runtime'; added: boolean }
  | { ev: 'topo-provider'; key: string; from: string | null; to: string | null }
  | { ev: 'topo-state'; label: string; module: string | null; from: string; to: string; error?: string }

export class Journal {
  /** The day-file currently closed ('' = writing; '*' = disabled outright). */
  private closedFor = ''

  constructor(
    /** The journal directory; replay reads day-files from here. */
    readonly dir: string = join(homedir(), '.dsh', 'schematic', 'journal'),
    private readonly warn: (message: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {
    try {
      mkdirSync(this.dir, { recursive: true })
    } catch {
      // An unwritable journal disables itself loudly once; the host never feels it.
      this.closedFor = '*'
      this.warn('[dsh-schematic] journal: directory cannot be created; journaling disabled')
    }
  }

  /** Disabled by env switch — callers hold a null instead when set. */
  static enabled(): boolean {
    return process.env.DSH_SCHEMATIC_JOURNAL !== '0'
  }

  /** Append one record; a cap hit or write failure closes the day-file (a new day re-opens writing). */
  write(event: JournalEvent): void {
    const day = new Date(this.now()).toISOString().slice(0, 10)
    if (this.closedFor === day || this.closedFor === '*') return
    try {
      const file = join(this.dir, `${day}.jsonl`)
      appendFileSync(file, `${JSON.stringify({ t: this.now(), ...event })}\n`)
      if (statSync(file).size > MAX_BYTES_PER_DAY) {
        this.closedFor = day
        this.warn(`[dsh-schematic] journal: ${day}.jsonl reached ${MAX_BYTES_PER_DAY} bytes; closed for the day`)
      }
    } catch {
      this.closedFor = day
      this.warn('[dsh-schematic] journal: write failed; journaling disabled until the day rolls over')
    }
  }

  /** Delete day-files beyond the retention window. Boot-time only. */
  prune(): void {
    try {
      const files = readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort()
      for (const stale of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) {
        rmSync(join(this.dir, stale), { force: true })
      }
    } catch {
      // A failed prune never blocks the feed; the next boot retries.
    }
  }
}
