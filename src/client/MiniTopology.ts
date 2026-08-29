/**
 * Composer-side live miniature: the fully-expanded domains mesh as a dot
 * constellation in a viewport-fixed panel anchored beside the composer card
 * (vertically centered on it), riding the same /schematic data the viewer
 * page uses. Dots rank by edge count and pack outward from the center — the
 * expand-all posture, one dot per package — and light with the real runtime
 * activity of the conversation the SPA is viewing (host-scope actions light
 * regardless of session; the session is read from the SPA's own persisted
 * selection). Double-click opens the viewer page at that same
 * fully-scattered state (?tab=domains&expand=all).
 *
 * Transport is a ~1.2s poll of /schematic/mini.json, NOT the viewer's SSE
 * feed: browsers cap concurrent HTTP/1.1 connections per origin, and one
 * permanently-held stream per SPA tab steals a slot from the SPA's own boot
 * RPCs (session.list / workspace.list) — enough open tabs and a refresh
 * wedges on the loading page. The panel also rides above the composer seat's
 * sticky stacking context (z 12 > seat 7) so the seat's frost surface neither
 * erases the dots nor eats their double-click. Dragging the panel body moves
 * it anywhere on screen (persisted; dropping it back beside the card
 * re-docks), the bottom-right grip resizes width and height freely, and the
 * galaxy layout re-flows to the new aspect. Dots render as hollow rings that
 * fill and glow when lit — uncategorized packages wear star tints at
 * degree-scaled brightness, a freshly lit dot ripples once, and the panel
 * wears a deep-space backdrop whose opacity the mouse wheel adjusts (both
 * themes follow the SPA's color-scheme via light-dark()). Hovering a dot
 * raises a card with its name, package id, and description (Chinese through
 * the viewer page's shared translation cache, lazily batch-translating
 * misses — the same sch.zhmap store the viewer reads and writes).
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

/** Constellation geometry: viewBox size (width fixed, height follows aspect). */
const W = 208
const H = 32
/** Panel height on screen; the CSS below reads the same number. */
const PANEL_H = 30
/** Free-resize floor (CSS px) and persistence key for the corner grip; the
    ceiling is the viewport itself — the panel can grow to a full-screen star
    map, never past the window. */
const MIN_W = 120
const MIN_H = 24
const SIZE_KEY = 'sch.mini.size'
/** Persisted free-placement origin; absent while docked to the card. */
const POS_KEY = 'sch.mini.pos'
/** v0.2.22 stored one corner-scale factor; migrated on first load. */
const SCALE_KEY = 'sch.mini.scale'
/** Backdrop opacity (wheel-adjusted, 0–1). */
const BG_KEY = 'sch.mini.bg'
/** Gap between the composer card's right edge and the panel. */
const GAP = 12
/** Weak-light TTL — same breathing-decay window the viewer page uses. */
const TTL_MS = 4000
/** Card-anchor and current-session re-measure cadence. */
const ANCHOR_MS = 800
/** mini.json poll cadence: strong lights land within one beat of the SSE feed. */
const POLL_MS = 1200

