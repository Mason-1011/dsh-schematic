/**
 * Runtime-activity collector: a pure observer of the session-event firehose.
 *
 * A root-scope `ctx.on('session/event')` listener receives EVERY session's
 * post-commit events (subagents included) — the same channel
 * session-telemetry and token-meter ride. This module folds that stream into
 * per-session SessionState + attributed timeline entries and re-emits them to
 * subscribed sinks (the SSE layer). It never appends to any session log and
 * never wraps a service;洪峰 assistant/chunk events only flip a bit here.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionState, TimelineEntry } from './protocol.ts'
import { attributeEvent, ownerOfTool, knownToolNames, providerModule, LIVE_ACTION } from './attribution.ts'

/** Structural slice of a Session (out-of-tree: no type import). */
interface SessionSlice {
  id: string
  events: readonly { type: string; time: number; data: unknown }[]
}

/** Structural slice of the sessions registry service. */
interface SessionsServiceSlice {
  list(): SessionSlice[]
}

/** Structural slice of an Agent handle. */
interface AgentSlice {
  session: SessionSlice
  status: 'idle' | 'running'
}

/** Structural slice of the agents registry service. */
interface AgentsServiceSlice {
  list(): AgentSlice[]
}

/** Per-session fold state; timeline is a ring buffer newest-last. */
interface Rec {
  state: SessionState
  timeline: TimelineEntry[]
  /** callId → tool name + start envelope time + owner module, popped by tool/result. */
  inflight: Map<string, { name: string; startAt: number; module: string | null }>
  /** Provider route module of the current/last model request, for streaming highlight. */
  lastLlmModule: string | null
  dirty: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  lastFlush: number
}

export interface ActivityListener {
  onActivity(sessionId: string, entry: TimelineEntry): void
  onState(sessionId: string, state: SessionState): void
  /** Host-scope action (RPC mutation or live registry change). */
  onAction(entry: TimelineEntry): void
}

/** How often state frames may leave per session (leading + trailing edge). */
const STATE_THROTTLE_MS = 250
/** Timeline ring capacity per session; snapshot serves only the tail anyway. */
const TIMELINE_CAP = 200
/** Snapshot serves at most this many recent entries per session. */
const SNAPSHOT_TAIL = 40

/** The callId a tool/result answers, from the tool message's source. */
function toolResultCallId(data: unknown): string | undefined {
  const source = (data as { message?: { source?: unknown } } | null)?.message?.source
  if (source !== null && typeof source === 'object') {
    const callId = (source as { callId?: unknown }).callId
    if (typeof callId === 'string') return callId
  }
  return undefined
}

export class ActivityCollector {
  private readonly recs = new Map<string, Rec>()
  private readonly listeners = new Set<ActivityListener>()
  /** Host-scope action ring (RPC mutations + live registry changes), newest-last. */
  private readonly actions: TimelineEntry[] = []
  /** Module specifiers currently in the graph, for tool-owner resolution. */
  private mountedModules = new Set<string>()
  private readonly warnedTools = new Set<string>()
  private readonly disposers: (() => void)[] = []

  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * Subscribe to activity; the sink gets the current snapshot first, then
   * incremental frames. Returns the unsubscribe function.
   */
  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Current full state — the reconnect/self-heal anchor frame. */
  snapshot(): { sessions: SessionState[]; timeline: { sessionId: string; entries: TimelineEntry[] }[]; actions: TimelineEntry[] } {
    const sessions: SessionState[] = []
    const timeline: { sessionId: string; entries: TimelineEntry[] }[] = []
    for (const rec of this.recs.values()) {
      sessions.push({
        ...rec.state,
        inflightTools: [...rec.state.inflightTools],
        activeModules: [...rec.state.activeModules],
      })
      if (rec.timeline.length > 0) {
        timeline.push({ sessionId: rec.state.sessionId, entries: rec.timeline.slice(-SNAPSHOT_TAIL) })
      }
    }
    return { sessions, timeline, actions: this.actions.slice(-SNAPSHOT_TAIL) }
  }

  /** Record one host-scope action and broadcast it to the sinks. */
  noteAction(entry: TimelineEntry): void {
    this.actions.push(entry)
    if (this.actions.length > TIMELINE_CAP) this.actions.splice(0, this.actions.length - TIMELINE_CAP)
    for (const listener of this.listeners) {
      try { listener.onAction(entry) } catch { /* a broken sink never stops the feed */ }
    }
  }

  /**
   * Refresh the mounted-module set used to resolve tool owners. Called at
   * boot and whenever the graph is rebuilt (the /graph.json route calls it),
   * so HMR-mounted tools re-resolve without a collector restart.
   */
  noteGraphModules(modules: Iterable<string>): void {
    this.mountedModules = new Set(modules)
  }

