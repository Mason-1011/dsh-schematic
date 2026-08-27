/**
 * Host-half entry for the runtime-activity feed ("PyCharm debugger for
 * plugins"): one collector riding the session-event firehose + one SSE layer
 * under /schematic/events. Wired by src/index.ts's apply().
 */

import type { Context } from '@deepseek-ai/cordis'
import { ActivityCollector } from './collector.ts'
import { createEventsLayer } from './sse.ts'
import type { EventsLayer } from './sse.ts'

export interface ActivitySetup {
  collector: ActivityCollector
  events: EventsLayer
  /** Refresh the graph-module set after every graph rebuild. */
  noteGraphModules: (modules: Iterable<string>) => void
}

/**
 * Start the collector and the SSE layer. The graph-module set starts empty;
 * call noteGraphModules as soon as a graph is built so tool attribution
 * resolves against what is actually mounted.
 */
export function applyActivity(ctx: Context): ActivitySetup {
  const collector = new ActivityCollector(ctx)
  const events = createEventsLayer(collector, (err) => { ctx.logger.warn(err) })
  ctx.effect(() => {
    const stop = collector.start()
    return () => {
      events.dispose()
      stop()
    }
  }, 'dsh-schematic: activity feed')
  return { collector, events, noteGraphModules: (modules) => { collector.noteGraphModules(modules) } }
}
