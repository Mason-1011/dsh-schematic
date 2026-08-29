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
import type { MiniRow, MiniSnapshot, SessionState, TimelineEntry } from './protocol.ts'
import {
  attributeEvent, ownerOfTool, knownToolNames, providerModule, LIVE_ACTION, SERVICE_OWNER,
  WORKFLOW_ENGINE, WORKFLOW_RECORDER, WORKFLOW_TOOLS,
} from './attribution.ts'
import type { Journal } from './journal.ts'

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

/** Structural slice of a JobSnapshot (out-of-tree: no type import). */
interface JobSlice {
  id: string
  label: string
  status: string
  detail?: string
  startedAt: number
  finishedAt?: number
}

/** Structural slice of the jobs registry service. */
interface JobsServiceSlice {
  /** Visibility is fenced by caller: an agent sees its own + unowned jobs. */
  list(caller?: unknown): JobSlice[]
  onJobsChanged(listener: (owner: unknown) => void): () => void
  onJobDone(listener: (snapshot: JobSlice, owner: unknown) => void | PromiseLike<void>): () => void
}

/** Structural slice of a workflow/* live event's run payload. */
interface WfRunSlice {
  id: string
  meta: { name: string }
}

/** Structural slice of a workflow/agent-* live event payload (end adds outcome). */
interface WfAgentSlice {
  seq: number
  label: string
  phase?: string
  outcome?: string
}

/** Structural slice of a workflow/end result payload. */
interface WfResultSlice {
  stopReason: string
  error?: string
}

/** Per-session fold state; timeline is a ring buffer newest-last. */
interface Rec {
  state: SessionState
  timeline: TimelineEntry[]
  /** callId → tool name + start envelope time + owner module, popped by tool/result. */
  inflight: Map<string, { name: string; startAt: number; module: string | null }>
  /** Open workflow run ids (recorded or live) — keeps the engine lit while any is open. */
  wfRuns: Set<string>
  /** Run id → run-start time, for run-end durations (replays compute the same answer). */
  wfRunAt: Map<string, number>
  /** `${runId}:${agentSeq}` → agent-start time, for agent-end durations. */
  wfAgentAt: Map<string, number>
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
  /** Host-scope service-read deltas (the provide/inject wiring exercised). */
  onTraffic(rows: { module: string | null; key: string; n: number }[]): void
}

/** How often state frames may leave per session (leading + trailing edge). */
const STATE_THROTTLE_MS = 250
/** Timeline ring capacity per session; snapshot serves only the tail anyway. */
const TIMELINE_CAP = 200
/** Snapshot serves at most this many recent entries per session. */
const SNAPSHOT_TAIL = 40
/** mini.json serves at most this many post-`since` entries across all rings. */
const MINI_TAIL = 120
/** Service-read rows stay mini-visible for this window (poll cadence + slack). */
const MINI_TRAFFIC_MS = 2600

/** The callId a tool/result answers, from the tool message's source. */
function toolResultCallId(data: unknown): string | undefined {
  const source = (data as { message?: { source?: unknown } } | null)?.message?.source
  if (source !== null && typeof source === 'object') {
    const callId = (source as { callId?: unknown }).callId
    if (typeof callId === 'string') return callId
  }
  return undefined
}

/** Whitespace-flatten and truncate a live workflow message (rows 80, journal 500). */
function clip(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** Evict the oldest entries when a live-only map outgrows its cap. */
function capMap<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) map.delete(map.keys().next().value as K)
}

/** Cap for live-only workflow bookkeeping (runs end and self-delete; this bounds crash leftovers). */
const WF_CAP = 128

/** Pairing values applyEvent extracts from its event switch; rowFor assembles them into rows. */
interface Pairing {
  pairedName?: string
  pairedModule: string | null
  pairedDuration?: number
  callModule: string | null
  wfAgentDuration?: number
  wfRunDuration?: number
}