  /** Boot-time attribution drift log: tool names whose owners are not mounted. */
  logDrift(): void {
    const missing = knownToolNames().filter((name) => ownerOfTool(name, this.mountedModules) === null)
    if (missing.length > 0) {
      this.ctx.logger.info(
        `[dsh-schematic] activity attribution: ${knownToolNames().length - missing.length}/${knownToolNames().length} tool owners mounted; unmounted (will grey out if seen): ${missing.join(', ')}`,
      )
    }
  }

  /**
   * Install the firehose listeners and adopt every live session. The
   * returned disposer removes listeners and flushes pending state.
   */
  start(): () => void {
    const ctx = this.ctx
    // reflect.get is the dependency-free accessor: reading ctx.sessions as a
    // property would require listing it in inject, and an observer must not
    // grow a topology edge. Undefined when the host provides no such service.
    const reflect = ctx.reflect as unknown as { get(name: string): unknown }
    const sessions = reflect.get('sessions') as SessionsServiceSlice | undefined
    const agents = reflect.get('agents') as AgentsServiceSlice | undefined
    // Out-of-tree: this repo's type view of Context lacks dsh's merged Events
    // map (the declarations live in dsh packages), so subscribe through an
    // erased binding; inside the harness process the real map has the keys.
    const on = ctx.on as unknown as
      (name: string, listener: (...args: never[]) => void) => () => void

    this.disposers.push(
      on('session/created', ((session: SessionSlice) => { this.adopt(session) }) as (...args: never[]) => void),
      on('session/disposed', ((session: SessionSlice) => { this.drop(session.id) }) as (...args: never[]) => void),
      on('session/event', ((session: SessionSlice, event: { type: string; seq: number; time: number; data: unknown }) => {
        this.ingest(session.id, event)
      }) as (...args: never[]) => void),
      on('agent/status', (({ agent, status }: { agent: AgentSlice; status: 'idle' | 'running' }) => {
        this.setRunning(agent.session.id, status === 'running')
      }) as (...args: never[]) => void),
      // Live registry events (non-durable, never in any session log): each
      // tracked one becomes a host-scope action row attributed to its owner.
      ...Object.keys(LIVE_ACTION).map((name) =>
        on(name, (() => {
          this.noteAction({ time: Date.now(), kind: 'action', module: LIVE_ACTION[name], name })
        }) as (...args: never[]) => void)),
    )

    if (sessions !== undefined) for (const session of sessions.list()) this.adopt(session)
    if (agents !== undefined) {
      for (const agent of agents.list()) this.setRunning(agent.session.id, agent.status === 'running')
    }
    return () => {
      for (const dispose of this.disposers.splice(0)) dispose()
      for (const rec of this.recs.values()) {
        if (rec.timer !== undefined) clearTimeout(rec.timer)
      }
    }
  }

  /** Fold a pre-existing session's log (boot adoption) into state + timeline tail. */
  private adopt(session: SessionSlice): void {
    if (this.recs.has(session.id)) return
    const rec: Rec = {
      state: {
        sessionId: session.id,
        title: '',
        kind: 'main',
        running: false,
        streaming: false,
        inflightTools: [],
        activeModules: [],
        lastEventAt: 0,
      },
      timeline: [],
      inflight: new Map(),
      lastLlmModule: null,
      dirty: true,
      timer: undefined,
      lastFlush: 0,
    }
    this.recs.set(session.id, rec)
    for (const event of session.events) this.fold(rec, event.type, event.time, event.data, false)
    rec.state.lastEventAt = session.events.at(-1)?.time ?? 0
    this.touch(rec)
  }

  private drop(sessionId: string): void {
    const rec = this.recs.get(sessionId)
    if (rec === undefined) return
    if (rec.timer !== undefined) clearTimeout(rec.timer)
    this.recs.delete(sessionId)
    for (const listener of this.listeners) {
      listener.onState(sessionId, { ...rec.state, disposed: true })
    }
  }

  private ingest(sessionId: string, event: { type: string; time: number; data: unknown }): void {
    const rec = this.recs.get(sessionId)
    if (rec === undefined) return
    this.fold(rec, event.type, event.time, event.data, true)
    rec.state.lastEventAt = event.time
    this.touch(rec)
  }

