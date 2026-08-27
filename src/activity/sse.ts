/**
 * SSE endpoint /schematic/events — the wire half of the activity feed.
 *
 * Modeled on the harness's own client-hmr /plugins/events endpoint: the
 * prefix-route handler owns the whole response lifecycle, writes
 * text/event-stream with no-store, greets with a comment line + retry hint,
 * then streams frames. Connections register in a set; every write checks the
 * socket first so a dead peer cannot throw into the firehose callback.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ActivityCollector } from './collector.ts'
import { PROTOCOL_VERSION, frameText } from './protocol.ts'
import type { Frame } from './protocol.ts'

/** Comment-line keepalive cadence; unref'd so it never holds the process. */
const HEARTBEAT_MS = 15_000

export interface EventsLayer {
  /** Handle one request for the /schematic/events route (owns the response). */
  handle(req: IncomingMessage, res: ServerResponse): void
  /** Destroy every open connection and stop the layer (plugin dispose). */
  dispose(): void
}

export function createEventsLayer(
  collector: ActivityCollector,
  log: (err: Error) => void,
  onConnect?: () => void,
): EventsLayer {
  const connections = new Set<ServerResponse>()

  function write(res: ServerResponse, frame: Frame): void {
    if (res.writableEnded || res.destroyed) return
    try {
      res.write(frameText(frame))
    } catch (err) {
      log(err instanceof Error ? err : new Error(String(err)))
    }
  }

  return {
    handle(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET' })
        res.end('method not allowed')
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      res.write(': connected\nretry: 3000\n\n')
      connections.add(res)
      // A fresh watcher is a natural moment to re-check observation surfaces
      // that may have appeared after boot (apiProxy remount, late services).
      onConnect?.()
      // Snapshot first: a reconnecting client rebuilds all session state and
      // the timeline tail before any incremental frame can arrive.
      write(res, { type: 'hello', proto: PROTOCOL_VERSION, serverTime: Date.now() })
      write(res, { type: 'snapshot', ...collector.snapshot() })
      const unsubscribe = collector.subscribe({
        // Each connection's listener writes ONLY to its own socket: a global
        // fan-out here would write every frame once per open connection.
        onActivity: (sessionId, entry) => { write(res, { type: 'activity', sessionId, entry }) },
        onState: (sessionId, state) => { write(res, { type: 'state', sessionId, state }) },
        onAction: (entry) => { write(res, { type: 'action', entry }) },
      })
      const heartbeat = setInterval(() => {
        if (res.writableEnded || res.destroyed) return
        res.write(': hb\n\n')
      }, HEARTBEAT_MS) as unknown as { unref(): void }
      heartbeat.unref()
      res.on('close', () => {
        clearInterval(heartbeat as unknown as number)
        unsubscribe()
        connections.delete(res)
      })
    },
    dispose() {
      for (const res of connections) {
        if (!res.writableEnded) res.destroy()
      }
      connections.clear()
    },
  }
}
