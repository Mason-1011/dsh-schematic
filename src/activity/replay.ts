/**
 * History replay: merge a session log page (the skeleton — durable events
 * re-attributed through the exact live fold) with the observation journal's
 * live-only flesh (workflow phase/log progress, unrecorded runs) for the same
 * time window. The session log says what was committed; the journal says what
 * only existed in flight. Together they reconstruct the timeline a live
 * connection would have shown.
 *
 * Both sources are read-only here: history pages come through the host's own
 * session.history RPC, journal records from the plugin's own day-files.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TimelineEntry } from './protocol.ts'
import { WORKFLOW_ENGINE } from './attribution.ts'
import type { JournalEvent } from './journal.ts'

/** One history page served to the viewer. */
export interface HistoryPage {
  /** Newest-first rows: log-derived and journal-derived merged on time. */
  rows: TimelineEntry[]
  /** More log pages exist before this one (journal has no pages). */
  hasMore: boolean
  /** Oldest event seq in this page; pass back as beforeSeq for the next page. */
  nextBeforeSeq: number | null
}

/** Day-file names covering [fromMs, toMs], clipped to files that exist. */
function dayFiles(dir: string, fromMs: number, toMs: number): string[] {
  const from = new Date(fromMs).toISOString().slice(0, 10)
  const to = new Date(toMs).toISOString().slice(0, 10)
  let names: string[]
  try {
    names = readdirSync(dir).filter((f) => f >= `${from}.jsonl` && f <= `${to}.jsonl`)
  } catch {
    return []
  }
  return names.sort()
}

/**
 * Journal rows for one session inside [fromMs, toMs]: wf-owner associates runs
 * with the session (and stamps run starts for settlement durations); the run's
 * phase/log/agent/end records become engine-attributed rows. Journal only
 * holds what no session log can reconstruct, so nothing here duplicates the
 * log-derived rows of the same window.
 */
export function journalRows(dir: string, sessionId: string, fromMs: number, toMs: number): TimelineEntry[] {
  const runName = new Map<string, string>()
  const runStart = new Map<string, number>()
  const agentStart = new Map<string, number>()
  const rows: TimelineEntry[] = []
  const inWindow = (t: number): boolean => t >= fromMs - 1 && t <= toMs + 1
  for (const name of dayFiles(dir, fromMs, toMs)) {
    let text: string
    try {
      text = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (line === '') continue
      let record: { t?: unknown } & Partial<JournalEvent>
      try {
        record = JSON.parse(line) as { t?: unknown } & Partial<JournalEvent>
      } catch {
        continue
      }
      const t = typeof record.t === 'number' ? record.t : 0
      if (!inWindow(t)) continue
      switch (record.ev) {
        case 'wf-owner':
          if (record.session === sessionId && typeof record.run === 'string') {
            runName.set(record.run, typeof record.name === 'string' ? record.name : record.run)
            runStart.set(record.run, t)
          }
          break
        case 'wf-phase':
          if (typeof record.run === 'string' && runName.has(record.run)) {
            rows.push({
              time: t,
              kind: 'workflow',
              module: WORKFLOW_ENGINE,
              name: runName.get(record.run),
              snippet: typeof record.title === 'string' ? record.title : undefined,
            })
          }
          break
        case 'wf-log':
          if (typeof record.run === 'string' && runName.has(record.run)) {
            rows.push({
              time: t,
              kind: 'workflow',
              module: WORKFLOW_ENGINE,
              name: runName.get(record.run),
              snippet: typeof record.message === 'string' ? record.message : undefined,
            })
          }
          break
        case 'wf-agent':
          if (typeof record.run === 'string' && typeof record.seq === 'number' && runName.has(record.run)) {
            agentStart.set(`${record.run}:${record.seq}`, t)
            rows.push({
              time: t,
              kind: 'workflow',
              module: WORKFLOW_ENGINE,
              name: `#${record.seq} ${typeof record.label === 'string' ? record.label : ''}`.trim(),
              ...(record.phase !== undefined ? { snippet: record.phase } : {}),
            })
          }
          break
        case 'wf-agent-end':
          if (typeof record.run === 'string' && typeof record.seq === 'number' && runName.has(record.run)) {
            const startedAt = agentStart.get(`${record.run}:${record.seq}`)
            const entry: TimelineEntry = {
              time: t,
              kind: 'workflow',
              module: WORKFLOW_ENGINE,
              name: `#${record.seq}`,
              snippet: typeof record.outcome === 'string' ? record.outcome : undefined,
            }
            if (startedAt !== undefined) entry.durationMs = Math.max(0, t - startedAt)
            if (record.outcome === 'failed') entry.isError = true
            rows.push(entry)
          }
          break
        case 'wf-end':
          if (typeof record.run === 'string' && runName.has(record.run)) {
            const startedAt = runStart.get(record.run)
            const entry: TimelineEntry = {
              time: t,
              kind: 'workflow-end',
              module: WORKFLOW_ENGINE,
              name: runName.get(record.run),
              snippet: typeof record.stopReason === 'string' ? record.stopReason : undefined,
            }
            if (startedAt !== undefined) entry.durationMs = Math.max(0, t - startedAt)
            if (record.stopReason === 'error') entry.isError = true
            rows.push(entry)
          }
          break
        default:
          break
      }
    }
  }
  return rows
}