export class ActivityCollector {
  private readonly recs = new Map<string, Rec>()
  private readonly listeners = new Set<ActivityListener>()
  /** Host-scope action ring (RPC mutations + live registry changes), newest-last. */
  private readonly actions: TimelineEntry[] = []
  /** Monotonic feed sequence; stamped on every emitted entry (mini.json cursor). */
  private seqCounter = 0
  /** Recent service-read rows (reader module → ctx key) with arrival time. */
  private readonly trafficRing: { m: string | null; key: string; at: number }[] = []
  /** Job ids already carrying a start row, so registry re-lists never duplicate them. */
  private readonly seenJobs = new Set<string>()
  /** Workflow run id → owning session ('' once orphaned); resolved once at the run's first live event. */
  private readonly wfOwner = new Map<string, string>()
  /** Run ids the workflow tool records durably — their live event twins are suppressed. */
  private readonly wfRecorded = new Set<string>()
  /** Run id → live start arrival time, for live settlement durations. */
  private readonly wfLiveAt = new Map<string, number>()
  /** Module specifiers currently in the graph, for tool-owner resolution. */
  private mountedModules = new Set<string>()
  private readonly warnedTools = new Set<string>()
  private readonly disposers: (() => void)[] = []

  private readonly ctx: Context
  /** The live-only observation journal; null when disabled — every hook guards on it. */
  private readonly journal: Journal | null

