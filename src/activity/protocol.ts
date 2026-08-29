/**
 * Frame protocol for /schematic/events (SSE) — the runtime-activity feed.
 *
 * "State is full, events are incremental": every frame is either a complete
 * SessionState (snapshot/state) or one attributed timeline entry (activity).
 * A client that missed frames heals on the next snapshot, which the server
 * always sends first on (re)connect — no replay protocol exists by design.
 */

/** Bump on any breaking change to a frame's field meaning. */
export const PROTOCOL_VERSION = 3

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
   * Modules with work in flight right now (in-flight tool owners, the
   * streaming provider while chunks flow, and the workflow engine while one
   * of the session's workflow runs is open). The page re-hydrates its
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
    /** Host-scope background-job lifecycle row from the jobs registry's own callbacks. */
    | 'job'
    /**
     * Workflow-run progress row (start / phase / log / agent fan-out): durable
     * tool-workflow records, or live workflow/* events for unrecorded runs.
     */
    | 'workflow'
    /** Workflow-run settlement row; downgrades the run's strong glow like a tool-end. */
    | 'workflow-end'
  module: string | null
  /** Tool name, turn ordinal label, provider id, RPC/live-event name, or workflow run/agent label depending on kind. */
  name?: string
  /** Short user-text snippet for kind 'user'. */
  snippet?: string
  isError?: boolean
  durationMs?: number
  provider?: string
  model?: string
  /**
   * Monotonic feed sequence stamped by the collector on every emitted entry
   * (timeline rows and host-scope actions alike). The polling miniature diffs
   * on it; SSE consumers can ignore it.
   */
  seq?: number
}

/**
 * One incremental row of /schematic/mini.json — sequence, owning session (null
 * for host-scope rows), kind, and owner module. Deliberately tiny: the
 * miniature polls this endpoint instead of holding an SSE connection, because
 * browsers cap HTTP/1.1 connections per origin and every permanently-held
 * stream steals one slot from the SPA's own boot RPCs.
 */
export interface MiniRow {
  i: number
  s: string | null
  k: TimelineEntry['kind']
  m: string | null
}

/** /schematic/mini.json response: full live states plus entries after `since`. */
export interface MiniSnapshot {
  /** Current top of the entry sequence; the client's next `since`. */
  cursor: number
  sessions: { sessionId: string; streaming: boolean; activeModules: string[] }[]
  entries: MiniRow[]
  /** Service reads in the recent window (idempotent to re-see). */
  traffic: { m: string | null; key: string }[]
}

export type Frame =
  | { type: 'hello'; proto: number; serverTime: number }
  | {
    type: 'snapshot'
    sessions: SessionState[]
    timeline: { sessionId: string; entries: TimelineEntry[] }[]
    /** Host-scope action ring (RPC mutations, live registry changes, job rows). */
    actions: TimelineEntry[]
  }
  | { type: 'activity'; sessionId: string; entry: TimelineEntry }
  | { type: 'state'; sessionId: string; state: SessionState }
  /** Host-scope action — no sessionId: these are process-level, not per-chat. */
  | { type: 'action'; entry: TimelineEntry }
  /**
   * Service-read deltas since the previous frame: the provide/inject wiring
   * actually exercised, reader module → ctx key. Live-only by design —
   * cumulative counts ride graph.json instead, so no replay is needed.
   */
  | { type: 'traffic'; rows: { module: string | null; key: string; n: number }[] }

/** Serialize one SSE frame (`data: <json>\n\n`). */
export function frameText(frame: Frame): string {
  return `data: ${JSON.stringify(frame)}\n\n`
}
