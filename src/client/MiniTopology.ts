/**
 * Composer-side live miniature: the fully-expanded domains mesh as a dot
 * constellation in a viewport-fixed panel anchored beside the composer card
 * (vertically centered on it), riding the same /schematic data the viewer
 * page uses. Dots rank by edge count and pack outward from the center — the
 * expand-all posture, one dot per package — and light with the real runtime
 * activity of the conversation the SPA is viewing (SSE /schematic/events;
 * host-scope actions light regardless of session; the session is read from
 * the SPA's own persisted selection). Double-click opens the viewer page at
 * that same fully-scattered state (?tab=domains&expand=all).
 */

/**
 * Category id → the palette slot the viewer page paints that family with.
 * 'core-spine' is not a graph category: the core trio carries a spine flag
 * and rides the 'other' bucket — layout() maps those nodes to --mc1 itself.
 */
const CAT_VAR: Record<string, string> = {
  'model-layer': '--mc2',
  'execution-seams': '--mc3',
  'extension-seams': '--mc4',
  'session-data': '--mc5',
  'interaction-policy': '--mc6',
  'host-protocol': '--mc7',
  'web-client': '--mc8',
}

/** Constellation geometry: viewBox size and dot radius. */
const W = 208
const H = 32
const DOT_R = 1.4
/** Panel height on screen; the CSS below reads the same number. */
const PANEL_H = 30
/** Gap between the composer card's right edge and the panel. */
const GAP = 12
/** Weak-light TTL — same breathing-decay window the viewer page uses. */
const TTL_MS = 4000
/** Card-anchor and current-session re-measure cadence. */
const ANCHOR_MS = 800

export const MINI_TOPOLOGY_CSS = `
.schMini {
  --mc1: #2a78d6; --mc2: #eb6834; --mc3: #1baf7a; --mc4: #eda100;
  --mc5: #e87ba4; --mc6: #008300; --mc7: #4a3aa7; --mc8: #e34948;
  width: ${W}px; height: ${PANEL_H}px;
  position: fixed; z-index: 5;
  cursor: zoom-in; border-radius: 8px; overflow: hidden; user-select: none;
  background: rgba(127, 127, 127, 0.08);
  color: var(--dsw-alias-label-secondary, #888);
  box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.25);
  animation: schMiniIn 0.8s ease;
}
@media (prefers-color-scheme: dark) {
  .schMini {
    --mc1: #3987e5; --mc2: #d95926; --mc3: #199e70; --mc4: #c98500;
    --mc5: #d55181; --mc6: #0a930a; --mc7: #9085e9; --mc8: #e66767;
  }
}
.schMini svg { display: block; width: 100%; height: 100%; }
.schMini line { stroke: currentColor; stroke-opacity: 0.16; stroke-width: 0.5; }
.schMini circle {
  fill: var(--c, currentColor); opacity: 0.9;
  transition: opacity 0.3s ease, transform 0.3s ease, filter 0.3s ease;
  transform-box: fill-box; transform-origin: center;
}
.schMini circle.on { opacity: 1; transform: scale(1.75); filter: drop-shadow(0 0 2px var(--c, currentColor)); }
.schMini circle.hot {
  opacity: 1; filter: drop-shadow(0 0 3px var(--c, currentColor));
  animation: schMiniBreath 1.5s ease-in-out infinite;
}
@keyframes schMiniBreath { 0%, 100% { transform: scale(1.6); } 50% { transform: scale(2.2); } }
@keyframes schMiniIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }`

/**
 * The conversation the SPA itself is viewing, from its persisted selection
 * (the same key the viewer page follows).
 */
function readCurrentSession(): string {
  try {
    const parsed = JSON.parse(localStorage.getItem('dsh.sessions.current') ?? '')
    return typeof parsed?.sessionId === 'string' ? parsed.sessionId : ''
  } catch {
    return ''
  }
}

/**
 * The composer card: the card-styled ancestor of the composer's textarea.
 * CSS-module hashes keep the local class name, so "card" is the stable hook.
 */
function findCard(): HTMLElement | null {
  for (const ta of document.querySelectorAll('textarea')) {
    const card = ta.closest('[class*="card"]')
    if (card instanceof HTMLElement) return card
  }
  return null
}

/**
 * The dot constellation: rank by unit edge count, pack outward on elliptical
 * rings (center 1 dot, ring r holds 6r), deterministic on ties by node id.
 * @returns the SVG markup for the panel (callers index the LIVE circles
 * after insertion — a map built from a detached parse would toggle classes
 * on orphaned nodes).
 */
