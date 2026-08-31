/**
 * The `schematic` ctx service: the viewer's data source opened up as a
 * first-class injectable, so sibling plugins can read the live topology
 * without scraping /graph.json. Same source, same freshness — every call
 * recomputes from the Cordis runtime; there is no cached snapshot to go
 * stale. The change feed is deliberately NOT exposed (v1): a subscription
 * API owes each consumer HMR lifecycle management, and with zero consumers
 * that cost is not worth prepaying — a consumer can diff graph() itself,
 * and a later changes() is an addition to this same implementation.
 *
 * Observer stance: providing a service is a capability, not an observation
 * edge. The footprint is visible only to plugins that inject the key; the
 * graph shows it back honestly (this node provides 'schematic', form
 * 'service').
 */

import type { Context } from '@deepseek-ai/cordis'
import { buildGraph } from './graph.ts'
import type { LiveGraph } from './graph.ts'

/** What an injecting consumer receives as ctx.schematic. */
export interface SchematicService {
  /** A fresh live graph — the same object /graph.json serializes. */
  graph(): LiveGraph
}

/**
 * Provide the service under the 'schematic' key. Returns provide's
 * disposer, or null when the key is already taken (a collision downgrades
 * us to viewer-only with one warn — an observer never fails its own mount
 * over a nice-to-have).
 */
export function provideSchematic(ctx: Context): (() => void) | null {
  try {
    return ctx.provide('schematic', { graph: () => buildGraph(ctx) } satisfies SchematicService)
  } catch (err) {
    ctx.logger.warn(`[dsh-schematic] service key 'schematic' is already provided; skipping (${err instanceof Error ? err.message : String(err)})`)
    return null
  }
}
