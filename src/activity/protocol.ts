/**
 * Frame protocol for /schematic/events (SSE) — the runtime-activity feed.
 *
 * "State is full, events are incremental": every frame is either a complete
 * SessionState (snapshot/state) or one attributed timeline entry (activity).
 * A client that missed frames heals on the next snapshot, which the server
 * always sends first on (re)connect — no replay protocol exists by design.
 */

/** Bump on any breaking change to a frame's field meaning. */
export const PROTOCOL_VERSION = 2

/**
 * Live per-session state. `inflightTools` holds tool NAMES (not call ids) so
 * the page can render them without another lookup; uniqueness within a turn
 * is not guaranteed and not needed for display.
 */
export interface SessionState {
  sessionId: string
  title: string
  /** 'subagent' once the session's log carries a subagent/descriptor event. */
  kind: 'main' | 'subagent'
  running: boolean
  /** True between the first assistant/chunk and the assembling assistant/message. */
  streaming: boolean
  inflightTools: string[]
  /**
   * Modules with work in flight right now (in-flight tool owners, plus the
   * streaming provider while chunks flow). The page re-hydrates its
   * highlight map from this on (re)connect, so a page opened mid-run lights
   * up immediately instead of waiting for the next event.
   */
  activeModules: string[]
  /** Unix ms of the last observed event (envelope time); 0 when never. */
  lastEventAt: number
  /** Set on the final state frame when the session was disposed. */
  disposed?: boolean
}

/**
 * One attributed timeline entry. `module` is the owning package's module
 * specifier (the graph's currency) or null when unattributed — the page
 * renders those grey; it is never an error.
 */
export interface TimelineEntry {
  /** Unix ms, from the session-event envelope. */
  time: number
  kind:
    | 'user'
    | 'llm'
    | 'tool'
    | 'tool-end'
    | 'turn'
    | 'approval'
    | 'todo'
    | 'compaction'
    | 'retry'
    | 'subagent'
    | 'title'
    /** Host-scope operation: an RPC mutation (archive, settings write…) or a live registry change. */
    | 'action'
  module: string | null
  /** Tool name, turn ordinal label, provider id, or RPC/live-event name depending on kind. */
  name?: string
  /** Short user-text snippet for kind 'user'. */
  snippet?: string
  isError?: boolean
  durationMs?: number
  provider?: string
  model?: string
}

export type Frame =
  | { type: 'hello'; proto: number; serverTime: number }
  | {
    type: 'snapshot'
    sessions: SessionState[]
    timeline: { sessionId: string; entries: TimelineEntry[] }[]
    /** Host-scope action ring (RPC mutations + live registry changes). */
    actions: TimelineEntry[]
  }
  | { type: 'activity'; sessionId: string; entry: TimelineEntry }
  | { type: 'state'; sessionId: string; state: SessionState }
  /** Host-scope action — no sessionId: these are process-level, not per-chat. */
  | { type: 'action'; entry: TimelineEntry }

/** Serialize one SSE frame (`data: <json>\n\n`). */
export function frameText(frame: Frame): string {
  return `data: ${JSON.stringify(frame)}\n\n`
}