export const MINI_TOPOLOGY_CSS = `
.schMini {
  /* Family palette: light-dark() follows the SPA's color-scheme on <html>, so
     the panel matches the app theme even when it disagrees with the OS. */
  --mc1: light-dark(#2a78d6, #3987e5); --mc2: light-dark(#eb6834, #d95926);
  --mc3: light-dark(#1baf7a, #199e70); --mc4: light-dark(#eda100, #c98500);
  --mc5: light-dark(#e87ba4, #d55181); --mc6: light-dark(#008300, #0a930a);
  --mc7: light-dark(#4a3aa7, #9085e9); --mc8: light-dark(#e34948, #e66767);
  /* Star tints: a muted color-temperature spread so uncategorized packages
     read as a starfield instead of a gray dot matrix. */
  --star1: light-dark(#3b6ea8, #9fc0e8); --star2: light-dark(#5a6474, #aeb8c8);
  --star3: light-dark(#7a7263, #d8d0c0); --star4: light-dark(#946f2f, #cf9f56);
  --star5: light-dark(#9c5f57, #d4918a); --star6: light-dark(#6b5a96, #a99bd6);
  position: fixed; z-index: 12;
  cursor: grab; border-radius: 8px; overflow: hidden; user-select: none;
  color: var(--dsw-alias-label-secondary, #888);
  /* Deep-space backdrop: both layers scale with --bgA (the wheel-adjusted
     opacity), so 0 restores the fully transparent panel. */
  background-color: color-mix(in srgb, light-dark(#f2f5fa, #0a0f1c) calc(var(--bgA, 0.88) * 100%), transparent);
  background-image: radial-gradient(130% 110% at 50% 42%, color-mix(in srgb, light-dark(#ffffff, #1c2740) calc(var(--bgA, 0.88) * 60%), transparent), transparent 68%);
  /* Blur rides the same dial: at --bgA 0 the panel must be fully inert — a
     fixed backdrop-filter would keep frosting the page behind a "transparent"
     panel. */
  backdrop-filter: blur(calc(3px * var(--bgA, 0.88)));
  box-shadow: inset 0 0 0 1px light-dark(rgba(15, 23, 42, 0.1), rgba(148, 163, 184, 0.22));
  animation: schMiniIn 0.8s ease;
}
.schMini svg { display: block; width: 100%; height: 100%; }
/* The constellation's own layer: render() replaces only this subtree, so the
   grip sibling never leaves the document (an element removed from the
   document loses pointer capture, which would strand a resize drag). */
.schMiniStage { position: absolute; inset: 0; }
.schMini line { stroke: currentColor; stroke-opacity: 0.16; stroke-width: 0.5; }
/* Idle dots are hollow rings at a degree-scaled brightness (--m: hubs shine,
   leaves dim); lighting fills the ring and blooms a glow. */
.schMini circle {
  fill: none; stroke: var(--c, currentColor); stroke-opacity: 0.9; stroke-width: 0.5;
  opacity: calc(0.5 + 0.5 * var(--m, 1));
  transition: opacity 0.3s ease, transform 0.3s ease, filter 0.3s ease, fill 0.3s ease;
  transform-box: fill-box; transform-origin: center;
}
.schMini circle.on {
  fill: var(--c, currentColor); opacity: 1; stroke-width: 0.8;
  transform: scale(1.5);
  filter: drop-shadow(0 0 2px var(--c, currentColor)) drop-shadow(0 0 5px var(--c, currentColor));
}
.schMini circle.hot {
  fill: var(--c, currentColor); stroke-width: 0.8;
  filter: drop-shadow(0 0 2px var(--c, currentColor)) drop-shadow(0 0 5px var(--c, currentColor)) drop-shadow(0 0 11px var(--c, currentColor));
  animation: schMiniBreath 1.5s ease-in-out infinite;
}
.schMini.drag { cursor: grabbing; }
.schMiniGrip {
  position: absolute; right: 0; bottom: 0; width: 14px; height: 14px;
  cursor: nwse-resize; opacity: 0.35; touch-action: none;
}
.schMiniGrip:hover { opacity: 0.85; }
.schMiniGrip::before {
  content: ''; position: absolute; inset: 3px;
  background: repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 4px);
}
/* One-shot expanding ring when a dot lights; removed on animationend. */
.schMiniPing {
  fill: none; stroke-width: 0.9; pointer-events: none;
  transform-box: fill-box; transform-origin: center;
  animation: schMiniPing 0.8s ease-out forwards;
}
/* Transient percentage readout while the wheel adjusts the backdrop. */
.schMiniBg {
  position: absolute; top: 4px; left: 6px; z-index: 1;
  font: 500 10px/1.4 ui-monospace, monospace; letter-spacing: 0.5px;
  opacity: 0; transition: opacity 0.25s ease; pointer-events: none;
}
/* Hover card for one dot: name, package id, description, link count. Lives on
   document.body (the panel clips overflow) and is inert to the pointer. */
.schMiniTip {
  position: fixed; z-index: 13; pointer-events: none; max-width: 260px;
  padding: 8px 10px; border-radius: 8px;
  background: light-dark(#ffffff, #141d33);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16), inset 0 0 0 1px light-dark(rgba(15, 23, 42, 0.08), rgba(148, 163, 184, 0.24));
  color: var(--dsw-alias-label-secondary, #888);
  font: 12px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
.schMiniTip .nm { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, #333); }
.schMiniTip .sw { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.schMiniTip .md { margin-top: 2px; font: 10px/1.4 ui-monospace, monospace; opacity: 0.75; word-break: break-all; }
.schMiniTip .ds { margin-top: 5px; }
.schMiniTip .lg { margin-top: 5px; font-size: 10px; opacity: 0.65; }
@keyframes schMiniPing { from { transform: scale(1); opacity: 0.85; } to { transform: scale(3); opacity: 0; } }
/* The twinkle breathes brightness as well as size — opacity pulses the whole
   lit dot + halo, which reads as a flash at any panel scale. */
@keyframes schMiniBreath { 0%, 100% { transform: scale(1.6); opacity: 0.8; } 50% { transform: scale(2.3); opacity: 1; } }
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

/** One hoverable dot in viewBox coordinates; `d` is its edge count. */
interface Star { x: number; y: number; r: number; d: number; module: string }

/** Minimal escaper for graph-sourced strings going into the hover card. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/**
 * The dot constellation: a deterministic galaxy, not a grid. Units seed on a
 * golden-angle spiral in degree order (hubs fall toward the center), then a
 * short force relaxation spreads them — pairwise repulsion keeps dots apart,
 * edge springs pull wired packages toward each other, a weak centering term
 * holds the mass inside the box. Dot radius grows with edge count, so hubs
 * read as bigger rings. Pure function of (graph, vh): re-renders never
 * reshuffle the sky.
 * @param vh - viewBox height; the relaxation uses it vertically, so a freely
 * resized panel fills edge to edge — never letterboxed, never stretched.
 * @returns the SVG markup plus the dot table in viewBox coordinates (hover
 * hit-testing walks the table; callers index the LIVE circles after
 * insertion — a map built from a detached parse would toggle classes on
 * orphaned nodes).
 */
function layout(graph: any, vh: number): { svg: string; stars: Star[] } {
  const nodes: any[] = (graph.nodes ?? []).filter((n: any) => typeof n.module === 'string')
  const deg = new Map<string, number>()
  for (const e of graph.edges ?? []) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1)
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1)
  }
  const units = [...nodes].sort((a, b) =>
    (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || String(a.id).localeCompare(String(b.id)))
  const VH = Math.max(vh, H)
  let maxDeg = 1
  for (const n of units) maxDeg = Math.max(maxDeg, deg.get(String(n.id)) ?? 1)
  /** Deterministic per-module jitter so the spiral never reads as a spiral. */
  const hash01 = (s: string): number => {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    return (h >>> 0) % 1024 / 1024
  }
  const GA = Math.PI * (3 - Math.sqrt(5))
  const px = new Float64Array(units.length)
  const py = new Float64Array(units.length)
  units.forEach((n, i) => {
    const rr = Math.sqrt((i + 0.4) / units.length)
    const a = i * GA + hash01(String(n.module)) * 0.6
    px[i] = W / 2 + rr * (W / 2 - 7) * Math.cos(a)
    py[i] = VH / 2 + rr * (VH / 2 - 4) * Math.sin(a)
  })
  const idx = new Map<string, number>()
  units.forEach((n, i) => idx.set(String(n.id), i))
  const springs: [number, number][] = []
  for (const e of graph.edges ?? []) {
    const a = idx.get(String(e.from))
    const b = idx.get(String(e.to))
    if (a !== undefined && b !== undefined) springs.push([a, b])
  }
  const rad = units.map((n) => 1.05 + 1.15 * Math.sqrt(Math.min(1, (deg.get(String(n.id)) ?? 0) / maxDeg)))
  // Repulsion ramps up with panel height: a 32-tall strip has no vertical room
  // to absorb it (strong forces jam dots into the wall clamps), while a tall
  // panel needs them — plus the radius-aware term — to give hubs breathing room.
  const ramp = Math.min(1, (VH - 32) / 108)
  const REP = 40 + 40 * ramp
  const CUT = 1100 + 500 * ramp
  const RW = 0.5 * ramp
  const fx = new Float64Array(units.length)
  const fy = new Float64Array(units.length)
  for (let t = 0; t < 90; t++) {
    fx.fill(0)
    fy.fill(0)
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const dx = px[i] - px[j]
        const dy = py[i] - py[j]
        const d2 = dx * dx + dy * dy + 0.02
        if (d2 > CUT) continue
        const f = REP * (1 + (rad[i] + rad[j]) * RW) / d2 / Math.sqrt(d2)
        fx[i] += f * dx; fy[i] += f * dy
        fx[j] -= f * dx; fy[j] -= f * dy
      }
    }
    for (const [a, b] of springs) {
      const dx = px[b] - px[a]
      const dy = py[b] - py[a]
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01
      const f = Math.min(d * 0.028, 1.2) / d
      fx[a] += dx * f; fy[a] += dy * f
      fx[b] -= dx * f; fy[b] -= dy * f
    }
    const cool = 0.9 * (1 - t / 90) + 0.1
    for (let i = 0; i < units.length; i++) {
      fx[i] += (W / 2 - px[i]) * 0.008
      fy[i] += (VH / 2 - py[i]) * 0.008
      px[i] = Math.max(4, Math.min(W - 4, px[i] + Math.max(-3, Math.min(3, fx[i] * cool))))
      py[i] = Math.max(3, Math.min(VH - 3, py[i] + Math.max(-3, Math.min(3, fy[i] * cool))))
    }
  }
  // The force phase contracts the seeded envelope: repulsion is local and the
  // centering pull wins at the fringe, so long panels keep empty bands at both
  // ends of their long axis. Rescale the solved bounds back onto the frame —
  // the wall clamps keep the solved box inside [4,W-4]x[3,VH-3], so each axis
  // only stretches (factor >= 1), gaps grow or hold, and no overlap appears.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < units.length; i++) {
    minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i])
    minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i])
  }
  const sx = maxX - minX > 1 ? (W - 8) / (maxX - minX) : 1
  const sy = maxY - minY > 1 ? (VH - 6) / (maxY - minY) : 1
  for (let i = 0; i < units.length; i++) {
    px[i] = 4 + (px[i] - minX) * sx
    py[i] = 3 + (py[i] - minY) * sy
  }
  const pos = new Map<string, [number, number]>()
  units.forEach((n, i) => pos.set(String(n.id), [px[i], py[i]]))
  let lines = ''
  for (const e of graph.edges ?? []) {
    const a = pos.get(String(e.from))
    const b = pos.get(String(e.to))
    if (a === undefined || b === undefined) continue
    lines += `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`
  }
  let circles = ''
  const stars: Star[] = []
  units.forEach((n, i) => {
    const [x, y] = pos.get(String(n.id)) ?? [W / 2, VH / 2]
    const v = n.spine === true ? '--mc1' : CAT_VAR[n.category as string]
    // Uncategorized packages wear a deterministic star tint instead of the
    // page ink; every dot carries its magnitude for the brightness ramp.
    const c = v ?? `--star${1 + Math.floor(hash01(String(n.module)) * 6)}`
    const m = Math.sqrt(Math.min(1, (deg.get(String(n.id)) ?? 0) / maxDeg)).toFixed(2)
    circles += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad[i].toFixed(2)}" data-module="${n.module}" style="--c: var(${c}); --m: ${m}"/>`
    stars.push({ x, y, r: rad[i], d: deg.get(String(n.id)) ?? 0, module: String(n.module) })
  })
  const svg = `<svg viewBox="0 0 ${W} ${VH.toFixed(1)}" preserveAspectRatio="xMidYMid meet">${lines}${circles}</svg>`
  return { svg, stars }
}

