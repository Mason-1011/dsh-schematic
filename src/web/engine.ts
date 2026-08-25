/**
 * Framework-free topology-viewer engine for the standalone /schematic page
 * (boot.ts mounts it into #app). One file owns layout, rendering, filters,
 * and the page language switch:
 *
 *   - UI chrome strings come from the local bilingual dictionary (T below)
 *     and switch instantly with the header 中/EN toggle.
 *   - English data prose (plugin / group descriptions) is translated through
 *     the host half's /api/translate-batch and cached in localStorage.
 *     Identifiers — plugin names, module paths, inject keys, states — never
 *     translate.
 *
 * mountSchematic(container) builds the whole viewer DOM inside the container
 * (every rule scoped under .sch) and returns a dispose() that removes every
 * window-level listener and the container contents. The footer shows the
 * build stamp injected by scripts/build-client.mjs, so a tab still running
 * old code is visible at a glance during development.
 */

/** Build timestamp injected via esbuild `define` (scripts/build-client.mjs). */
declare const __SCH_BUILD__: string | undefined

type Lang = 'en' | 'zh'

/** Bilingual chrome dictionary; t(key, params) interpolates {name} tokens. */
const T: Record<string, { en: string; zh: string }> = {
  subtitle:        { en: '/ live topology', zh: '/ 实时拓扑' },
  overview:        { en: '‹ overview', zh: '‹ 总览' },
  loading:         { en: 'loading…', zh: '加载中…' },
  searchPh:        { en: 'filter by name, key, state…', zh: '按名称、键、状态筛选…' },
  table:           { en: 'table', zh: '表格' },
  langTitle:       { en: '切换到中文', zh: 'Switch to English' },
  trans:           { en: 'translating {d}/{n}…', zh: '翻译中 {d}/{n}…' },
  emptyDetail:     { en: 'Click anything for details (groups included); double-click a group to open it.', zh: '点击任意元素(含分组)查看详情;双击分组进入。' },
  fit:             { en: 'fit', zh: '适配' },
  refreshTitle:    { en: 'Re-fetch the live snapshot', zh: '重新拉取实时快照' },
  stats:           { en: '{m} mounted · {s} shown · {e} edges', zh: '已挂载 {m} · 显示 {s} · 边 {e}' },
  statsFailed:     { en: ' · {f} failed', zh: ' · 失败 {f}' },
  scopeStats:      { en: '{l} · {a}/{b} members · {n} internal edges', zh: '{l} · 成员 {a}/{b} · 内部边 {n}' },
  zoneExt:         { en: 'EXTERNAL CTX KEYS', zh: '外部上下文键' },
  zoneIn:          { en: 'INJECTED BY', zh: '注入方' },
  zoneOut:         { en: 'MEMBERS INJECT', zh: '成员注入' },
  tipExt:          { en: 'injected by {n} unit(s), provided outside this process', zh: '由 {n} 个单元注入,由本进程之外提供' },
  tipGrouped:      { en: '(grouped)', zh: '(分组)' },
  tipUnits:        { en: '{n} mounted units', zh: '{n} 个已挂载单元' },
  tipClusterHint:  { en: 'click for details, double-click to open', zh: '单击看详情,双击进入' },
  tipInGroup:      { en: 'in group: {l}', zh: '所在分组:{l}' },
  tipProvides:     { en: 'provides: {k}', zh: '提供:{k}' },
  tipInject:       { en: 'inject: {k}', zh: '注入:{k}' },
  tipStates:       { en: 'states: {k}', zh: '状态:{k}' },
  dtState:         { en: 'state', zh: '状态' },
  dtOrigin:        { en: 'origin', zh: '来源' },
  dtForm:          { en: 'form', zh: '形态' },
  dtCategory:      { en: 'category', zh: '类别' },
  dtGroup:         { en: 'group', zh: '分组' },
  dtRank:          { en: 'dep rank', zh: '依赖层级' },
  dtProvides:      { en: 'provides', zh: '提供' },
  dtInject:        { en: 'inject', zh: '注入' },
  originEntry:     { en: 'config entry', zh: '配置项' },
  originRuntime:   { en: 'programmatic mount', zh: '运行时挂载' },
  originRuntimeTip:{ en: 'programmatic', zh: '运行时' },
  other:           { en: 'other', zh: '其他' },
  capabilityGroup: { en: 'capability group · {n} mounted units', zh: '能力分组 · {n} 个已挂载单元' },
  seamKeys:        { en: 'seam keys', zh: '接缝键' },
  openGroup:       { en: 'open group ↗', zh: '进入分组 ↗' },
  ask:             { en: 'Ask in chat ↗', zh: '在对话中询问 ↗' },
  askTitle:        { en: 'Opens a fresh conversation with a starter question prefilled — ask anything there', zh: '打开一个新对话并预填一条提问,可在对话中随便问' },
  thUnit:          { en: 'unit', zh: '单元' },
  thEntry:         { en: 'entry', zh: '入口' },
  thState:         { en: 'state', zh: '状态' },
  thForm:          { en: 'form', zh: '形态' },
  thGroup:         { en: 'group', zh: '分组' },
  thDesc:          { en: 'description', zh: '描述' },
  thProvides:      { en: 'provides', zh: '提供' },
  thInject:        { en: 'inject', zh: '注入' },
  metaLine:        { en: 'live snapshot · {t} · source: this dsh process', zh: '实时快照 · {t} · 来源:当前 dsh 进程' },
  loadFail:        { en: 'failed to load /schematic/graph.json — is the plugin mounted?', zh: '加载 /schematic/graph.json 失败——插件挂载了吗?' },
  originLbl:       { en: 'origin:', zh: '来源:' },
  extKeys:         { en: 'external keys', zh: '外部键' },
}

const CATS = [
  { id: 'core-spine',         label: 'Core spine',              zh: '核心脊柱',           css: '--s1' },
  { id: 'model-layer',        label: 'Model layer',             zh: '模型层',             css: '--s2' },
  { id: 'execution-seams',    label: 'Execution seams',         zh: '执行接缝',           css: '--s3' },
  { id: 'extension-seams',    label: 'Extension seams',         zh: '扩展接缝',           css: '--s4' },
  { id: 'session-data',       label: 'Session & data',          zh: '会话与数据',         css: '--s5' },
  { id: 'interaction-policy', label: 'Interaction & policy',    zh: '交互与策略',         css: '--s6' },
  { id: 'host-protocol',      label: 'Host, boot & protocol',   zh: '宿主·启动与协议',    css: '--s7' },
  { id: 'web-client',         label: 'Web client',              zh: '网页客户端',         css: '--s8' },
]

