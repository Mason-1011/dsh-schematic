/**
 * Host-half entry for the runtime-activity feed ("PyCharm debugger for
 * plugins"): one collector riding the session-event firehose, one RPC-gateway
 * observer for actions that never touch a session log, and one SSE layer
 * under /schematic/events. Wired by src/index.ts's apply().
 */

import type { Context } from '@deepseek-ai/cordis'
import { ActivityCollector } from './collector.ts'
import { createEventsLayer } from './sse.ts'
import type { EventsLayer } from './sse.ts'
import { installRpcObserver } from './rpc.ts'
import { RPC_ACTION } from './attribution.ts'
import { installTrafficTap } from './traffic.ts'
import type { TrafficTap } from './traffic.ts'
import { Journal } from './journal.ts'

/** Live traffic-flush cadence: rows ride one aggregated frame, not one per read. */
const TRAFFIC_FLUSH_MS = 750

export interface ActivitySetup {
  collector: ActivityCollector
  events: EventsLayer
  /** Cumulative service-read counts, merged into graph.json. */
  traffic: TrafficTap
  /** Refresh the graph-module set after every graph rebuild. */
  noteGraphModules: (modules: Iterable<string>) => void
}

/**
 * Start the collector and the SSE layer. The graph-module set starts empty;
 * call noteGraphModules as soon as a graph is built so tool attribution
 * resolves against what is actually mounted.
 */
export function applyActivity(ctx: Context): ActivitySetup {
  // The plugin's own observation journal (live-only events session logs never
  // carry); disabled by DSH_SCHEMATIC_JOURNAL=0. Boot prunes old day-files.
  const journal = Journal.enabled() ? new Journal(undefined, (m) => { ctx.logger.warn(m) }) : null
  journal?.prune()
  const collector = new ActivityCollector(ctx, journal)
  const traffic = installTrafficTap(ctx)
  const rpc = installRpcObserver(ctx, (method, isError, durationMs) => {
    const module = RPC_ACTION[method] ?? null
    collector.noteAction({ time: Date.now(), kind: 'action', module, name: method, isError, durationMs })
  })
  // Draining on a timer (not per read) is what keeps the tap O(1) on the hot
  // path: the listener only counts, and deltas leave as aggregated frames.
  const flush = setInterval(() => {
    const rows = traffic.drain()
    if (rows.length > 0) collector.noteTraffic(rows)
  }, TRAFFIC_FLUSH_MS)
  flush.unref()
  ctx.effect(() => {
    const stop = collector.start()
    rpc.ensure()
    return () => {
      clearInterval(flush)
      events.dispose()
      rpc.dispose()
      stop()
    }
  }, 'dsh-schematic: activity feed')
  const events = createEventsLayer(
    collector,
    (err) => { ctx.logger.warn(err) },
    () => { rpc.ensure() },
  )
  return {
    collector,
    events,
    traffic,
    noteGraphModules: (modules) => {
      collector.noteGraphModules(modules)
      rpc.ensure()
    },
  }
}