  /**
   * Fold one event into rec. @param emit false while replaying a boot
   * adoption's history (states settle, no per-event frames).
   */
  private fold(rec: Rec, type: string, time: number, data: unknown, emit: boolean): void {
    // For tool/result: the paired call's name, owner module, and duration,
    // captured while the inflight entry is still on the map.
    let pairedName: string | undefined
    let pairedModule: string | null = null
    let pairedDuration: number | undefined
    let callModule: string | null = null
    switch (type) {
      case 'session/title': {
        const title = (data as { title?: unknown } | null)?.title
        if (typeof title === 'string' && title.length > 0) rec.state.title = title
        break
      }
      case 'subagent/descriptor':
        rec.state.kind = 'subagent'
        break
      case 'assistant/chunk':
        rec.state.streaming = true
        return
      case 'assistant/message': {
        rec.state.streaming = false
        // Remember the serving provider so the streaming bit (and snapshot
        // hydration) can attribute it even before the completed message.
        const source = (data as { message?: { source?: unknown } } | null)?.message?.source
        if (source !== null && typeof source === 'object'
          && (source as { kind?: unknown }).kind === 'model') {
          const provider = (source as { provider?: unknown }).provider
          if (typeof provider === 'string' && provider !== '') rec.lastLlmModule = providerModule(provider)
        }
        break
      }
      case 'request/header': {
        // Arrives before the chunks; gives lastLlmModule for turn one.
        const provider = ((data ?? {}) as { header?: { config?: { provider?: unknown } } }).header?.config?.provider
        if (typeof provider === 'string' && provider !== '') rec.lastLlmModule = providerModule(provider)
        break
      }
      case 'turn/end':
        rec.state.streaming = false
        break
      case 'tool/call': {
        const d = (data ?? {}) as { callId?: unknown; name?: unknown }
        const name = typeof d.name === 'string' ? d.name : '?'
        callModule = this.toolOwner(name)
        if (typeof d.callId === 'string') rec.inflight.set(d.callId, { name, startAt: time, module: callModule })
        break
      }
      case 'tool/result': {
        const callId = toolResultCallId(data)
        if (callId !== undefined) {
          const pending = rec.inflight.get(callId)
          if (pending !== undefined) {
            pairedName = pending.name
            pairedModule = pending.module
            pairedDuration = Math.max(0, time - pending.startAt)
          }
          rec.inflight.delete(callId)
        }
        break
      }
      default:
        break
    }
    if (!emit) return
    const attributed = attributeEvent(type, data)
    if (attributed === null) return
    // One queued prompt logs several identical user/message events (queue
    // insert + drive splices); the timeline keeps one row per burst.
    if (attributed.kind === 'user') {
      const prev = rec.timeline.at(-1)
      if (prev !== undefined && prev.kind === 'user' && prev.snippet === attributed.snippet) return
    }
    const entry: TimelineEntry = { time, kind: attributed.kind, module: attributed.module }
    if (attributed.name !== undefined) entry.name = attributed.name
    if (pairedName !== undefined) entry.name = pairedName
    if (attributed.snippet !== undefined) entry.snippet = attributed.snippet
    if (attributed.isError !== undefined) entry.isError = attributed.isError
    if (pairedDuration !== undefined) entry.durationMs = pairedDuration
    if (attributed.provider !== undefined) entry.provider = attributed.provider
    if (attributed.model !== undefined) entry.model = attributed.model
    if (type === 'tool/call') entry.module = callModule
    if (type === 'tool/result') entry.module = pairedModule
    rec.timeline.push(entry)
    if (rec.timeline.length > TIMELINE_CAP) rec.timeline.splice(0, rec.timeline.length - TIMELINE_CAP)
    for (const listener of this.listeners) listener.onActivity(rec.state.sessionId, entry)
  }

  /** Owner module for a tool name, warning once per unknown name. */
  private toolOwner(name: string): string | null {
    const module = ownerOfTool(name, this.mountedModules)
    if (module === null && !this.warnedTools.has(name)) {
      this.warnedTools.add(name)
      this.ctx.logger.warn(`[dsh-schematic] activity: tool "${name}" has no owner in the attribution table; entry will grey out`)
    }
    return module
  }

  private setRunning(sessionId: string, running: boolean): void {
    const rec = this.recs.get(sessionId)
    if (rec === undefined || rec.state.running === running) return
    rec.state.running = running
    this.touch(rec)
  }

  /** Mark rec dirty and schedule/coalesce the next state frame. */
  private touch(rec: Rec): void {
    rec.dirty = true
    rec.state.inflightTools = [...new Set([...rec.inflight.values()].map((call) => call.name))]
    rec.state.activeModules = [
      ...new Set([
        ...[...rec.inflight.values()].flatMap((call) => (call.module !== null ? [call.module] : [])),
        ...(rec.state.streaming && rec.lastLlmModule !== null ? [rec.lastLlmModule] : []),
      ]),
    ]
    const now = Date.now()
    if (rec.timer === undefined && now - rec.lastFlush >= STATE_THROTTLE_MS) {
      this.flush(rec, now)
      return
    }
    if (rec.timer !== undefined) return
    rec.timer = setTimeout(() => {
      rec.timer = undefined
      if (rec.dirty) this.flush(rec, Date.now())
    }, STATE_THROTTLE_MS)
  }

  private flush(rec: Rec, now: number): void {
    rec.dirty = false
    rec.lastFlush = now
    const state = {
      ...rec.state,
      inflightTools: [...rec.state.inflightTools],
      activeModules: [...rec.state.activeModules],
    }
    for (const listener of this.listeners) listener.onState(rec.state.sessionId, state)
  }
}