  constructor(ctx: Context, journal: Journal | null = null) {
    this.ctx = ctx
    this.journal = journal
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

  /**
   * Polling miniature snapshot: live session states (the strong-light source)
   * plus every entry emitted after `since` (per-session timelines and
   * host-scope actions merged, sequence-ordered) and the recent service-read
   * window. Rings are newest-last, so scans run backward and stop at `since`.
   */
  miniSnapshot(since: number): MiniSnapshot {
    const entries: MiniRow[] = []
    const collect = (rows: TimelineEntry[], sessionId: string | null): void => {
      for (let i = rows.length - 1; i >= 0 && entries.length < MINI_TAIL; i--) {
        const row = rows[i]
        if (row.seq === undefined || row.seq <= since) break
        entries.push({ i: row.seq, s: sessionId, k: row.kind, m: row.module })
      }
    }
    for (const rec of this.recs.values()) collect(rec.timeline, rec.state.sessionId)
    collect(this.actions, null)
    entries.sort((a, b) => a.i - b.i)
    const cutoff = Date.now() - MINI_TRAFFIC_MS
    return {
      cursor: this.seqCounter,
      sessions: [...this.recs.values()].map((rec) => ({
        sessionId: rec.state.sessionId,
        streaming: rec.state.streaming,
        activeModules: [...rec.state.activeModules],
      })),
      entries,
      traffic: this.trafficRing.filter((row) => row.at >= cutoff).map((row) => ({ m: row.m, key: row.key })),
    }
  }

  /** Record one host-scope action and broadcast it to the sinks. */
  noteAction(entry: TimelineEntry): void {
    entry.seq = ++this.seqCounter
    this.actions.push(entry)
    if (this.actions.length > TIMELINE_CAP) this.actions.splice(0, this.actions.length - TIMELINE_CAP)
    for (const listener of this.listeners) {
      try { listener.onAction(entry) } catch { /* a broken sink never stops the feed */ }
    }
  }

  /**
   * Registry-change fold: one start row per job id never seen before. Status
   * flips of known jobs stay silent here — the settlement row from onJobDone
   * carries the terminal transition, and re-listing after it must not.
   */
  private noteJobStarts(snapshots: JobSlice[]): void {
    for (const job of snapshots) {
      if (this.seenJobs.has(job.id)) continue
      this.seenJobs.add(job.id)
      this.journal?.write({ ev: 'job', id: job.id, label: job.label, status: job.status, startedAt: job.startedAt })
      this.noteAction({
        time: job.startedAt,
        kind: 'job',
        module: SERVICE_OWNER.jobs,
        name: job.label,
        snippet: job.status,
      })
    }
  }

  /** Settlement row: terminal status (+detail), run duration, failed flag. */
  private noteJobDone(job: JobSlice): void {
    this.seenJobs.add(job.id)
    this.journal?.write({
      ev: 'job-done', id: job.id, label: job.label, status: job.status,
      ...(job.detail !== undefined ? { detail: job.detail } : {}),
      startedAt: job.startedAt,
      ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
    })
    const entry: TimelineEntry = {
      time: job.finishedAt ?? Date.now(),
      kind: 'job',
      module: SERVICE_OWNER.jobs,
      name: job.label,
      snippet: job.detail !== undefined ? `${job.status}: ${job.detail}` : job.status,
    }
    if (job.finishedAt !== undefined) entry.durationMs = Math.max(0, job.finishedAt - job.startedAt)
    if (job.status === 'failed') entry.isError = true
    this.noteAction(entry)
  }

  /**
   * The session with the most recent in-flight workflow-tool call (LIFO).
   * Workflow events carry no session id; the tool call that started the run
   * spans its whole lifetime, so it is a reliable association anchor.
   */
  private scanWorkflowOwner(): { rec: Rec; module: string } | null {
    let best: { rec: Rec; module: string; at: number } | null = null
    for (const rec of this.recs.values()) {
      for (const call of rec.inflight.values()) {
        if (!WORKFLOW_TOOLS.has(call.module ?? '')) continue
        if (best === null || call.startAt > best.at) best = { rec, module: call.module ?? '', at: call.startAt }
      }
    }
    return best === null ? null : { rec: best.rec, module: best.module }
  }

  /**
   * Resolve a run's owning session, sticky per run id: the first live event
   * scans, everything after reuses the answer ('' marks an orphan — never
   * re-adopted, because a later unrelated workflow call would mis-own it).
   * A scan that finds the recording tool also marks the run as durably
   * recorded, suppressing its live twins. The first-seen moment journals the
   * wf-owner record replay needs to attribute this run's phase/log rows.
   */
  private wfResolve(run: WfRunSlice): Rec | null {
    const owner = this.wfOwner.get(run.id)
    if (owner !== undefined) {
      const rec = owner === '' ? undefined : this.recs.get(owner)
      return rec ?? null
    }
    const found = this.scanWorkflowOwner()
    this.wfOwner.set(run.id, found?.rec.state.sessionId ?? '')
    capMap(this.wfOwner, WF_CAP)
    const recorded = found?.module === WORKFLOW_RECORDER
    if (recorded) this.wfRecorded.add(run.id)
    this.journal?.write({
      ev: 'wf-owner', run: run.id, name: run.meta.name,
      session: found?.rec.state.sessionId ?? null, recorded,
    })
    return found?.rec ?? null
  }

  /** Live run start: adopt the run's lighting, and row it only if unrecorded. */
  private noteWorkflowStart(run: WfRunSlice): void {
    const rec = this.wfResolve(run)
    this.wfLiveAt.set(run.id, Date.now())
    capMap(this.wfLiveAt, WF_CAP)
    if (rec === null) return
    rec.wfRuns.add(run.id)
    if (!this.wfRecorded.has(run.id)) {
      this.emitEntry(rec, { time: Date.now(), kind: 'workflow', module: WORKFLOW_ENGINE, name: run.meta.name })
    }
    this.touch(rec)
  }

  /** Live progress row (phase / log) — no durable twin exists, so always emitted. */
  private noteWorkflowRow(run: WfRunSlice, ev: 'wf-phase' | 'wf-log', detail: string): void {
    const rec = this.wfResolve(run)
    if (this.journal !== null) {
      this.journal.write(ev === 'wf-phase'
        ? { ev, run: run.id, title: clip(detail, 500) }
        : { ev, run: run.id, message: clip(detail, 500) })
    }
    const entry: TimelineEntry = { time: Date.now(), kind: 'workflow', module: WORKFLOW_ENGINE, name: run.meta.name, snippet: detail }
    if (rec === null) {
      this.noteAction(entry)
      return
    }
    this.emitEntry(rec, entry)
  }

  /** Live agent fan-out row — suppressed for recorded runs (their durable twin lands via the firehose). */
  private noteWorkflowAgentRow(run: WfRunSlice, ev: 'wf-agent' | 'wf-agent-end', agent: WfAgentSlice): void {
    if (this.wfRecorded.has(run.id)) return
    const rec = this.wfResolve(run)
    const isError = agent.outcome === 'failed'
    if (this.journal !== null) {
      this.journal.write(ev === 'wf-agent'
        ? { ev, run: run.id, seq: agent.seq, label: clip(agent.label, 500), ...(agent.phase !== undefined ? { phase: agent.phase } : {}) }
        : { ev, run: run.id, seq: agent.seq, outcome: agent.outcome ?? '' })
    }
    const entry: TimelineEntry = { time: Date.now(), kind: 'workflow', module: WORKFLOW_ENGINE, name: `#${agent.seq} ${agent.label}` }
    const snippet = ev === 'wf-agent' ? agent.phase : agent.outcome
    if (snippet !== undefined && snippet !== '') entry.snippet = snippet
    if (isError) entry.isError = true
    if (rec === null) {
      this.noteAction(entry)
      return
    }
    this.emitEntry(rec, entry)
  }

  /** Live settlement: close the run's lighting; row it only if unrecorded. */
  private noteWorkflowEnd(run: WfRunSlice, result: WfResultSlice): void {
    const rec = this.wfResolve(run)
    const startedAt = this.wfLiveAt.get(run.id)
    this.wfLiveAt.delete(run.id)
    const entry: TimelineEntry = { time: Date.now(), kind: 'workflow-end', module: WORKFLOW_ENGINE, name: run.meta.name }
    entry.snippet = result.error !== undefined ? `${result.stopReason}: ${clip(result.error)}` : result.stopReason
    if (startedAt !== undefined) entry.durationMs = Math.max(0, entry.time - startedAt)
    if (result.stopReason === 'error') entry.isError = true
    const recorded = this.wfRecorded.has(run.id)
    if (!recorded) {
      this.journal?.write({
        ev: 'wf-end', run: run.id, stopReason: result.stopReason,
        ...(result.error !== undefined ? { error: clip(result.error, 500) } : {}),
      })
    }
    if (rec === null) {
      // Orphaned AND unrecorded: the actions ring keeps the run visible.
      if (!recorded) this.noteAction(entry)
      return
    }
    rec.wfRuns.delete(run.id)
    if (!recorded) this.emitEntry(rec, entry)
    this.touch(rec)
  }

  /** Broadcast service-read deltas to the sinks; the mini ring keeps a short tail. */
  noteTraffic(rows: { module: string | null; key: string; n: number }[]): void {
    const at = Date.now()
    for (const row of rows) this.trafficRing.push({ m: row.module, key: row.key, at })
    if (this.trafficRing.length > TIMELINE_CAP) this.trafficRing.splice(0, this.trafficRing.length - TIMELINE_CAP)
    for (const listener of this.listeners) {
      try { listener.onTraffic(rows) } catch { /* a broken sink never stops the feed */ }
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
    // Background jobs are live registry state, not session events: the jobs
    // service signals its own changes through callbacks and nothing it does
    // ever reaches a session log, so the firehose above is blind to it. These
    // listeners hold the same pure-observer status — read via reflect so the
    // observer grows no topology edge, and nothing is appended or wrapped.
    const jobs = reflect.get('jobs') as JobsServiceSlice | undefined
    if (jobs !== undefined) {
      this.disposers.push(
        jobs.onJobsChanged((owner) => {
          // Owner-relative read, same terms apiproxy rides: undefined owner
          // lists the unowned set only.
          try { this.noteJobStarts(jobs.list(owner)) } catch { /* a broken registry read never stops the feed */ }
        }),
        jobs.onJobDone((snapshot) => { this.noteJobDone(snapshot) }),
      )
      // Adopt jobs that predate this mount: owned ones through each live
      // agent (visibility is fenced by owner), unowned ones through the bare
      // read. Settlements still arrive through onJobDone either way.
      if (agents !== undefined) for (const agent of agents.list()) this.noteJobStarts(jobs.list(agent))
      this.noteJobStarts(jobs.list())
    }
    // Workflow runs are live engine events with no session id in the payload:
    // rows associate through the in-flight workflow-tool call, attribute to
    // the engine provider, and never duplicate — runs the workflow tool
    // records land through the session firehose as tool-workflow/* events
    // (folded below), so their live twins stay silent; phase/log progress has
    // no durable twin and always rides this feed.
    this.disposers.push(
      on('workflow/start', ((run: WfRunSlice) => { this.noteWorkflowStart(run) }) as (...args: never[]) => void),
      on('workflow/phase', ((run: WfRunSlice, title: string) => {
        this.noteWorkflowRow(run, 'wf-phase', title)
      }) as (...args: never[]) => void),
      on('workflow/log', ((run: WfRunSlice, message: string) => {
        this.noteWorkflowRow(run, 'wf-log', clip(message))
      }) as (...args: never[]) => void),
      on('workflow/agent-start', ((run: WfRunSlice, agent: WfAgentSlice) => {
        this.noteWorkflowAgentRow(run, 'wf-agent', agent)
      }) as (...args: never[]) => void),
      on('workflow/agent-end', ((run: WfRunSlice, agent: WfAgentSlice) => {
        this.noteWorkflowAgentRow(run, 'wf-agent-end', agent)
      }) as (...args: never[]) => void),
      on('workflow/end', ((run: WfRunSlice, result: WfResultSlice) => {
        this.noteWorkflowEnd(run, result)
      }) as (...args: never[]) => void),
    )
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
      wfRuns: new Set(),
      wfRunAt: new Map(),
      wfAgentAt: new Map(),
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
    if (!emit) {
      this.applyEvent(rec, type, time, data)
      return
    }
    const entry = this.rowFor(rec, type, time, data)
    if (entry !== null) this.emitEntry(rec, entry)
  }

  /**
   * Fold a raw event window into attributed timeline rows on scratch state —
   * the replay twin of the live fold: same pairing, same attribution, no ring,
   * no broadcast, no collector state touched. History pages run through here
   * so a replayed row is byte-identical to the row the live feed would have
   * emitted for the same event.
   */
  replayRows(events: readonly { type: string; time: number; data: unknown }[]): TimelineEntry[] {
    const rec: Rec = {
      state: { sessionId: '', title: '', kind: 'main', running: false, streaming: false, inflightTools: [], activeModules: [], lastEventAt: 0 },
      timeline: [],
      inflight: new Map(),
      wfRuns: new Set(),
      wfRunAt: new Map(),
      wfAgentAt: new Map(),
      lastLlmModule: null,
      dirty: false,
      timer: undefined,
      lastFlush: 0,
    }
    const rows: TimelineEntry[] = []
    for (const event of events) {
      const entry = this.rowFor(rec, event.type, event.time, event.data)
      if (entry !== null) rows.push(entry)
    }
    // Same one-row-per-burst rule the live fold applies against its ring: on
    // scratch state nothing pushes, so collapse identical adjacent user rows here.
    return rows.filter((row, i) =>
      i === 0 || row.kind !== 'user' || rows[i - 1].kind !== 'user' || rows[i - 1].snippet !== row.snippet)
  }

  /** Apply one event's state/pairing mutations to rec (fold's switch). */
  private applyEvent(rec: Rec, type: string, time: number, data: unknown): Pairing {
    // For tool/result: the paired call's name, owner module, and duration,
    // captured while the inflight entry is still on the map.
    let pairedName: string | undefined
    let pairedModule: string | null = null
    let pairedDuration: number | undefined
    let callModule: string | null = null
    // For tool-workflow/agent-end and run-end: the paired start's duration.
    let wfAgentDuration: number | undefined
    let wfRunDuration: number | undefined
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
        return { pairedName, pairedModule, pairedDuration, callModule, wfAgentDuration, wfRunDuration }
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
      // Durable workflow records the workflow tool appends to this session's
      // log; the engine's live twins of these are suppressed (see start()).
      case 'tool-workflow/run-start': {
        const d = (data ?? {}) as { runId?: unknown }
        if (typeof d.runId === 'string') {
          rec.wfRuns.add(d.runId)
          rec.wfRunAt.set(d.runId, time)
        }
        break
      }
      case 'tool-workflow/agent-start': {
        const d = (data ?? {}) as { runId?: unknown; seq?: unknown }
        if (typeof d.runId === 'string' && typeof d.seq === 'number') rec.wfAgentAt.set(`${d.runId}:${d.seq}`, time)
        break
      }
      case 'tool-workflow/agent-end': {
        const d = (data ?? {}) as { runId?: unknown; seq?: unknown }
        if (typeof d.runId === 'string' && typeof d.seq === 'number') {
          const startedAt = rec.wfAgentAt.get(`${d.runId}:${d.seq}`)
          if (startedAt !== undefined) wfAgentDuration = Math.max(0, time - startedAt)
          rec.wfAgentAt.delete(`${d.runId}:${d.seq}`)
        }
        break
      }
      case 'tool-workflow/run-end': {
        const d = (data ?? {}) as { runId?: unknown }
        if (typeof d.runId === 'string') {
          const startedAt = rec.wfRunAt.get(d.runId)
          if (startedAt !== undefined) wfRunDuration = Math.max(0, time - startedAt)
          rec.wfRunAt.delete(d.runId)
          rec.wfRuns.delete(d.runId)
        }
        break
      }
      default:
        break
    }
    return { pairedName, pairedModule, pairedDuration, callModule, wfAgentDuration, wfRunDuration }
  }

  /**
   * Attribute one event into its timeline row against rec's pairing state:
   * applyEvent's mutations plus the same assembly the live fold always used.
   * Returns null for the noise floor and burst-duplicated user rows.
   */
  private rowFor(rec: Rec, type: string, time: number, data: unknown): TimelineEntry | null {
    const p = this.applyEvent(rec, type, time, data)
    const attributed = attributeEvent(type, data)
    if (attributed === null) return null
    // One queued prompt logs several identical user/message events (queue
    // insert + drive splices); the timeline keeps one row per burst.
    if (attributed.kind === 'user') {
      const prev = rec.timeline.at(-1)
      if (prev !== undefined && prev.kind === 'user' && prev.snippet === attributed.snippet) return null
    }
    const entry: TimelineEntry = { time, kind: attributed.kind, module: attributed.module }
    if (attributed.name !== undefined) entry.name = attributed.name
    if (p.pairedName !== undefined) entry.name = p.pairedName
    if (attributed.snippet !== undefined) entry.snippet = attributed.snippet
    if (attributed.isError !== undefined) entry.isError = attributed.isError
    if (p.pairedDuration !== undefined) entry.durationMs = p.pairedDuration
    if (attributed.provider !== undefined) entry.provider = attributed.provider
    if (attributed.model !== undefined) entry.model = attributed.model
    if (type === 'tool/call') entry.module = p.callModule
    if (type === 'tool/result') entry.module = p.pairedModule
    if (p.wfAgentDuration !== undefined) entry.durationMs = p.wfAgentDuration
    if (p.wfRunDuration !== undefined) entry.durationMs = p.wfRunDuration
    return entry
  }

  /** Stamp, ring, and broadcast one attributed entry on the session path. */
  private emitEntry(rec: Rec, entry: TimelineEntry): void {
    entry.seq = ++this.seqCounter
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
    this.journal?.write({ ev: 'agent-status', session: sessionId, status: running ? 'running' : 'idle' })
    this.touch(rec)
  }

  /** Mark rec dirty and schedule/coalesce the next state frame. */
  private touch(rec: Rec): void {
    rec.dirty = true
    rec.state.inflightTools = [...new Set([...rec.inflight.values()].map((call) => call.name))]
    rec.state.activeModules = [
      ...new Set([
        ...[...rec.inflight.values()].flatMap((call) => (call.module !== null ? [call.module] : [])),
        ...(rec.wfRuns.size > 0 ? [WORKFLOW_ENGINE] : []),
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