const CSS = `
.sch { color-scheme: light;
  --surface-1: #fcfcfb; --page: #f9f9f7;
  --ink-1: #0b0b0b; --ink-2: #52514e; --ink-3: #898781;
  --grid: #e1e0d9; --baseline: #c3c2b7; --border: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
  --s5: #e87ba4; --s6: #008300; --s7: #4a3aa7; --s8: #e34948;
}
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) .sch {
  color-scheme: dark;
  --surface-1: #1a1a19; --page: #0d0d0d;
  --ink-1: #ffffff; --ink-2: #c3c2b7; --ink-3: #898781;
  --grid: #2c2c2a; --baseline: #383835; --border: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
} }
:root[data-theme="dark"] .sch {
  color-scheme: dark;
  --surface-1: #1a1a19; --page: #0d0d0d;
  --ink-1: #ffffff; --ink-2: #c3c2b7; --ink-3: #898781;
  --grid: #2c2c2a; --baseline: #383835; --border: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767;
}
.sch, .sch * { box-sizing: border-box; }
.sch {
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--page); color: var(--ink-1);
  display: flex; flex-direction: column; height: 100%; min-height: 460px;
}
.sch header {
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  padding: 10px 16px; background: var(--surface-1); border-bottom: 1px solid var(--border);
}
.sch header h1 { font-size: 15px; margin: 0; font-weight: 650; }
.sch header h1 span { color: var(--ink-3); font-weight: 400; }
.sch .crumb { display: none; }
.sch .crumb.on { display: inline-flex; }
.sch .stats { color: var(--ink-2); font-variant-numeric: tabular-nums; }
.sch .trans { color: var(--ink-3); font-variant-numeric: tabular-nums; }
.sch .trans:empty { display: none; }
.sch header .spacer { flex: 1; }
.sch input[type="search"], .sch button, .sch select {
  font: inherit; color: var(--ink-1); background: var(--surface-1);
  border: 1px solid var(--border); border-radius: 7px; padding: 4px 10px;
}
.sch input[type="search"] { width: 220px; }
.sch button { cursor: pointer; }
.sch button[aria-pressed="true"] { border-color: var(--ink-2); font-weight: 600; }
.sch .filters {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 16px; background: var(--surface-1); border-bottom: 1px solid var(--border);
}
.sch .filters .sep { width: 1px; align-self: stretch; background: var(--border); margin: 0 4px; }
.sch .filters .lbl { color: var(--ink-3); font-size: 12px; }
.sch .chip {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px;
  cursor: pointer; user-select: none; color: var(--ink-2); background: var(--surface-1);
}
.sch .chip .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); }
.sch .chip .dot.ext { background: transparent; border: 1.5px dashed var(--ink-3); }
.sch .chip .dot.plain { background: var(--ink-3); }
.sch .chip.off { opacity: 0.38; }
.sch .chip b { color: var(--ink-1); font-weight: 600; }
.sch main { flex: 1; display: flex; min-height: 0; }
.sch .stage { flex: 1; min-width: 0; position: relative; }
.sch svg.graph { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
.sch svg.graph.panning { cursor: grabbing; }
.sch aside {
  width: 320px; overflow-y: auto; padding: 14px 16px;
  background: var(--surface-1); border-left: 1px solid var(--border);
}
.sch aside h2 { font-size: 13px; margin: 0 0 2px; word-break: break-all; }
.sch aside .dir { color: var(--ink-3); margin-bottom: 10px; }
.sch aside dl { margin: 0; display: grid; grid-template-columns: 96px 1fr; gap: 4px 10px; }
.sch aside dt { color: var(--ink-3); }
.sch aside dd { margin: 0; word-break: break-all; }
.sch aside .keys { display: flex; flex-wrap: wrap; gap: 4px; }
.sch aside .keys code, .sch aside .keys .ext {
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px;
}
.sch aside .keys .ext { border-style: dashed; color: var(--ink-3); }
.sch aside .empty { color: var(--ink-3); }
.sch aside .desc { font-size: 12px; color: var(--ink-2); margin: 0 0 10px; }
.sch aside .members { display: flex; flex-direction: column; gap: 7px; margin: 4px 0 10px; }
.sch aside .m b { font-size: 12px; font-weight: 600; display: block; word-break: break-all; }
.sch aside .m span { font-size: 11.5px; color: var(--ink-2); }
.sch aside .open-btn { margin-top: 2px; font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--surface-1); color: var(--ink-1); cursor: pointer; }
.sch aside .ask-btn { display: block; margin-top: 10px; font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--surface-1); color: var(--ink-1); cursor: pointer; }
.sch .tableView { display: none; flex: 1; overflow: auto; padding: 12px 16px; }
.sch .tableView table { border-collapse: collapse; width: 100%; font-size: 12px; }
.sch .tableView th, .sch .tableView td {
  text-align: left; padding: 4px 10px; border-bottom: 1px solid var(--grid);
  white-space: nowrap;
}
.sch .tableView th { color: var(--ink-3); font-weight: 600; position: sticky; top: 0; background: var(--surface-1); }
.sch footer {
  display: flex; gap: 10px; align-items: center;
  padding: 6px 16px; background: var(--surface-1); border-top: 1px solid var(--border);
  color: var(--ink-3); font-size: 12px;
}
.sch .tooltip {
  position: fixed; pointer-events: none; z-index: 10; display: none;
  max-width: 340px; background: var(--surface-1); border: 1px solid var(--border);
  border-radius: 8px; padding: 8px 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.14);
}
.sch .tooltip .t { font-weight: 650; word-break: break-all; }
.sch .tooltip .d { color: var(--ink-3); }
.sch .tooltip .k { color: var(--ink-2); font: 11px ui-monospace, Menlo, monospace; }
.sch .node rect { fill: var(--surface-1); stroke: var(--c); stroke-width: 1.5; rx: 7; }
.sch .node text { fill: var(--ink-1); font-size: 11.5px; dominant-baseline: middle; pointer-events: none; }
.sch .zone-h { fill: var(--ink-3); font-size: 10.5px; font-weight: 600; letter-spacing: .08em; }
.sch .node .accent { fill: var(--c); }
.sch .node .bar { fill: var(--c); }
.sch .node.cluster rect { stroke-width: 2; cursor: pointer; }
.sch .node.ghost rect { stroke-dasharray: 4 3; }
.sch .node.ghost text { fill: var(--ink-2); }
.sch .node.fail rect { stroke: var(--s8); stroke-width: 2; }
.sch .node.wait rect { stroke-dasharray: 4 3; }
.sch .node.ext rect { stroke-dasharray: 4 3; stroke: var(--ink-3); }
.sch .node.ext text { fill: var(--ink-3); font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; }
.sch .edge { fill: none; stroke: var(--c); stroke-opacity: 0.34; stroke-width: 1.5; }
.sch .dim { opacity: 0.16; }
.sch .edge.on { stroke-opacity: 0.95; stroke-width: 2.2; }
`