/**
 * Mount the constellation panel beside the composer card. The panel is
 * viewport-fixed and re-anchored to the card's rect on a short poll — the
 * card grows with the draft and its rect is the only placement authority
 * while docked. Dragging the body free-places it anywhere (clamped into the
 * viewport, persisted; dropping beside the card re-docks). Hidden while
 * docked with no composer on screen or no room beside the card. The panel
 * lives directly under document.body, outside the SPA's React tree, so
 * re-renders never churn it. The bottom-right grip resizes the panel freely
 * (width and height independent, persisted per browser) and the galaxy
 * re-flows to the new aspect; dots are hollow rings that fill and glow when
 * lit. Hovering a dot raises a card naming the package and its description.
 * @param t locale seat for the panel title and hover-card meta line.
 * @param lang active locale thunk; Chinese hover cards reuse the viewer
 * page's shared description translations.
 * @returns disposer removing the panel and its feeds.
 */
export function mountMiniTopology(t: (key: 'miniTitle' | 'tipLinks') => string, lang: () => string): () => void {
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

  /** Field-diagnosis seat: row-kind tail + live counters, read from the console. */
  const debug = { frames: [] as string[], polls: 0, ok: -1, active: 0, dots: 0, graphAt: 0, w: W, h: PANEL_H, bg: 0.88, tip: '' }
  ;(window as unknown as Record<string, unknown>).__schMini = debug

  /** Panel size in CSS px, persisted so the panel stays what the user set. */
  let panelW = W
  let panelH = PANEL_H
  /** Saved sizes may predate a window resize; re-clamp into today's viewport
      (window fit wins over the floor on tiny windows). */
  const fitW = (w: number): number => Math.min(window.innerWidth - 4, Math.max(MIN_W, w))
  const fitH = (h: number): number => Math.min(window.innerHeight - 4, Math.max(MIN_H, h))
  try {
    const raw = localStorage.getItem(SIZE_KEY)
    if (raw !== null) {
      const m = /^(\d+)x(\d+)$/.exec(raw)
      if (m !== null) {
        panelW = fitW(Number(m[1]))
        panelH = fitH(Number(m[2]))
      }
    } else {
      // v0.2.22's single-scale store carries over once; Number(null) is 0,
      // so only a present key with a positive number counts.
      const legacy = Number(localStorage.getItem(SCALE_KEY))
      if (Number.isFinite(legacy) && legacy > 0) {
        panelW = fitW(Math.round(W * legacy))
        panelH = fitH(Math.round(PANEL_H * legacy))
      }
    }
  } catch { /* an unreadable store just keeps the default size */ }
  const applySize = (): void => {
    host.style.width = `${Math.round(panelW)}px`
    host.style.height = `${Math.round(panelH)}px`
    debug.w = Math.round(panelW)
    debug.h = Math.round(panelH)
  }
  applySize()

  /** Constellation layer: render() churns only this subtree, never the grip. */
  const stage = document.createElement('div')
  stage.className = 'schMiniStage'
  host.appendChild(stage)

  const grip = document.createElement('div')
  grip.className = 'schMiniGrip'
  grip.title = `${label} — ⇲`
  host.appendChild(grip)
  grip.addEventListener('dblclick', (e) => e.stopPropagation())
  /** True while a body drag or grip resize is in flight — hover cards hide. */
  let dragging = false
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation()
    e.preventDefault()
    dragging = true
    hideTip()
    const startX = e.clientX
    const startY = e.clientY
    const startW = panelW
    const startH = panelH
    const move = (ev: PointerEvent): void => {
      if (ev.buttons === 0) return
      // Size stops at the window edges instead of tripping anchor()'s
      // no-room hide — the user is mid-gesture, not asking to dismiss.
      const rect = host.getBoundingClientRect()
      panelW = Math.min(window.innerWidth - 8 - rect.left, Math.max(MIN_W, startW + ev.clientX - startX))
      panelH = Math.min(window.innerHeight - 8 - rect.top, Math.max(MIN_H, startH + ev.clientY - startY))
      applySize()
      if (Math.abs(viewH() - drawnVh) > 2) render()
      anchor()
    }
    const up = (ev: PointerEvent): void => {
      // Window-level capture-phase listeners: the drag keeps flowing even if
      // the pointer outruns the 14px grip or a rebuild moves it.
      dragging = false
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      try { localStorage.setItem(SIZE_KEY, `${Math.round(panelW)}x${Math.round(panelH)}`) } catch { /* unwritable store loses the size, not the panel */ }
      ev.preventDefault()
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  })

  /** Backdrop opacity: wheel over the panel adjusts, persisted per browser. */
  let bgA = 0.88
  try {
    // Number(null) is 0 — only a present key counts, or a never-touched
    // browser would boot with a fully transparent backdrop.
    const raw = localStorage.getItem(BG_KEY)
    if (raw !== null) {
      const v = Number(raw)
      if (Number.isFinite(v) && v >= 0 && v <= 1) bgA = v
    }
  } catch { /* an unreadable store keeps the default backdrop */ }
  const bgHint = document.createElement('div')
  bgHint.className = 'schMiniBg'
  host.appendChild(bgHint)
  let bgHintTimer = 0
  /** Native panel tooltip text (title + backdrop dial); blanked while a dot's
      hover card is up so the two never stack. */
  const panelTitle = (): string => `${label} · ⌀ ${Math.round(bgA * 100)}%`
  /** silent skips the sync event — mount and event-driven applications never
     re-broadcast, so the panel ↔ settings slider loop can't self-echo. */
  const applyBg = (silent = false): void => {
    host.style.setProperty('--bgA', bgA.toFixed(2))
    bgHint.textContent = `${Math.round(bgA * 100)}%`
    bgHint.style.opacity = '1'
    window.clearTimeout(bgHintTimer)
    bgHintTimer = window.setTimeout(() => { bgHint.style.opacity = '0' }, 700)
    try { localStorage.setItem(BG_KEY, bgA.toFixed(2)) } catch { /* an unwritable store loses the setting, not the panel */ }
    host.title = panelTitle()
    debug.bg = bgA
    if (!silent) window.dispatchEvent(new CustomEvent('sch-mini-bg', { detail: bgA }))
  }
  applyBg(true)
  /** The settings slider drives the same dial through this event. */
  const onBgEvent = (e: Event): void => {
    const v = (e as CustomEvent<number>).detail
    if (typeof v === 'number' && v >= 0 && v <= 1 && Math.abs(v - bgA) > 1e-3) {
      bgA = v
      applyBg(true)
    }
  }
  window.addEventListener('sch-mini-bg', onBgEvent)
  host.addEventListener('wheel', (e) => {
    e.preventDefault()
    bgA = Math.min(1, Math.max(0, bgA - e.deltaY * 0.0012))
    applyBg()
  }, { passive: false })

  /**
   * Free placement: null while docked to the composer card; once set, the
   * panel stays where the user dropped it (clamped into the viewport) until
   * they drop it back beside the card, which re-docks.
   */
  let freePos: { x: number; y: number } | null = null
  try {
    const m = /^(-?\d+),(-?\d+)$/.exec(localStorage.getItem(POS_KEY) ?? '')
    if (m !== null) freePos = { x: Number(m[1]), y: Number(m[2]) }
  } catch { /* an unreadable store just re-docks the panel */ }
  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragging = true
    hideTip()
    host.classList.add('drag')
    const sx = e.clientX
    const sy = e.clientY
    const r = host.getBoundingClientRect()
    const ox = r.left
    const oy = r.top
    const move = (ev: PointerEvent): void => {
      if (ev.buttons === 0) return
      freePos = {
        x: Math.max(2, Math.min(window.innerWidth - panelW - 2, ox + ev.clientX - sx)),
        y: Math.max(2, Math.min(window.innerHeight - panelH - 2, oy + ev.clientY - sy)),
      }
      anchor()
    }
    const up = (): void => {
      dragging = false
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      host.classList.remove('drag')
      // Dropping beside the composer card re-docks: anchored placement and
      // the card-follow again, instead of a frozen screen position.
      const card = findCard()
      const pr = host.getBoundingClientRect()
      if (card !== null) {
        const cr = card.getBoundingClientRect()
        if (Math.abs(pr.left - (cr.right + GAP)) < 30 && pr.top < cr.bottom && pr.bottom > cr.top) freePos = null
      }
      try {
        if (freePos === null) localStorage.removeItem(POS_KEY)
        else localStorage.setItem(POS_KEY, `${Math.round(freePos.x)},${Math.round(freePos.y)}`)
      } catch { /* an unwritable store loses the position, not the panel */ }
      anchor()
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  })

  const ac = new AbortController()
  /** module → constellation dots currently drawn for it. */
  let dotsByModule = new Map<string, Element[]>()
  /** Dot table for hover hit-testing, in the viewBox of the last render. */
  let stars: Star[] = []
  /** module → graph node, the hover card's name/description source. */
  let nodeByModule = new Map<string, any>()
  /** ctx key → provider modules, for lighting both ends of a service read. */
  let keyOwners = new Map<string, string[]>()
  const active = new Map<string, { until: number; strong: boolean }>()
  let currentSession = readCurrentSession()

  /** Modules whose dots are currently lit — dark→lit transitions ripple once. */
  const litMods = new Set<string>()
  /** One-shot expanding ring at a freshly lit dot, in its own stroke color. */
  const ripple = (el: Element): void => {
    const svg = stage.querySelector('svg')
    const color = getComputedStyle(el).stroke
    if (svg === null || color === '' || color === 'none') return
    const ping = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    ping.setAttribute('class', 'schMiniPing')
    for (const a of ['cx', 'cy', 'r']) ping.setAttribute(a, el.getAttribute(a) ?? '')
    ping.style.stroke = color
    ping.addEventListener('animationend', () => ping.remove())
    svg.appendChild(ping)
  }
  const paint = (): void => {
    const now = Date.now()
    for (const [module, els] of dotsByModule) {
      const info = active.get(module)
      const lit = info !== undefined && (info.strong || info.until >= now)
      if (lit && !litMods.has(module)) {
        litMods.add(module)
        for (const el of els) ripple(el)
      } else if (!lit) litMods.delete(module)
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
  /** One mini row: host-scope rows light unconditionally, session rows only for the viewed chat. */
  const onRow = (row: { i: number; s: string | null; k: string; m: string | null }): void => {
    if (row.m === null || row.m === '') return
    if (row.s === null) { touch(row.m, false); return }
    if (row.s !== currentSession || row.k === 'user') return
    if (row.k === 'tool-end' || row.k === 'llm') downgrade(row.m)
    else touch(row.m, row.k === 'tool')
  }

  let lastGraph: any = null
  let signature = ''
  /** viewBox height the last render drew; aspect changes diff against it. */
  let drawnVh = 0
  /** viewBox height matching the panel's aspect, floored at the base H. */
  const viewH = (): number => Math.max((W * panelH) / panelW, H)
  const render = (): void => {
    if (lastGraph === null) return
    drawnVh = viewH()
    debug.graphAt = Date.now()
    const out = layout(lastGraph, drawnVh)
    stage.innerHTML = out.svg
    stars = out.stars
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
    nodeByModule = new Map<string, any>()
    for (const n of lastGraph.nodes ?? []) {
      if (typeof n.module === 'string') nodeByModule.set(n.module, n)
    }
    keyOwners = new Map<string, string[]>()
    for (const n of lastGraph.nodes ?? []) {
      for (const key of n.provides ?? []) {
        const list = keyOwners.get(key) ?? []
        if (typeof n.module === 'string') list.push(n.module)
        keyOwners.set(key, list)
      }
    }
    paint()
  }

  // ------- hover card: name + explanation for the dot under the pointer -------
  /** Body-level (the panel clips its overflow) and inert to the pointer. */
  const tip = document.createElement('div')
  tip.className = 'schMiniTip'
  tip.style.display = 'none'
  document.body.appendChild(tip)
  /** en→zh description translations, shared with the viewer page. */
  const zhMap = new Map<string, string>()
  try {
    const saved = localStorage.getItem('sch.zhmap')
    if (saved !== null) for (const [k, v] of JSON.parse(saved) as [string, string][]) zhMap.set(k, v)
  } catch { /* a corrupt store just leaves hover cards in English */ }
  const pendingZh = new Set<string>()
  /** The star whose card is up; '' while hidden. */
  let tipStar: Star | null = null
  function hideTip(): void {
    if (tipStar === null) return
    tipStar = null
    tip.style.display = 'none'
    debug.tip = ''
    host.title = panelTitle()
  }
  /** Card content for one star: swatch, short name, package id, description, link count. */
  function fillTip(s: Star): void {
    const node = nodeByModule.get(s.module)
    const dot = dotsByModule.get(s.module)?.[0]
    const swatch = dot === undefined ? 'transparent' : getComputedStyle(dot).stroke
    const name = typeof node?.label === 'string' && node.label !== '' ? node.label : s.module
    let html = `<div class="nm"><i class="sw" style="background:${swatch}"></i>${esc(name)}</div>`
    html += `<div class="md">${esc(s.module)}</div>`
    const desc = node?.desc
    if (typeof desc === 'string' && desc !== '') {
      const zh = lang() === 'zh' ? (zhMap.get(desc) ?? desc) : desc
      html += `<div class="ds">${esc(zh)}</div>`
      ensureZhDesc(desc)
    }
    html += `<div class="lg">${s.d} ${esc(t('tipLinks'))}</div>`
    tip.innerHTML = html
  }
  /** Translate one missing description (zh locale only); a late landing refreshes the open card. */
  function ensureZhDesc(desc: string): void {
    if (lang() !== 'zh' || zhMap.has(desc) || pendingZh.has(desc)) return
    pendingZh.add(desc)
    void fetch('/schematic/api/translate-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: [desc] }),
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: any) => {
        if (d === null || !Array.isArray(d.zh) || typeof d.zh[0] !== 'string') return
        zhMap.set(desc, d.zh[0])
        // Same store the viewer page reads: one translation serves both faces.
        try { localStorage.setItem('sch.zhmap', JSON.stringify([...zhMap])) } catch { /* quota exceeded: the translation lives in memory */ }
        if (tipStar !== null && nodeByModule.get(tipStar.module)?.desc === desc) fillTip(tipStar)
      })
      .catch(() => { /* a failed request keeps English for this description */ })
      .finally(() => { pendingZh.delete(desc) })
  }
  /** Nearest star to a screen point within a generous hit radius, or null. */
  function starAt(cx: number, cy: number): Star | null {
    const svg = stage.querySelector('svg')
    if (svg === null || stars.length === 0) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const vh = Math.max(drawnVh, H)
    const scale = Math.min(rect.width / W, rect.height / vh)
    const vx = (cx - rect.left - (rect.width - W * scale) / 2) / scale
    const vy = (cy - rect.top - (rect.height - vh * scale) / 2) / scale
    let best: Star | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const s of stars) {
      const d = Math.hypot(s.x - vx, s.y - vy)
      if (d < Math.max(s.r + 4, 6) && d < bestD) { best = s; bestD = d }
    }
    return best
  }
  stage.addEventListener('pointermove', (e: PointerEvent) => {
    if (dragging) { hideTip(); return }
    const s = starAt(e.clientX, e.clientY)
    if (s === null) { hideTip(); return }
    if (tipStar?.module !== s.module) {
      tipStar = s
      debug.tip = s.module
      // Blank the native panel tooltip while the card is up — the two would
      // stack over the same pointer.
      host.title = ''
      fillTip(s)
      tip.style.display = ''
    }
    // Follow the cursor, flipping at the window edges.
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    let x = e.clientX + 14
    if (x + w > window.innerWidth - 8) x = e.clientX - 14 - w
    let y = e.clientY + 16
    if (y + h > window.innerHeight - 8) y = e.clientY - 16 - h
    tip.style.left = `${Math.max(8, Math.round(x))}px`
    tip.style.top = `${Math.max(8, Math.round(y))}px`
  })
  stage.addEventListener('pointerleave', hideTip)

  const applyGraph = (graph: any): void => {
    const next = JSON.stringify([
      (graph.nodes ?? []).map((n: any) => [n.id, n.module, n.category]),
      (graph.edges ?? []).map((e: any) => [e.from, e.to]),
    ])
    if (next === signature) return
    signature = next
    lastGraph = graph
    render()
  }
  const load = (): void => {
    void fetch('/schematic/graph.json', { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((g) => { if (g !== null) applyGraph(g) })
      .catch(() => { /* a failed poll keeps the last constellation */ })
  }
  load()
  const poll = window.setInterval(() => { if (!document.hidden) load() }, 30000)

  /** mini.json poll: states every beat, entries diffed on the sequence cursor. */
  let since = -1
  const pollMini = (): void => {
    if (document.hidden) return
    void fetch(`/schematic/mini.json?since=${Math.max(0, since)}`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((snap: any) => {
        if (snap === null) { debug.ok = -1; return }
        debug.ok = 1
        debug.polls++
        const cursor = typeof snap.cursor === 'number' ? snap.cursor : 0
        // First poll only adopts the cursor: the states below light anything
        // already running, without replaying the whole tail as flashes.
        if (since >= 0) {
          for (const row of snap.entries ?? []) {
            debug.frames.push(String(row.k))
            if (debug.frames.length > 30) debug.frames.shift()
            onRow(row)
          }
        }
        since = cursor
        for (const s of snap.sessions ?? []) hydrate(s)
        for (const r of snap.traffic ?? []) {
          if (typeof r.m === 'string' && r.m !== '') touch(r.m, false)
          for (const owner of keyOwners.get(r.key) ?? []) touch(owner, false)
        }
        debug.active = active.size
        debug.dots = dotsByModule.size
      })
      .catch(() => { /* a failed poll keeps the last lights */ })
  }
  pollMini()
  const miniTimer = window.setInterval(pollMini, POLL_MS)
  const wake = (): void => { if (!document.hidden) pollMini() }
  document.addEventListener('visibilitychange', wake)
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
      pollMini()
    }
    if (freePos !== null) {
      // Free placement: hold the dropped origin, clamped into the viewport —
      // the card's coming and going no longer moves or hides the panel.
      host.style.display = ''
      host.style.left = `${Math.round(Math.max(2, Math.min(window.innerWidth - panelW - 2, freePos.x)))}px`
      host.style.top = `${Math.round(Math.max(2, Math.min(window.innerHeight - panelH - 2, freePos.y)))}px`
      return
    }
    const card = findCard()
    if (card === null) { host.style.display = 'none'; hideTip(); return }
    const r = card.getBoundingClientRect()
    const left = Math.round(r.right + GAP)
    if (left + panelW > window.innerWidth - 8) { host.style.display = 'none'; hideTip(); return }
    host.style.display = ''
    host.style.left = `${left}px`
    // A panel taller than the card centers on it; one taller than the window
    // pins inside the viewport instead of overflowing past its top edge.
    host.style.top = `${Math.round(Math.max(2, Math.min(window.innerHeight - panelH - 2, r.top + (r.height - panelH) / 2)))}px`
  }
  anchor()
  const anchorTimer = window.setInterval(anchor, ANCHOR_MS)

  return () => {
    window.clearInterval(anchorTimer)
    window.clearInterval(miniTimer)
    window.clearInterval(poll)
    window.clearInterval(sweep)
    document.removeEventListener('visibilitychange', wake)
    window.removeEventListener('sch-mini-bg', onBgEvent)
    ac.abort()
    host.remove()
    tip.remove()
  }
}
