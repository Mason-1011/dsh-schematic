/**
 * Topology watcher: the push signal behind the journal's topo-* records.
 * Three framework events — fiber creation/disposal, fiber state transitions,
 * and provider swaps — each arm the same trailing debounce; when the tree
 * settles, one buildGraph diff runs and the collector journals and rows
 * whatever structurally changed. Net transitions between settled snapshots
 * are the contract: an HMR reload's active → loading → active burst must
 * coalesce to silence, not to three rows.
 *
 * Subscribing internal/* adds no topology edge — graph.ts skips internal/*
 * names when enumerating broadcast subscriptions, so the pure-observer
 * stance holds. 'internal/service' is emitted through an isolation-scope
 * filter (reflect.notify), so its listener registers global to hear swaps
 * inside every scope; the other two dispatch unfiltered from plain contexts.
 */

import type { Context } from '@deepseek-ai/cordis'
import { buildGraph } from '../graph.ts'
import type { ActivityCollector } from './collector.ts'

/** Settle window; same cadence as the traffic flush. */
const TOPO_DEBOUNCE_MS = 750

/**
 * Install the watcher. The listener registrations are effects on the
 * plugin's own fiber, so HMR/dispose removes them with the plugin.
 */
export function installTopoWatcher(ctx: Context, collector: ActivityCollector): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const fire = (): void => {
    timer = undefined
    if (stopped) return
    try {
      collector.noteTopo(buildGraph(ctx))
    } catch { /* a failed build keeps the previous baseline; the watcher stays armed */ }
  }
  const arm = (): void => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(fire, TOPO_DEBOUNCE_MS)
    timer.unref()
  }

  ctx.effect(() => {
    // Out-of-tree binding, the collector firehose pattern: the repo's type
    // view of Context lacks some of dsh's merged event maps.
    const on = ctx.on as unknown as
      (name: string, listener: (...args: never[]) => void, options?: { global?: boolean }) => () => void
    const kick = (() => { arm() }) as (...args: never[]) => void
    const offs = [
      on('internal/plugin', kick),
      on('internal/status', kick),
      on('internal/service', kick, { global: true }),
    ]
    return () => {
      // Stopped FIRST: the disposal burst that follows (including the
      // workbench disabling schematic itself) must not fire the diff.
      stopped = true
      clearTimeout(timer)
      for (const off of offs) off()
    }
  }, 'dsh-schematic: topology watcher')
}