/** Idempotent stylesheet injection. */
function injectStyles(): void {
  if (document.querySelector('style[data-schematic-css]') === null) {
    const tag = document.createElement('style')
    tag.dataset.schematicCss = ''
    tag.textContent = CSS
    document.head.appendChild(tag)
  }
}

/**
 * Mount the viewer into a container.
 * @param container - element the viewer DOM is built inside; must be empty.
 * @returns dispose() removing listeners and the built DOM.
 */
export function mountSchematic(container: HTMLElement): () => void {
  injectStyles()
  const ac = new AbortController()
  const sig = { signal: ac.signal }
  let disposed = false

  // ------- language state -------
  let lang: Lang = 'en'
  try {
    if (localStorage.getItem('sch.lang') === 'zh') lang = 'zh'
  } catch { /* storage unavailable: English only, toggle still works in-memory */ }
  // ?lang=zh|en deep link overrides the stored choice and persists it
  const qLang = new URLSearchParams(location.search).get('lang')
  if (qLang === 'zh' || qLang === 'en') {
    lang = qLang
    try { localStorage.setItem('sch.lang', lang) } catch { /* storage unavailable: this page only */ }
  }
  const t = (key: string, params?: Record<string, string | number>): string => {
    let s = T[key]?.[lang] ?? key
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
  /** Footer meta line: snapshot stamp (converted to local time only when it carries timezone info) plus the running build's stamp. */
  const setMeta = (): void => {
    const gen = GRAPH?.meta.generated
    const d = gen !== undefined && /[TZ]/.test(gen) ? new Date(gen) : undefined
    const p = (n: number): string => String(n).padStart(2, '0')
    const when = d !== undefined && !Number.isNaN(d.getTime())
      ? `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
      : (gen ?? '')
    const stamp = typeof __SCH_BUILD__ === 'string' ? ` · build ${__SCH_BUILD__}` : ''
    $('.meta').textContent = `${t('metaLine', { t: when })}${stamp}`
  }
  /** en→zh description translations, persisted across visits. */
  const zhMap = new Map<string, string>()
  try {
    const saved = localStorage.getItem('sch.zhmap')
    if (saved) for (const [k, v] of JSON.parse(saved) as [string, string][]) zhMap.set(k, v)
  } catch { /* corrupt or unavailable storage: refetch translations */ }
  const persistZh = (): void => {
    try { localStorage.setItem('sch.zhmap', JSON.stringify([...zhMap])) } catch { /* quota exceeded: skip persisting */ }
  }
  const pendingZh = new Set<string>()
  let zhTexts: string[] = []
  let zhTotal = 0
  /** Language-resolved description: English until the batch lands. */
  const descOf = (x: { desc: string | null }): string | null => {
    if (x.desc === null) return null
    return lang === 'zh' ? (zhMap.get(x.desc) ?? x.desc) : x.desc
  }
  const updateTransLabel = (): void => {
    const el = $('.trans')
    if (lang !== 'zh' || zhTotal === 0) { el.textContent = ''; return }
    const done = zhTexts.filter((s) => zhMap.has(s)).length
    if (done >= zhTotal) { el.textContent = ''; return }
    el.textContent = t('trans', { d: done, n: zhTotal })
  }

  // ------- shell -------
  const html = `
<header>
  <h1>dsh-schematic <span class="subtitle">${t('subtitle')}</span></h1>
  <button class="crumb">${t('overview')}</button>
  <span class="stats">${t('loading')}</span>
  <span class="trans"></span>
  <span class="spacer"></span>
  <input type="search" class="search" placeholder="${t('searchPh')}">
  <button class="viewToggle" aria-pressed="false">${t('table')}</button>
  <button class="langToggle" title="${t('langTitle')}">中</button>
  <button class="themeToggle">◐</button>
</header>
<div class="filters"></div>
<main>
  <div class="stage"><svg class="graph" xmlns="http://www.w3.org/2000/svg"><g class="world"></g></svg></div>
  <div class="tableView"></div>
  <aside class="detail"><p class="empty">${t('emptyDetail')}</p></aside>
</main>
<footer>
  <span class="meta"></span>
  <span class="spacer" style="flex:1"></span>
  <button class="zoomOut">−</button><button class="zoomIn">+</button><button class="zoomFit">${t('fit')}</button>
  <button class="refresh" title="${t('refreshTitle')}">⟳</button>
</footer>
<div class="tooltip"></div>`
  container.classList.add('sch')
  container.innerHTML = html
  const $ = (sel: string): HTMLElement => container.querySelector(sel) as HTMLElement
  const svg = $('svg.graph') as unknown as SVGSVGElement
  const world = $('g.world') as unknown as SVGGElement

  const dispose = (): void => {
    disposed = true
    ac.abort()
    container.innerHTML = ''
    container.classList.remove('sch')
  }

  const catLabel = (id: string): string => {
    const c = CATS.find((x) => x.id === id)
    if (!c) return t('other')
    return lang === 'zh' ? c.zh : c.label
  }
  const catColor = (c: string): string | null => CATS.find((x) => x.id === c)?.css ?? null

  // ------- state -------
  const state = {
    cats: new Set(CATS.map((c) => c.id)),
    other: true, ext: true,
    origins: new Set(['entry', 'runtime']),
    q: '', sel: null as string | null, scope: null as string | null,
  }
  const matchNode = (n: any): boolean => {
    if (!state.q) return true
    const hay = [n.id, n.dir, n.label ?? '', n.module ?? '', n.state ?? '', ...n.provides, ...n.inject].join(' ').toLowerCase()
    return hay.includes(state.q)
  }
  const originOk = (n: any): boolean => state.origins.has(n.origin ?? 'runtime')

  let GRAPH: any = null
  let byId = new Map<string, any>()
  let clusterById = new Map<string, any>()
  let keyOwners = new Map<string, any[]>()
  const nodeLabel = (n: any): string => n.label ?? n.id

  // ------- layout -------
  const H = 30, PITCH = 38, COLGAP = 96
  const pillW = (label: string): number => Math.min(240, label.length * 7.2 + 46)
  const byCatThenLabel = (a: any, b: any): number =>
    (CATS.findIndex((c) => c.id === a.cat) - CATS.findIndex((c) => c.id === b.cat)) || a.label.localeCompare(b.label)

  const visibleNode = (n: any): boolean =>
    (state.cats.has(n.category) || (n.category === 'other' && state.other))
    && originOk(n) && matchNode(n)

  function placeUnits(units: any[], xStart: number) {
    const cols = new Map()
    for (const u of units) {
      if (!cols.has(u.rank)) cols.set(u.rank, [])
      cols.get(u.rank).push(u)
    }
    let x = xStart
    const pos = new Map()
    for (const r of [...cols.keys()].sort((a, b) => a - b)) {
      const list = cols.get(r).sort(byCatThenLabel)
      let w = 0
      for (const u of list) w = Math.max(w, pillW(u.label))
      list.forEach((u: any, i: number) => pos.set(u.id, { x, y: 40 + i * PITCH, w }))
      x += w + COLGAP
    }
    return { pos, width: x - COLGAP + 24 }
  }

  function layoutOverview() {
    const units: any[] = []
    for (const n of GRAPH.nodes) {
      if (!n.cluster && visibleNode(n))
        units.push({ id: n.id, label: nodeLabel(n), cat: n.category, rank: n.rank, kind: 'node', node: n })
    }
    const memberShown = (n: any): boolean => originOk(n) && matchNode(n)
    for (const c of GRAPH.clusters) {
      const catOk = state.cats.has(c.category) || (c.category === 'other' && state.other)
      if (!catOk) continue
      const members = c.members.map((m: string) => byId.get(m))
      const labelHit = state.q && c.label.toLowerCase().includes(state.q)
      if (!(members.some(memberShown) || labelHit)) continue
      const rank = Math.round(members.reduce((s: number, m: any) => s + m.rank, 0) / members.length)
      units.push({ id: c.id, label: `${c.label} · ${c.members.length}`, cat: c.category, rank, kind: 'cluster', cluster: c })
    }
    const shownIds = new Set(units.map((u) => u.id))
    const injectedByShown = new Set(
      GRAPH.nodes.filter((n: any) => shownIds.has(n.cluster ?? n.id)).flatMap((n: any) => n.inject))
    const extList = state.ext ? GRAPH.externalKeys.filter((k: string) => injectedByShown.has(k)) : []
    const extW = extList.length ? Math.max(...extList.map((k: string) => k.length * 6.6 + 38)) : 0
    const { pos, width } = placeUnits(units, 24 + (extList.length ? extW + COLGAP : 0))
    extList.forEach((k: string, i: number) => pos.set('ext:' + k, { x: 24, y: 40 + i * PITCH, w: k.length * 6.6 + 38 }))
    const height = Math.max(80, 40 + Math.max(0, ...[...pos.values()].map((p: any) => p.y + H)))
    return { units, extList, pos, height, width: Math.max(width, 24 + extW) }
  }

  function layoutScope() {
    const c = clusterById.get(state.scope)
    const members = c.members.map((m: string) => byId.get(m)).filter((n: any) => originOk(n) && matchNode(n))
    const memberIds = new Set(members.map((n: any) => n.id))
    const memberUnits = members.map((n: any) => ({ id: n.id, label: nodeLabel(n), cat: n.category, rank: n.rank, kind: 'node', node: n }))

    const ghosts = new Map()
    const addGhost = (node: any, side: string, keys: string[]) => {
      const cl = node.cluster ? clusterById.get(node.cluster) : null
      const gid = node.cluster ?? node.id
      const gk = side + ':' + gid
      if (!ghosts.has(gk)) ghosts.set(gk, {
        id: gid, label: cl ? cl.label : nodeLabel(node),
        cat: cl ? cl.category : node.category,
        kind: cl ? 'cluster' : 'node', cluster: cl, side, keys: new Set(),
      })
      keys.forEach((k) => ghosts.get(gk).keys.add(k))
    }
    const edges: any[] = []
    for (const e of GRAPH.edges) {
      const a = byId.get(e.from), b = byId.get(e.to)
      const aIn = memberIds.has(a.id), bIn = memberIds.has(b.id)
      if (aIn && bIn) edges.push(e)
      else if (aIn) addGhost(b, 'out', e.keys)
      else if (bIn) addGhost(a, 'in', e.keys)
    }
    const extList = state.ext
      ? [...new Set(members.flatMap((n: any) => n.inject.filter((k: string) => !keyOwners.has(k))))].sort()
      : []

    const inList = [...ghosts.values()].filter((g: any) => g.side === 'in').sort(byCatThenLabel)
    const outList = [...ghosts.values()].filter((g: any) => g.side === 'out').sort(byCatThenLabel)
    const extW = extList.length ? Math.max(...extList.map((k: string) => k.length * 6.6 + 38)) : 0
    const inW = inList.length ? Math.max(...inList.map((u: any) => pillW(u.label))) : 0
    const outW = outList.length ? Math.max(...outList.map((u: any) => pillW(u.label))) : 0

    const xBody = 24 + (extList.length ? extW + COLGAP : 0) + (inList.length ? inW + COLGAP : 0)
    const { pos, width } = placeUnits(memberUnits, xBody)
    const xOut = width - 24 + COLGAP
    extList.forEach((k: string, i: number) => pos.set('ext:' + k, { x: 24, y: 40 + i * PITCH, w: k.length * 6.6 + 38 }))
    inList.forEach((u: any, i: number) => pos.set('in:' + u.id, { x: 24 + (extList.length ? extW + COLGAP : 0), y: 40 + i * PITCH, w: pillW(u.label) }))
    outList.forEach((u: any, i: number) => pos.set('out:' + u.id, { x: xOut, y: 40 + i * PITCH, w: pillW(u.label) }))
    const height = Math.max(80, 40 + Math.max(0, ...[...pos.values()].map((p: any) => p.y + H)))
    const totalW = outList.length ? xOut + outW + 24 : width
    return { units: memberUnits, members, cluster: c, inList, outList, extList, edges, pos, height, width: totalW }
  }

  function overviewEdges(L: any) {
    const ids = new Set(L.units.map((u: any) => u.id))
    const unitOf = (n: any): string => n.cluster ?? n.id
    const agg = new Map()
    for (const e of GRAPH.edges) {
      const ua = unitOf(byId.get(e.from)), ub = unitOf(byId.get(e.to))
      if (ua === ub || !ids.has(ua) || !ids.has(ub)) continue
      const key = ua + '→' + ub
      if (!agg.has(key)) agg.set(key, { from: ua, to: ub, keys: new Set() })
      e.keys.forEach((k: string) => agg.get(key).keys.add(k))
    }
    return [...agg.values()].map((e: any) => ({ ...e, keys: [...e.keys].sort() }))
  }

  // ------- render -------
  const NS = 'http://www.w3.org/2000/svg'
  const el = (name: string, attrs: Record<string, string>, parent?: Element): SVGElement => {
    const e = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    if (parent) parent.appendChild(e)
    return e
  }
  let view = { k: 1, tx: 0, ty: 0 }
  const applyView = (): void => {
    world.setAttribute('transform', `translate(${view.tx} ${view.ty}) scale(${view.k})`)
  }
  let lastL: any = null

  const stateVariant = (n: any): string => n.state === 'failed' ? 'node fail'
    : (n.state && n.state !== 'active') ? 'node wait' : 'node'

  function drawPill(gN: Element, id: string, p: any, label: string, cat: string | null, variant: string, hit: any): SVGElement {
    const c = catColor(cat ?? '')
    const g = el('g', { class: 'node ' + variant, style: c ? `--c: var(${c})` : '--c: var(--ink-3)' }, gN)
    el('rect', { x: p.x, y: p.y, width: p.w, height: H, rx: '7' }, g)
    if (variant.includes('cluster')) el('rect', { class: 'bar', x: p.x + 6, y: p.y + 6, width: '4', height: String(H - 12), rx: '2' }, g)
    else el('circle', { class: 'accent', cx: p.x + 14, cy: p.y + H / 2, r: '4.5' }, g)
    const tx = variant.includes('cluster') ? p.x + 18 : p.x + 26
    el('text', { x: tx, y: p.y + H / 2 + 1 }, g).textContent = label
    ;(g as unknown as HTMLElement).dataset.id = id
    if (hit) bindHover(g, hit)
    return g
  }

  function render(refit = false): void {
    if (GRAPH === null) return
    const scoped = !!state.scope
    const L = scoped ? layoutScope() : layoutOverview()
    lastL = L
    svg.setAttribute('viewBox', `0 0 ${svg.clientWidth} ${svg.clientHeight}`)
    world.innerHTML = ''
    const gE = el('g', {}, world)
    const gN = el('g', {}, world)
    const nodeEls = new Map<string, Element>(), edgeEls: any[] = []

    const edgePath = (a: any, b: any): string => {
      const dx = Math.max(30, (b.x - (a.x + a.w)) * 0.45)
      return `M ${a.x + a.w} ${a.y + H / 2} C ${a.x + a.w + dx} ${a.y + H / 2}, ${b.x - dx} ${b.y + H / 2}, ${b.x} ${b.y + H / 2}`
    }
    const catOfUnit = (id: string): string | null => {
      if (id.startsWith('cluster:')) return clusterById.get(id)?.category
      if (id.startsWith('ext:') || id.includes('|')) return null
      return byId.get(id)?.category
    }

    if (scoped) {
      for (const e of L.edges) {
        const a = L.pos.get(e.from), b = L.pos.get(e.to)
        if (!a || !b) continue
        const c = catColor(catOfUnit(e.to) ?? '')
        const p = el('path', { class: 'edge', style: c ? `--c: var(${c})` : '--c: var(--ink-3)', d: edgePath(a, b) }, gE)
        p.dataset.from = e.from; p.dataset.to = e.to; edgeEls.push(p)
      }
      const ghostHit = (g: Element, u: any): void => {
        g.addEventListener('mouseenter', () => {
          tip.innerHTML = `<div class="t">${u.kind === 'cluster' ? u.label + ' ' + t('tipGrouped') : u.label}</div>` +
            `<div class="d">${u.kind === 'cluster' ? t('tipUnits', { n: u.cluster.members.length }) : byId.get(u.id)?.dir ?? ''}</div>` +
            `<div class="k">${[...u.keys].join(', ')}</div>`
          tip.style.display = 'block'
        })
        g.addEventListener('mousemove', moveTip)
        g.addEventListener('mouseleave', hideTip)
        g.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (u.kind === 'cluster') { state.sel = u.cluster.id; renderDetailCluster(u.cluster) }
          else { state.sel = u.id; renderDetail(byId.get(u.id)) }
          render()
        })
        g.addEventListener('dblclick', (ev) => {
          ev.stopPropagation()
          if (u.kind === 'cluster') enterScope(u.cluster.id)
        })
      }
      for (const k of L.extList) {
        const p = L.pos.get('ext:' + k)
        const g = el('g', { class: 'node ext' }, gN)
        el('rect', { x: p.x, y: p.y, width: p.w, height: H, rx: '7' }, g)
        el('text', { x: p.x + 20, y: p.y + H / 2 + 1 }, g).textContent = k
        g.addEventListener('mouseenter', () => {
          showTip(`<div class="t">⌁ ${k}</div><div class="d">${t('tipExt', { n: countInj(k) })}</div>`)
        })
        g.addEventListener('mousemove', moveTip)
        g.addEventListener('mouseleave', hideTip)
      }
      const zoneHead = (txt: string, id: string): void => {
        const p = L.pos.get(id)
        if (p) el('text', { class: 'zone-h', x: p.x, y: '26' }, gN).textContent = txt
      }
      zoneHead(t('zoneExt'), 'ext:' + L.extList[0])
      zoneHead(t('zoneIn'), 'in:' + L.inList[0]?.id)
      zoneHead(t('zoneOut'), 'out:' + L.outList[0]?.id)
      for (const u of [...L.inList, ...L.outList]) {
        const p = L.pos.get(u.side + ':' + u.id)
        const g = drawPill(gN, u.id, p, u.label, u.cat, u.kind === 'cluster' ? 'ghost cluster' : 'ghost', null)
        ghostHit(g, u)
        nodeEls.set(u.side + ':' + u.id, g)
      }
      for (const u of L.units) {
        const g = drawPill(gN, u.id, L.pos.get(u.id), u.label, u.cat, stateVariant(u.node), u.node)
        nodeEls.set(u.id, g)
      }
      $('.stats').textContent =
        t('scopeStats', { l: L.cluster.label, a: L.members.length, b: L.cluster.members.length, n: L.edges.length })
    } else {
      const unitEdges = overviewEdges(L)
      for (const e of unitEdges) {
        const a = L.pos.get(e.from), b = L.pos.get(e.to)
        const c = catColor(catOfUnit(e.to) ?? '')
        const p = el('path', { class: 'edge', style: c ? `--c: var(${c})` : '--c: var(--ink-3)', d: edgePath(a, b) }, gE)
        p.dataset.from = e.from; p.dataset.to = e.to
        p.dataset.keys = e.keys.join(', ')
        edgeEls.push(p)
      }
      for (const u of L.units) {
        const g = drawPill(gN, u.id, L.pos.get(u.id), u.label, u.cat, u.kind === 'cluster' ? 'cluster' : stateVariant(u.node), u.kind === 'node' ? u.node : null)
        if (u.kind === 'cluster') bindClusterHover(g, u.cluster)
        nodeEls.set(u.id, g)
      }
      if (L.extList.length) el('text', { class: 'zone-h', x: '24', y: '26' }, gN).textContent = t('zoneExt')
      for (const k of L.extList) {
        const p = L.pos.get('ext:' + k)
        const g = el('g', { class: 'node ext' }, gN)
        el('rect', { x: p.x, y: p.y, width: p.w, height: H, rx: '7' }, g)
        el('text', { x: p.x + 20, y: p.y + H / 2 + 1 }, g).textContent = k
        g.addEventListener('mouseenter', () => showTip(`<div class="t">⌁ ${k}</div><div class="d">${t('tipExt', { n: countInj(k) })}</div>`))
        g.addEventListener('mousemove', moveTip)
        g.addEventListener('mouseleave', hideTip)
      }
      const failed = GRAPH.nodes.filter((n: any) => n.state === 'failed').length
      $('.stats').textContent =
        t('stats', { m: GRAPH.nodes.length, s: L.units.length, e: unitEdges.length })
        + (failed ? t('statsFailed', { f: failed }) : '')
    }

    svg.setAttribute('height', svg.clientHeight)
    world.dataset.height = L.height
    world.dataset.width = L.width
    renderTable(L)
    if (state.sel && nodeEls.has(state.sel)) focusNode(state.sel, nodeEls, edgeEls)
    else resetFocus(nodeEls, edgeEls)
    const crumb = $('.crumb')
    crumb.classList.toggle('on', scoped)
    crumb.textContent = t('overview')
    $('.subtitle').textContent = scoped ? '/ ' + L.cluster.label : t('subtitle')
    if (refit) fit(L)
  }

  const countInj = (k: string): number => GRAPH.nodes.filter((n: any) => n.inject.includes(k)).length
  const tip = $('.tooltip')
  const showTip = (html: string): void => { tip.innerHTML = html; tip.style.display = 'block' }
  const hideTip = (): void => { tip.style.display = 'none' }
  const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
  const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const moveTip = (ev: MouseEvent): void => {
    tip.style.left = Math.min(window.innerWidth - 360, ev.clientX + 14) + 'px'
    tip.style.top = (ev.clientY + 14) + 'px'
  }

  function enterScope(id: string): void {
    state.scope = id; state.sel = null
    renderDetailCluster(clusterById.get(id))
    render(true)
  }
  function exitScope(): void {
    state.scope = null; state.sel = null
    $('.detail').innerHTML = `<p class="empty">${t('emptyDetail')}</p>`
    render(true)
  }

  function bindHover(g: Element, n: any): void {
    g.addEventListener('mouseenter', () => {
      const rows: string[] = []
      const d = descOf(n)
      if (d) rows.push(`<div class="d">${esc(trunc(d, 110))}</div>`)
      rows.push(`<div class="d">${n.dir} · ${n.form}${n.pluginName ? ' · ' + n.pluginName : ''}${n.origin === 'runtime' ? ' · ' + t('originRuntimeTip') : ''}${n.state && n.state !== 'active' ? ' · ' + n.state : ''}</div>`)
      if (n.cluster) rows.push(`<div class="d">${t('tipInGroup', { l: clusterById.get(n.cluster).label })}</div>`)
      if (n.provides.length) rows.push(`<div class="k">${t('tipProvides', { k: n.provides.join(', ') })}</div>`)
      if (n.inject.length) rows.push(`<div class="k">${t('tipInject', { k: n.inject.join(', ') })}</div>`)
      showTip(`<div class="t">${esc(n.label ?? n.id)}</div>` + rows.join(''))
    })
    g.addEventListener('mousemove', moveTip)
    g.addEventListener('mouseleave', hideTip)
    g.addEventListener('click', (ev) => {
      ev.stopPropagation()
      state.sel = n.id
      renderDetail(n)
      render()
    })
  }

  function bindClusterHover(g: Element, c: any): void {
    g.addEventListener('mouseenter', () => {
      const states = c.members.map((m: string) => byId.get(m).state ?? '—')
      const dist = (arr: string[]): string => [...arr.reduce((m: any, v: string) => m.set(v, (m.get(v) ?? 0) + 1), new Map())]
        .map(([v, i]: any) => `${v}×${i}`).join(' ')
      const d = descOf(c)
      showTip(`<div class="t">${esc(c.label)}</div>` +
        (d ? `<div class="d">${esc(trunc(d, 130))}</div>` : '') +
        `<div class="d">${t('tipUnits', { n: c.members.length })} — ${t('tipClusterHint')}</div>` +
        `<div class="k">${c.members.slice(0, 8).map((m: string) => nodeLabel(byId.get(m))).join(', ')}${c.members.length > 8 ? ' …' : ''}</div>` +
        `<div class="k">${t('tipStates', { k: dist(states) })}</div>`)
    })
    g.addEventListener('mousemove', moveTip)
    g.addEventListener('mouseleave', hideTip)
    g.addEventListener('click', (ev) => {
      ev.stopPropagation()
      state.sel = c.id
      renderDetailCluster(c)
      render()
    })
    g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); enterScope(c.id) })
  }

  function focusNode(id: string, nodeEls: Map<string, Element>, edgeEls: any[]): void {
    const keep = new Set([id])
    for (const e of edgeEls) {
      if (e.dataset.from === id || e.dataset.to === id) {
        keep.add(e.dataset.from); keep.add(e.dataset.to)
      }
    }
    for (const e of edgeEls) e.classList.toggle('on', e.dataset.from === id || e.dataset.to === id)
    for (const [nid, g] of nodeEls) g.classList.toggle('dim', !keep.has(nid))
    for (const e of edgeEls) if (!e.classList.contains('on')) e.classList.add('dim')
  }
  function resetFocus(nodeEls: Map<string, Element>, edgeEls: any[]): void {
    for (const [, g] of nodeEls) g.classList.remove('dim')
    for (const e of edgeEls) { e.classList.remove('dim'); e.classList.remove('on') }
  }

  function renderDetail(n: any): void {
    const owners = (k: string): string => (keyOwners.get(k) ?? []).map((o) => nodeLabel(o)).join(', ')
    const keyChips = (list: string[]): string => list.map((k) => {
      const o = owners(k)
      return o ? `<code>${k} → ${o}</code>` : `<span class="ext" title="provided outside this process">${k}</span>`
    }).join(' ') || '<span class="empty">—</span>'
    const d = descOf(n)
    $('.detail').innerHTML = `
    <h2>${esc(n.label ?? n.id)}</h2>
    <div class="dir">${n.dir}${n.module ? ' · ' + esc(n.module) : ''}${n.pluginName ? ' · name: ' + esc(n.pluginName) : ''}</div>
    ${d ? `<p class="desc">${esc(d)}</p>` : ''}
    <dl>
      <dt>${t('dtState')}</dt><dd>${n.state ?? '—'}</dd>
      <dt>${t('dtOrigin')}</dt><dd>${n.origin === 'runtime' ? t('originRuntime') : t('originEntry')}</dd>
      <dt>${t('dtForm')}</dt><dd>${n.form}</dd>
      <dt>${t('dtCategory')}</dt><dd>${catLabel(n.category)}</dd>
      <dt>${t('dtGroup')}</dt><dd>${n.cluster ? clusterById.get(n.cluster).label : '—'}</dd>
      <dt>${t('dtRank')}</dt><dd>${n.rank}</dd>
      <dt>${t('dtProvides')}</dt><dd class="keys">${n.provides.length ? n.provides.map((k: string) => `<code>${k}</code>`).join(' ') : '<span class="empty">—</span>'}</dd>
      <dt>${t('dtInject')}</dt><dd class="keys">${keyChips(n.inject)}</dd>
    </dl>
    <button class="ask-btn" title="${t('askTitle')}">${t('ask')}</button>`
    ;(container.querySelector('.detail .ask-btn') as HTMLElement).onclick = () => {
      // Hand-off to the SPA: its schematic client half turns the params into a
      // fresh ungrouped session with the question prefilled (see src/client/index.ts).
      const name = n.pluginName ?? n.label ?? n.id
      const params = new URLSearchParams({ 'sch-ask': n.id })
      if (name !== n.id) params.set('sch-name', name)
      window.open(`/?${params.toString()}`, '_blank', 'noopener')
    }
  }

  function renderDetailCluster(c: any): void {
    const members = c.members.map((m: string) => byId.get(m))
    const d = descOf(c)
    $('.detail').innerHTML = `
    <h2>${esc(c.label)}</h2>
    <div class="dir">${t('capabilityGroup', { n: c.members.length })}</div>
    ${d ? `<p class="desc">${esc(d)}</p>` : ''}
    <dl>
      <dt>${t('dtCategory')}</dt><dd>${catLabel(c.category)}</dd>
      <dt>${t('seamKeys')}</dt><dd class="keys">${c.seamKeys?.length ? c.seamKeys.map((k: string) => `<code>${k}</code>`).join(' ') : '<span class="empty">—</span>'}</dd>
    </dl>
    <div class="members">${members.map((m: any) =>
      `<div class="m"><b>${esc(nodeLabel(m))}${m.state === 'failed' ? ' ✕' : m.state !== 'active' && m.state ? ' ⏳' : ''}</b>${descOf(m) ? `<span>${esc(descOf(m) as string)}</span>` : ''}</div>`).join('')}
    </div>
    <button class="open-btn">${t('openGroup')}</button>`
    ;(container.querySelector('.detail .open-btn') as HTMLElement).onclick = () => enterScope(c.id)
  }

  /** Re-localize whichever detail panel is showing (language flip). */
  function refreshDetail(): void {
    if (state.sel) {
      if (byId.has(state.sel)) return renderDetail(byId.get(state.sel))
      if (clusterById.has(state.sel)) return renderDetailCluster(clusterById.get(state.sel))
    }
    if (state.scope) return renderDetailCluster(clusterById.get(state.scope))
    $('.detail').innerHTML = `<p class="empty">${t('emptyDetail')}</p>`
  }

  function renderTable(L: any): void {
    const rows = (state.scope ? L.members : GRAPH.nodes.filter(visibleNode))
      .sort((a: any, b: any) => (a.label ?? a.id).localeCompare(b.label ?? b.id))
      .map((n: any) => {
        const d = descOf(n)
        return `<tr><td>${esc(n.label ?? n.id)}</td><td>${n.dir}</td><td>${n.state ?? '—'}</td><td>${n.form}</td>
        <td>${n.cluster ? clusterById.get(n.cluster).label : '—'}</td>
        <td>${d ? esc(d) : '—'}</td>
        <td>${n.provides.join(', ')}</td><td>${n.inject.join(', ')}</td></tr>`
      }).join('')
    $('.tableView').innerHTML =
      `<table><thead><tr><th>${t('thUnit')}</th><th>${t('thEntry')}</th><th>${t('thState')}</th><th>${t('thForm')}</th><th>${t('thGroup')}</th><th>${t('thDesc')}</th><th>${t('thProvides')}</th><th>${t('thInject')}</th></tr></thead><tbody>${rows}</tbody></table>`
  }

  // ------- batch translation -------
  /** Kick off translation of every untranslated description (zh mode only). */
  function ensureZh(): void {
    if (lang !== 'zh' || GRAPH === null) { updateTransLabel(); return }
    const texts = [...new Set(
      [...GRAPH.nodes, ...GRAPH.clusters]
        .map((x: any) => x.desc)
        .filter((d: unknown): d is string => typeof d === 'string'),
    )]
    zhTotal = texts.length
    zhTexts = texts
    const missing = texts.filter((s) => !zhMap.has(s) && !pendingZh.has(s))
    updateTransLabel()
    if (missing.length === 0) return
    missing.forEach((s) => pendingZh.add(s))
    for (let i = 0; i < missing.length; i += 20) {
      const chunk = missing.slice(i, i + 20)
      void (async () => {
        try {
          const res = await fetch('/schematic/api/translate-batch', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts: chunk }),
          })
          const data = await res.json().catch(() => ({ error: '响应解析失败' }))
          if (!res.ok || !Array.isArray((data as any).zh) || (data as any).zh.length !== chunk.length) {
            throw new Error((data as any).error || ('HTTP ' + res.status))
          }
          chunk.forEach((s, j) => { if (typeof (data as any).zh[j] === 'string') zhMap.set(s, (data as any).zh[j]) })
        } catch { /* keep English for this chunk; retry on next toggle/reload */ }
        finally {
          chunk.forEach((s) => pendingZh.delete(s))
          persistZh()
          updateTransLabel()
          render()
          refreshDetail()
        }
      })()
    }
  }

  // ------- controls -------
  function renderChips(): void {
    const f = $('.filters')
    const count = (id: string): number => GRAPH.nodes.filter((n: any) => n.category === id).length
    f.innerHTML = ''
    for (const c of CATS) {
      const chip = document.createElement('span')
      chip.className = 'chip' + (state.cats.has(c.id) ? '' : ' off')
      chip.style.setProperty('--c', `var(${c.css})`)
      chip.innerHTML = `<span class="dot"></span>${catLabel(c.id)} <b>${count(c.id)}</b>`
      chip.onclick = () => { state.cats.has(c.id) ? state.cats.delete(c.id) : state.cats.add(c.id); renderChips(); render() }
      f.appendChild(chip)
    }
    const other = document.createElement('span')
    other.className = 'chip' + (state.other ? '' : ' off')
    other.style.setProperty('--c', 'var(--ink-3)')
    other.innerHTML = `<span class="dot"></span>${t('other')} <b>${GRAPH.nodes.filter((n: any) => n.category === 'other').length}</b>`
    other.onclick = () => { state.other = !state.other; renderChips(); render() }
    f.appendChild(other)

    const sep = document.createElement('span')
    sep.className = 'sep'
    f.appendChild(sep)
    const lbl = document.createElement('span')
    lbl.className = 'lbl'
    lbl.textContent = t('originLbl')
    f.appendChild(lbl)
    for (const [id, label] of [['entry', 'originEntry'], ['runtime', 'originRuntimeTip']] as const) {
      const n = GRAPH.nodes.filter((x: any) => (x.origin ?? 'runtime') === id).length
      const chip = document.createElement('span')
      chip.className = 'chip' + (state.origins.has(id) ? '' : ' off')
      chip.innerHTML = `<span class="dot plain"></span>${t(label)} <b>${n}</b>`
      chip.onclick = () => { state.origins.has(id) ? state.origins.delete(id) : state.origins.add(id); renderChips(); render() }
      f.appendChild(chip)
    }

    const sep2 = document.createElement('span')
    sep2.className = 'sep'
    f.appendChild(sep2)
    const ext = document.createElement('span')
    ext.className = 'chip' + (state.ext ? '' : 'off')
    ext.innerHTML = `<span class="dot ext"></span>${t('extKeys')} <b>${GRAPH.externalKeys.length}</b>`
    ext.onclick = () => { state.ext = !state.ext; renderChips(); render() }
    f.appendChild(ext)
  }

  function fit(L: any): void {
    const w = Number(world.dataset.width || L.width || 1200)
    const h = Number(world.dataset.height || L.height || 800)
    const k = Math.min(1, svg.clientWidth / (w + 48), svg.clientHeight / (h + 24))
    view = { k, tx: Math.max(8, (svg.clientWidth - w * k) / 2), ty: Math.max(8, (svg.clientHeight - h * k) / 2) }
    applyView()
  }

  /** (Re)fetch the live snapshot and reset derived state around it. */
  const load = async (): Promise<void> => {
    try {
      GRAPH = await (await fetch('/schematic/graph.json', { cache: 'no-store' })).json()
    } catch {
      $('.stats').textContent = t('loadFail')
      return
    }
    if (disposed) return
    byId = new Map(GRAPH.nodes.map((n: any) => [n.id, n]))
    clusterById = new Map(GRAPH.clusters.map((c: any) => [c.id, c]))
    keyOwners = new Map()
    for (const n of GRAPH.nodes) for (const k of n.provides) {
      if (!keyOwners.has(k)) keyOwners.set(k, [])
      keyOwners.get(k)!.push(n)
    }
    state.scope = null; state.sel = null
    setMeta()
    renderChips()
    render(true)
    ensureZh()
    // deep link: open a cluster directly via #cluster:<label> (URL-encoded)
    const m = decodeURIComponent(location.hash).match(/^#cluster:(.+)$/)
    const target = m && GRAPH.clusters.find((c: any) => c.label === m[1])
    if (target) enterScope(target.id)
  }

  // ------- events -------
  $('.search').addEventListener('input', (e) => { state.q = (e.target as HTMLInputElement).value.trim().toLowerCase(); render() })
  $('.crumb').addEventListener('click', exitScope)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { state.scope ? exitScope() : (state.sel = null, render()) }
  }, sig)
  const viewToggle = $('.viewToggle')
  viewToggle.addEventListener('click', () => {
    const table = viewToggle.getAttribute('aria-pressed') !== 'true'
    viewToggle.setAttribute('aria-pressed', String(table))
    $('.stage').style.display = table ? 'none' : ''
    $('.tableView').style.display = table ? 'block' : 'none'
  })
  $('.themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme ??
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark'
  })
  const langToggle = $('.langToggle')
  const updateLangButton = (): void => {
    langToggle.textContent = lang === 'zh' ? 'EN' : '中'
    langToggle.setAttribute('aria-pressed', String(lang === 'zh'))
    langToggle.title = t('langTitle')
  }
  langToggle.addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh'
    try { localStorage.setItem('sch.lang', lang) } catch { /* storage unavailable: choice lasts for this page only */ }
    updateLangButton()
    setMeta()
    renderChips()
    render()
    refreshDetail()
    ensureZh()
  })
  updateLangButton()
  $('.refresh').addEventListener('click', () => { void load() })
  $('.zoomIn').addEventListener('click', () => { view.k = Math.min(2.5, view.k * 1.25); applyView() })
  $('.zoomOut').addEventListener('click', () => { view.k = Math.max(0.25, view.k / 1.25); applyView() })
  $('.zoomFit').addEventListener('click', () => lastL && fit(lastL))
  svg.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    view.k = Math.min(2.5, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.12 : 0.89)))
    applyView()
  }, { passive: false })
  let pan: { x: number; y: number; tx: number; ty: number } | null = null
  svg.addEventListener('pointerdown', (e) => { pan = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; svg.classList.add('panning') })
  window.addEventListener('pointermove', (e) => { if (pan) { view.tx = pan.tx + e.clientX - pan.x; view.ty = pan.ty + e.clientY - pan.y; applyView() } }, sig)
  window.addEventListener('pointerup', () => { pan = null; svg.classList.remove('panning') }, sig)
  svg.addEventListener('click', () => { state.sel = null; render() })
  window.addEventListener('resize', () => render(), sig)

  void load()
  return dispose
}