function layout(graph: any): string {
  const nodes: any[] = (graph.nodes ?? []).filter((n: any) => typeof n.module === 'string')
  const deg = new Map<string, number>()
  for (const e of graph.edges ?? []) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1)
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1)
  }
  const units = [...nodes].sort((a, b) =>
    (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || String(a.id).localeCompare(String(b.id)))
  // smallest ring count whose 1 + 3R(R+1) capacity holds every unit
  let rings = 1
  while (1 + 3 * rings * (rings + 1) < units.length) rings++
  const stepX = (W / 2 - 6) / rings
  const stepY = (H / 2 - 2.2) / rings
  const pos = new Map<string, [number, number]>()
  let ring = 0
  let cap = 1
  let k = 0
  for (const n of units) {
    if (k === cap) { ring++; cap = 6 * ring; k = 0 }
    const a = (k / cap) * Math.PI * 2 + ring * 0.55
    const rx = ring === 0 ? 0 : 4 + stepX * ring
    const ry = ring === 0 ? 0 : 1.4 + stepY * ring
    pos.set(n.id, [W / 2 + rx * Math.cos(a), H / 2 + ry * Math.sin(a)])
    k++
  }
  let lines = ''
  for (const e of graph.edges ?? []) {
    const a = pos.get(e.from)
    const b = pos.get(e.to)
    if (a === undefined || b === undefined) continue
    lines += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`
  }
  let circles = ''
  for (const n of units) {
    const [x, y] = pos.get(n.id) ?? [W / 2, H / 2]
    const v = n.spine === true ? '--mc1' : CAT_VAR[n.category as string]
    circles += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${DOT_R}" data-module="${n.module}"${v === undefined ? '' : ` style="--c: var(${v})"`}/>`
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${lines}${circles}</svg>`
}

/**
 * Mount the constellation panel beside the composer card. The panel is
 * viewport-fixed and re-anchored to the card's rect on a short poll — the
 * card grows with the draft and its rect is the only placement authority.
 * Hidden while no composer is on screen or the window has no room beside the
 * card. The panel lives directly under document.body, outside the SPA's
 * React tree, so re-renders never churn it.
 * @param t locale seat for the tooltip.
 * @returns disposer removing the panel and its feeds.
 */
export function mountMiniTopology(t: (key: 'miniTitle') => string): () => void {
  const host = document.createElement('div')
  const label = t('miniTitle')
  host.className = 'schMini'
  host.title = label
  host.setAttribute('role', 'img')
  host.setAttribute('aria-label', label)
  host.style.display = 'none'
  host.addEventListener('dblclick', () => {
    window.open('/schematic?tab=domains&expand=all', '_blank', 'noopener')
  })
  document.body.appendChild(host)

  const ac = new AbortController()
  let es: EventSource | undefined
  /** module → constellation dots currently drawn for it. */
  let dotsByModule = new Map<string, Element[]>()
  /** ctx key → provider modules, for lighting both ends of a service read. */
  let keyOwners = new Map<string, string[]>()
  const active = new Map<string, { until: number; strong: boolean }>()
  let currentSession = readCurrentSession()

  const paint = (): void => {
    const now = Date.now()
    for (const [module, els] of dotsByModule) {
      const info = active.get(module)
      const lit = info !== undefined && (info.strong || info.until >= now)
      for (const el of els) {
        el.classList.toggle('on', lit && !(info?.strong ?? false))
        el.classList.toggle('hot', lit && (info?.strong ?? false))
      }
    }
  }
  const touch = (module: unknown, strong: boolean): void => {
    if (typeof module !== 'string' || module === '') return
    const prev = active.get(module)
    const nextStrong = strong || (prev?.strong ?? false)
    active.set(module, { until: nextStrong ? Number.POSITIVE_INFINITY : Date.now() + TTL_MS, strong: nextStrong })
    paint()
  }
  const downgrade = (module: unknown): void => {
    if (typeof module !== 'string') return
    const prev = active.get(module)
    if (prev !== undefined && prev.strong) active.set(module, { until: Date.now() + TTL_MS, strong: false })
    paint()
  }
  /** Rebuild the highlight map from one session's full state (connect, or a state frame). */
  const hydrate = (s: any): void => {
    if (s.sessionId !== currentSession) return
    const mods: string[] = Array.isArray(s.activeModules) ? s.activeModules : []
    for (const m of mods) {
      if (!active.has(m)) active.set(m, { until: Number.POSITIVE_INFINITY, strong: true })
    }
    const llm = mods.find((m) => m.includes('/dsh-llm'))
    if (llm !== undefined && s.streaming === true) active.set(llm, { until: Number.POSITIVE_INFINITY, strong: true })
    else if (llm !== undefined && active.get(llm)?.strong === true) {
      active.set(llm, { until: Date.now() + TTL_MS, strong: false })
    }
    paint()
  }
  const onFrame = (frame: any): void => {
    if (frame.type === 'snapshot') {
      for (const s of frame.sessions ?? []) hydrate(s)
      return
    }
    if (frame.type === 'state') { hydrate(frame.state); return }
    if (frame.type === 'activity') {
      if (frame.sessionId !== currentSession) return
      const entry = frame.entry
      if (entry.module === null || entry.kind === 'user') return
      if (entry.kind === 'tool-end' || entry.kind === 'llm') downgrade(entry.module)
      else touch(entry.module, entry.kind === 'tool')
      return
    }
    if (frame.type === 'action') { touch(frame.entry?.module, false); return }
    if (frame.type === 'traffic') {
      for (const r of frame.rows ?? []) {
        touch(r.module, false)
        for (const owner of keyOwners.get(r.key) ?? []) touch(owner, false)
      }
    }
  }

  let signature = ''
  const applyGraph = (graph: any): void => {
    const next = JSON.stringify([
      (graph.nodes ?? []).map((n: any) => [n.id, n.module, n.category]),
      (graph.edges ?? []).map((e: any) => [e.from, e.to]),
    ])
    if (next === signature) return
    signature = next
    debug.graphAt = Date.now()
    debug.dots = 0
    host.innerHTML = layout(graph)
    // Index the circles AFTER insertion: the live nodes are the only ones
    // whose classes paint.
    dotsByModule = new Map<string, Element[]>()
    for (const el of [...host.querySelectorAll('circle[data-module]')]) {
      const module = el.getAttribute('data-module') ?? ''
      const list = dotsByModule.get(module) ?? []
      list.push(el)
      dotsByModule.set(module, list)
    }
    debug.dots = dotsByModule.size
    keyOwners = new Map<string, string[]>()
    for (const n of graph.nodes ?? []) {
      for (const key of n.provides ?? []) {
        const list = keyOwners.get(key) ?? []
        if (typeof n.module === 'string') list.push(n.module)
        keyOwners.set(key, list)
      }
    }
    paint()
  }
  const load = (): void => {
    void fetch('/schematic/graph.json', { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((g) => { if (g !== null) applyGraph(g) })
      .catch(() => { /* a failed poll keeps the last constellation */ })
  }
  load()
  const poll = window.setInterval(() => { if (!document.hidden) load() }, 30000)

  es = new EventSource('/schematic/events')
  /** Field-diagnosis seat: frame tail + live counters, read from the console. */
  const debug = { frames: [] as string[], es: -1, active: 0, dots: 0, graphAt: 0 }
  ;(window as unknown as Record<string, unknown>).__schMini = debug
  es.onopen = () => { debug.es = es?.readyState ?? -1 }
  es.onerror = () => { debug.es = es?.readyState ?? -1 }
  es.onmessage = (ev) => {
    try {
      const frame = JSON.parse(ev.data) as { type?: string }
      debug.frames.push(String(frame?.type))
      if (debug.frames.length > 30) debug.frames.shift()
      debug.es = es?.readyState ?? -1
      debug.active = active.size
      debug.dots = dotsByModule.size
      onFrame(frame)
      debug.active = active.size
    } catch { /* malformed frame: skip it */ }
  }
  const sweep = window.setInterval(() => {
    const now = Date.now()
    let dirty = false
    for (const [module, info] of active) {
      if (!info.strong && info.until < now) { active.delete(module); dirty = true }
    }
    if (dirty) paint()
  }, 600)

  /** Follow the composer card's rect and the SPA's current session. */
  const anchor = (): void => {
    const next = readCurrentSession()
    if (next !== currentSession) {
      currentSession = next
      active.clear()
      paint()
    }
    const card = findCard()
    if (card === null) { host.style.display = 'none'; return }
    const r = card.getBoundingClientRect()
    const left = Math.round(r.right + GAP)
    if (left + W > window.innerWidth - 8) { host.style.display = 'none'; return }
    host.style.display = ''
    host.style.left = `${left}px`
    host.style.top = `${Math.round(r.top + (r.height - PANEL_H) / 2)}px`
  }
  anchor()
  const anchorTimer = window.setInterval(anchor, ANCHOR_MS)

  return () => {
    window.clearInterval(anchorTimer)
    window.clearInterval(poll)
    window.clearInterval(sweep)
    ac.abort()
    es?.close()
    host.remove()
  }
}
