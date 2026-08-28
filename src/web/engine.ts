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
  tabJourney:      { en: 'journey', zh: '旅程' },
  tabDomains:      { en: 'domains', zh: '分域' },
  tabTable:        { en: 'table', zh: '表格' },
  journeyHint:     { en: 'One message, left to right: UI → connection → session & loop → context → model → tools. Persistence and support ride on the parallel row beneath — each card footnotes the ctx keys it really exchanges with the flow.', zh: '一条消息从左到右走主流程:界面 → 连接 → 会话与循环 → 上下文 → 模型 → 工具;记录与支撑在下方旁路并行,卡片脚注列出它们与主流程实际交换的服务键。' },
  sideTag:         { en: 'alongside', zh: '旁路' },
  statsJourney:    { en: '{m} mounted · arranged as one message\'s journey', zh: '已挂载 {m} · 按一条消息的旅程排列' },
  stgUi:           { en: 'Browser UI', zh: '网页界面' },
  stgUiD:          { en: 'Conversations, sidebar, settings — turns clicks into RPCs.', zh: '对话、侧栏、设置——把点击变成 RPC 请求。' },
  stgGw:           { en: 'Connection & gateway', zh: '连接与网关' },
  stgGwD:          { en: 'The wire between browser and process: fetch/RPC gateway.', zh: '浏览器与 dsh 进程之间的通道:fetch/RPC 网关。' },
  stgSess:         { en: 'Sessions & agent loop', zh: '会话与代理循环' },
  stgSessD:        { en: 'Session service, agents, the loop itself, approvals, presets.', zh: '会话服务、代理、主循环本体、审批与预设。' },
  stgCtx:          { en: 'Context assembly', zh: '上下文组装' },
  stgCtxD:         { en: 'System prompt, skills catalog, compaction, request context.', zh: '系统提示、技能目录、压缩、请求上下文。' },
  stgModel:        { en: 'Model call', zh: '模型调用' },
  stgModelD:       { en: 'LLM service definition and the DeepSeek providers.', zh: 'LLM 服务定义与 DeepSeek 提供者。' },
  stgTools:        { en: 'Tool execution', zh: '工具执行' },
  stgToolsD:       { en: 'Tool registry plus the executors: shell, fs, web, …', zh: '工具注册表与各执行器:shell、fs、web……' },
  stgPersist:      { en: 'Logging & telemetry', zh: '记录与遥测' },
  stgPersistD:     { en: 'Session log, projections, titles, telemetry.', zh: '会话日志、投影、标题、遥测。' },
  stgSupport:      { en: 'Supporting services', zh: '支撑服务' },
  stgSupportD:     { en: 'Settings, locale, identity, credentials, boot glue.', zh: '设置、语言、身份、凭据、启动粘合。' },
  edgeUse:         { en: '{a} uses services provided by {b}', zh: '{a} 使用 {b} 提供的服务' },
  edgeDir:         { en: 'arrow = consumer → provider; keys are ctx service names', zh: '箭头 = 使用者 → 提供者;键为 ctx 服务名' },
  legendEdge:      { en: 'A → B: A injects ctx services B provides', zh: 'A → B:A 注入 B 提供的 ctx 服务' },
  familyTip:       { en: 'same package family — no capability seam between them', zh: '同包前缀家族——彼此未构成能力接缝' },
  familyMembers:   { en: 'family members', zh: '家族成员' },
  changedToast:    { en: 'topology changed: +{a} · −{r}', zh: '拓扑变化:+{a} · −{r}' },
  autoTitle:       { en: 'toggle auto-refresh (every 5s)', zh: '切换自动刷新(每 5 秒)' },
  sessFollow:      { en: '↪ follow chat', zh: '↪ 跟随聊天' },
  actSub:          { en: 'subagents', zh: '含子代理' },
  actSubTitle:     { en: 'also show subagent sessions running in this process', zh: '同时显示本进程里运行的子代理会话' },
  actEmpty:        { en: 'no activity yet — send a message in the followed session', zh: '暂无活动——在跟随的会话里发条消息试试' },
  actRunning:      { en: 'running', zh: '运行中' },
  actIdle:         { en: 'idle', zh: '空闲' },
  actLiveHint:     { en: 'glow = active now', zh: '发光 = 正在活动' },
  actReconnected:  { en: 'activity stream reconnected', zh: '活动流已重连' },
  akUser:          { en: 'user message', zh: '用户消息' },
  akLlm:           { en: 'model reply', zh: '模型回复' },
  akTool:          { en: 'tool call', zh: '工具调用' },
  akToolEnd:       { en: 'tool done', zh: '工具完成' },
  akTurn:          { en: 'turn', zh: '回合' },
  akApproval:      { en: 'approval', zh: '审批' },
  akTodo:          { en: 'todo write', zh: '待办写入' },
  akCompaction:    { en: 'compaction', zh: '压缩' },
  akRetry:         { en: 'LLM retry', zh: '模型重试' },
  akSubagent:      { en: 'subagent', zh: '子代理' },
  akTitle:         { en: 'title', zh: '标题' },
  akAction:        { en: 'action', zh: '操作' },
  akSvc:           { en: 'service read', zh: '服务读取' },
  actSvc:          { en: 'svc', zh: '服务读' },
  actSvcTitle:     { en: 'show service-read rows: which package actually read which ctx service key (the provide/inject wiring in use)', zh: '显示服务读取行:哪个包真的读了哪个 ctx 服务键(实际发生作用的提供/注入接线)' },
  recvLine:        { en: 'session/event broadcast → {n} in-listeners', zh: 'session/event 广播 → {n} 个插件在听' },
  recvNames:       { en: 'listeners of the session-event broadcast (from the live event bus)', zh: '会话事件广播的接收插件(来自运行中的事件总线)' },
  dtListens:       { en: 'listens to', zh: '监听事件' },
  dtListensTip:    { en: 'broadcast events this package listens to; packages that only provide/inject services register none', zh: '该包监听的广播事件;纯服务接线(只提供/注入服务)的包不注册任何监听' },
  dtReads:         { en: 'runtime reads', zh: '运行时读取' },
  dtReadsTip:      { en: 'ctx service keys this package actually read since process start, with counts — the wiring that did work, not just the wiring that exists', zh: '进程启动以来该包真实读取过的 ctx 服务键及次数——是实际发生作用的接线,不只是存在的接线' },
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

/**
 * The message journey: stages a chat message actually travels, in order.
 * Membership is derived from the live graph (capability keys first, package
 * family as fallback); the first matching stage claims a node, so the order
 * of this list is the assignment priority. `css` colors the stage card.
 */
const STAGES: {
  id: string
  title: string
  desc: string
  css: string
  match: (n: any, has: (k: string) => boolean) => boolean
}[] = [
  {
    id: 'ui', title: 'stgUi', desc: 'stgUiD', css: '--s8',
    match: (n) => n.category === 'web-client',
  },
  {
    id: 'gw', title: 'stgGw', desc: 'stgGwD', css: '--s1',
    match: (n, has) => has('connection') || has('remote') || has('apiProxy')
      || ['apiProxy', 'remote', 'connection', 'webRuntime', 'webServer'].some((k) => n.provides.includes(k))
      || ['sdk', 'acp', 'api'].includes(n.group),
  },
  {
    id: 'persist', title: 'stgPersist', desc: 'stgPersistD', css: '--s5',
    match: (n) => n.group === 'session' || n.provides.includes('sessionProjections'),
  },
  {
    id: 'model', title: 'stgModel', desc: 'stgModelD', css: '--s2',
    match: (n) => n.provides.includes('llm') || n.group === 'llm',
  },
  {
    id: 'tools', title: 'stgTools', desc: 'stgToolsD', css: '--s3',
    match: (n) => n.provides.includes('tools')
      || /^tool-|:tool-/.test(n.id)
      || ['tools', 'shell', 'subprocess', 'terminal', 'fs', 'lsp', 'e2b', 'sandbox', 'web',
        'workflow', 'todo', 'plan', 'self-modification', 'hooks'].includes(n.group),
  },
  {
    id: 'sess', title: 'stgSess', desc: 'stgSessD', css: '--s7',
    match: (n, has) => !['compaction', 'skill', 'context', 'system', 'spill'].includes(n.group)
      && (['sessions', 'agents', 'subagents', 'agentLoop', 'approval', 'permissionPresets'].some((k) => n.provides.includes(k) || has(k))
        || ['agent', 'core', 'preset', 'subagent', 'guard', 'interaction'].includes(n.group)),
  },
  {
    id: 'ctx', title: 'stgCtx', desc: 'stgCtxD', css: '--s4',
    match: (n, has) => has('systemPrompt') || n.provides.includes('systemPrompt')
      || ['system', 'skill', 'compaction', 'context', 'spill'].includes(n.group),
  },
  {
    id: 'support', title: 'stgSupport', desc: 'stgSupportD', css: '--s6',
    match: () => true,
  },
]

/** Assign every node to its journey stage (first match wins). */
function stageOf(n: any): string {
  const has = (k: string): boolean => n.inject.includes(k)
  for (const s of STAGES) if (s.match(n, has)) return s.id
  return 'support'
}

/** Left-to-right display order of the stage cards. */
/** Main-flow stages, in message order. */
const FLOW = ['ui', 'gw', 'sess', 'ctx', 'model', 'tools']
/** Sidecar stages: they serve the flow from alongside, not in message order. */
const SIDE = ['persist', 'support']

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
.sch .edge { fill: none; stroke: var(--c); stroke-opacity: 0.34; stroke-width: 1.5; marker-end: url(#sch-arrow); }
.sch .edgeHit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; cursor: pointer; }
.sch .dim { opacity: 0.16; }
.sch .edge.on { stroke-opacity: 0.95; stroke-width: 2.2; }
.sch .tabs { display: flex; gap: 4px; }
.sch .tabs button { padding: 3px 10px; }
.sch[data-tab="journey"] .filters { display: none; }
.sch[data-tab="journey"] .crumb { display: none !important; }
.sch[data-tab="journey"] .stage, .sch[data-tab="table"] .stage { display: none; }
.sch[data-tab="table"] svg.graph { display: none; }
.sch[data-tab="table"] .tableView { display: block; }
.sch[data-tab="journey"] .journey { display: flex; }
.sch .journey { display: none; flex: 1; min-width: 0; flex-direction: column; padding: 12px 16px 6px; cursor: grab; }
.sch .journey.dragging { cursor: grabbing; }
.sch .journey.dragging * { user-select: none; }
.sch .journey .stg .pill { font-size: 10.5px; padding: 1px 7px; max-width: 100%; }
.sch .journey .stg .pill .lb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sch .journey .hint { margin: 0 0 8px; color: var(--ink-3); font-size: 12px; }
.sch .jr { flex: 1; min-height: 0; overflow: auto; }
.sch .jrFit { transform-origin: 0 0; }
.sch .jrRow { display: flex; align-items: stretch; width: 100%; }
.sch .jrRow.side { margin-top: 10px; padding-top: 12px; border-top: 1px dashed var(--border); align-items: flex-start; gap: 12px; }
.sch .sideTag { flex: 0 0 auto; align-self: center; color: var(--ink-3); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.sch .stg .xkeys { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); font: 10.5px/1.5 ui-monospace, Menlo, monospace; color: var(--ink-3); overflow-wrap: anywhere; }
.sch .stg .xkeys b { font-weight: 500; }
.sch .stg {
  flex: 1 1 0; min-width: 96px; max-width: none;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-1); padding: 8px 10px 10px;
}
.sch .stg header { display: flex; align-items: baseline; gap: 7px; padding: 0 0 0 9px; border: 0; background: none; position: relative; }
.sch .stg header::before { content: ""; position: absolute; left: 0; top: 3px; bottom: 3px; width: 4px; border-radius: 2px; background: var(--c); }
.sch .stg header .no { color: var(--ink-3); font-size: 11px; font-variant-numeric: tabular-nums; }
.sch .stg header h3 { font-size: 13px; font-weight: 650; margin: 0; flex: 1; }
.sch .stg header b { color: var(--ink-3); font-weight: 500; font-size: 11.5px; }
.sch .stg .d { font-size: 10.5px; line-height: 1.35; color: var(--ink-2); margin: 2px 0 6px; }
.sch .stg .chips { display: flex; flex-wrap: wrap; gap: 4px; align-content: flex-start; }
.sch .stg .pill {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none;
  border: 1px solid var(--border); border-radius: 999px; padding: 1px 9px;
  font-size: 11.5px; color: var(--ink-1); background: var(--page);
}
.sch .stg .pill:hover { border-color: var(--c); }
.sch .stg .pill.sel { border-color: var(--ink-1); font-weight: 600; }
.sch .stg .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pc, var(--ink-3)); flex: 0 0 auto; }
.sch .stg .pill.fail { border-color: var(--s8); }
.sch .flow { flex: 0 0 auto; align-self: center; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 0 2px; min-width: 24px; }
.sch .flow .keys { font: 9px/1.25 ui-monospace, Menlo, monospace; color: var(--ink-2); text-align: center; max-width: 72px; overflow-wrap: anywhere; }
.sch .flow .arr { color: var(--ink-3); font-size: 14px; line-height: 1; }
.sch .toast {
  position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%);
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.16); padding: 7px 14px; font-size: 12.5px;
  display: none; z-index: 20; max-width: 70vw;
}
.sch .toast.on { display: block; }
@keyframes schPulse { 50% { filter: brightness(1.55); } }
.sch .stg .pill.pulse, .sch .node.pulse rect { animation: schPulse 1.1s ease-in-out 6; }
.sch .node.family rect { stroke-dasharray: 5 3; }
.sch .legend { color: var(--ink-3); font-size: 11.5px; padding: 0 2px; }
/* runtime activity: live = recent (breathing, TTL), live-strong = in flight */
@keyframes schLive { 50% { filter: brightness(1.3); } }
.sch .stg .pill.live {
  border-color: var(--pc, var(--ink-2));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pc, var(--ink-3)) 26%, transparent);
  animation: schLive 1.6s ease-in-out infinite;
}
.sch .stg .pill.live-strong {
  border-color: var(--pc, var(--ink-1));
  background: color-mix(in srgb, var(--pc, var(--ink-2)) 16%, var(--page));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--pc, var(--ink-3)) 40%, transparent);
}
.sch .node.live rect {
  stroke-width: 2.5;
  filter: drop-shadow(0 0 3px color-mix(in srgb, var(--c) 65%, transparent));
  animation: schLive 1.6s ease-in-out infinite;
}
.sch .node.live-strong rect {
  stroke-width: 2.5;
  fill: color-mix(in srgb, var(--c) 20%, var(--surface-1));
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--c) 80%, transparent));
}
.sch header .sessSel { max-width: 260px; }
.sch header .subBtn { border-radius: 999px; padding: 3px 10px; color: var(--ink-2); }
.sch .actbar { border-top: 1px solid var(--border); background: var(--surface-1); flex: 0 0 auto; }
.sch .actHead { display: flex; align-items: center; gap: 8px; padding: 5px 16px; font-size: 12px; }
.sch .actHead .actSess { font-weight: 600; max-width: 34vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sch .actHead .actState { color: var(--ink-2); font-size: 11.5px; }
.sch .actHead .recv { color: var(--ink-3); font-size: 11px; max-width: 30vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sch .runDot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); flex: 0 0 auto; }
.sch .runDot.on { background: var(--s3); animation: schPulse 1.1s ease-in-out infinite; }
.sch .actFold { border: 0; background: none; color: var(--ink-3); padding: 0 4px; font-size: 11px; cursor: pointer; }
.sch .actbar .chip[aria-pressed="false"] { opacity: 0.45; }
.sch .actbar.folded .actList { display: none; }
.sch .actbar.folded .actFold { transform: rotate(180deg); }
.sch .actList { max-height: 118px; overflow-y: auto; padding: 0 16px 7px; display: flex; flex-direction: column; gap: 2px; }
.sch .actRow { display: flex; gap: 8px; align-items: baseline; font-size: 11.5px; min-width: 0; }
.sch .actRow time { color: var(--ink-3); font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.sch .actRow .md {
  flex: 0 0 auto; font: 10.5px/1.5 ui-monospace, Menlo, monospace;
  border: 1px solid var(--border); border-radius: 5px; padding: 0 5px;
  color: var(--mc, var(--ink-3));
}
.sch .actRow .tx { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sch .actRow[data-module] { cursor: pointer; }
.sch .actRow[data-module]:hover .tx { color: var(--ink-1); }
.sch .actRow.err .tx { color: var(--s8); }
.sch .actList .emptyRow { color: var(--ink-3); font-size: 11.5px; }
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
  // ?tab=journey|domains|table deep link picks the landing tab
  const qTab = new URLSearchParams(location.search).get('tab')
  const bootTab: 'journey' | 'domains' | 'table' = qTab === 'domains' || qTab === 'table' ? qTab : 'journey'
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
  <span class="tabs">
    <button class="tabBtn" data-tab="journey" aria-pressed="true">${t('tabJourney')}</button>
    <button class="tabBtn" data-tab="domains" aria-pressed="false">${t('tabDomains')}</button>
    <button class="tabBtn" data-tab="table" aria-pressed="false">${t('tabTable')}</button>
  </span>
  <button class="crumb">${t('overview')}</button>
  <span class="stats">${t('loading')}</span>
  <span class="trans"></span>
  <span class="spacer"></span>
  <select class="sessSel" title="${t('actSubTitle')}"></select>
  <button class="chip subBtn" aria-pressed="false" title="${t('actSubTitle')}">${t('actSub')}</button>
  <input type="search" class="search" placeholder="${t('searchPh')}">
  <button class="langToggle" title="${t('langTitle')}">中</button>
  <button class="themeToggle">◐</button>
</header>
<div class="filters"></div>
<main>
  <div class="journey"></div>
  <div class="stage"><svg class="graph" xmlns="http://www.w3.org/2000/svg"><g class="world"></g></svg></div>
  <div class="tableView"></div>
  <aside class="detail"><p class="empty">${t('emptyDetail')}</p></aside>
</main>
<div class="actbar">
  <div class="actHead">
    <span class="runDot"></span><b class="actSess">—</b><span class="actState"></span><span class="recv"></span>
    <span class="spacer" style="flex:1"></span>
    <button class="chip svcBtn" aria-pressed="true" title="${t('actSvcTitle')}">${t('actSvc')}</button>
    <span class="legend">${t('actLiveHint')}</span>
    <button class="actFold" aria-pressed="true">▾</button>
  </div>
  <div class="actList"></div>
</div>
<footer>
  <span class="meta"></span>
  <span class="spacer" style="flex:1"></span>
  <button class="zoomOut">−</button><button class="zoomIn">+</button><button class="zoomFit">${t('fit')}</button>
  <button class="autoBtn" aria-pressed="true" title="${t('autoTitle')}">⏸</button>
  <button class="refresh" title="${t('refreshTitle')}">⟳</button>
</footer>
<div class="toast"></div>
<div class="tooltip"></div>`
  container.classList.add('sch')
  container.innerHTML = html
  container.dataset.tab = bootTab
  const $ = (sel: string): HTMLElement => container.querySelector(sel) as HTMLElement
  const svg = $('svg.graph') as unknown as SVGSVGElement
  const world = $('g.world') as unknown as SVGGElement
  // Arrowheads for DI edges (consumer → provider); fill follows the path stroke.
  {
    const NSX = 'http://www.w3.org/2000/svg'
    const mk = (name: string, attrs: Record<string, string>, parent: Element): Element => {
      const e = document.createElementNS(NSX, name)
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
      parent.appendChild(e)
      return e
    }
    const defs = mk('defs', {}, svg)
    const marker = mk('marker', {
      id: 'sch-arrow', viewBox: '0 0 10 10', refX: '8.5', refY: '5',
      markerWidth: '6.5', markerHeight: '6.5', orient: 'auto-start-reverse',
    }, defs)
    mk('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'context-stroke' }, marker)
  }

  let pollTimer = 0
  let toastTimer = 0
  let disposeExtra: (() => void) | null = null
  const dispose = (): void => {
    disposed = true
    window.clearInterval(pollTimer)
    window.clearTimeout(toastTimer)
    disposeExtra?.()
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
    tab: bootTab,
  }
  container.querySelectorAll('.tabBtn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === state.tab)))
  /** Node ids that appeared in the latest auto-refresh; they pulse once. */
  const freshIds = new Set<string>()
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
  /** module specifier → node ids (activity frames attribute by module). */
  let moduleIds = new Map<string, string[]>()
  /** event name → owning units listening to it (the broadcast-bus wiring). */
  let evRecv = new Map<string, { id: string; module: string | null; count: number }[]>()
  /** module specifier → event names it listens to (detail panel). */
  let modSubs = new Map<string, string[]>()
  /** module → the ctx keys it actually read at runtime, with counts (graph.json). */
  let modReads = new Map<string, { key: string; count: number }[]>()
  const nodeLabel = (n: any): string => n.label ?? n.id

  /**
   * The scope target for a cluster id or a family card id (fam:<group>):
   * a family synthesizes the cluster shape from its unclustered members, so
   * family cards open into the same scope view clusters use.
   */
  const scopeTarget = (id: string): any | undefined => {
    if (clusterById.has(id)) return clusterById.get(id)
    if (!id.startsWith('fam:') || GRAPH === null) return undefined
    const members = GRAPH.nodes.filter((n: any) => !n.cluster && n.group === id.slice(4))
    if (members.length === 0) return undefined
    const catCount = new Map<string, number>()
    for (const n of members) catCount.set(n.category, (catCount.get(n.category) ?? 0) + 1)
    const cat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return { id, label: id.slice(4), category: cat, members: members.map((n: any) => n.id), seamKeys: [] }
  }

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
    // Unclustered nodes: ≥2 sharing a package family collapse into one family
    // card (llm ×4, ui ×9 …); true singles stay pills.
    const byFam = new Map<string, any[]>()
    for (const n of GRAPH.nodes) {
      if (!n.cluster) {
        if (!byFam.has(n.group)) byFam.set(n.group, [])
        byFam.get(n.group)!.push(n)
      }
    }
    for (const [fam, list] of byFam) {
      if (list.length < 2) {
        for (const n of list) if (visibleNode(n))
          units.push({ id: n.id, label: nodeLabel(n), cat: n.category, rank: n.rank, kind: 'node', node: n })
        continue
      }
      const shown = list.filter((n: any) => originOk(n) && matchNode(n))
      if (shown.length === 0) continue
      const catCount = new Map<string, number>()
      for (const n of list) catCount.set(n.category, (catCount.get(n.category) ?? 0) + 1)
      const cat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
      units.push({
        id: 'fam:' + fam, label: `${fam} · ${list.length}`, cat, rank: Math.min(...list.map((n: any) => n.rank)),
        kind: 'family', family: { id: fam, members: list },
      })
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
    const famOf = new Map<string, string>()
    for (const u of units) if (u.kind === 'family') for (const m of u.family.members) famOf.set(m.id, u.id)
    const injectedByShown = new Set(
      GRAPH.nodes.filter((n: any) => shownIds.has(n.cluster ?? famOf.get(n.id) ?? n.id)).flatMap((n: any) => n.inject))
    const extList = state.ext ? GRAPH.externalKeys.filter((k: string) => injectedByShown.has(k)) : []
    const extW = extList.length ? Math.max(...extList.map((k: string) => k.length * 6.6 + 38)) : 0
    const { pos, width } = placeUnits(units, 24 + (extList.length ? extW + COLGAP : 0))
    extList.forEach((k: string, i: number) => pos.set('ext:' + k, { x: 24, y: 40 + i * PITCH, w: k.length * 6.6 + 38 }))
    const height = Math.max(80, 40 + Math.max(0, ...[...pos.values()].map((p: any) => p.y + H)))
    return { units, extList, pos, height, width: Math.max(width, 24 + extW), famOf }
  }

  function layoutScope() {
    const c = scopeTarget(state.scope ?? '')
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
    const unitOf = (n: any): string => n.cluster ?? L.famOf?.get(n.id) ?? n.id
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

  // ------- journey view -------

  /** Render the message-journey tab: the main flow as one row of stage cards,
   *  sidecar stages on a parallel row beneath, keyed by what they exchange. */
  function renderJourney(): void {
    if (GRAPH === null) return
    const stageById = new Map<string, string>(GRAPH.nodes.map((n: any) => [n.id, stageOf(n)]))
    const membersOf = (sid: string): any[] => GRAPH.nodes
      .filter((n: any) => stageById.get(n.id) === sid)
      .sort((a: any, b: any) => (a.rank - b.rank) || nodeLabel(a).localeCompare(nodeLabel(b)))
    const crossKeys = (from: string, to: string): string[] => {
      const keys = new Set<string>()
      for (const e of GRAPH.edges) {
        if (stageById.get(e.from) === from && stageById.get(e.to) === to) {
          e.keys.forEach((k: string) => keys.add(k))
        }
      }
      return [...keys].sort()
    }
    // keys a sidecar stage actually exchanges with any main-flow stage
    const sideKeys = (sid: string): string[] => {
      const keys = new Set<string>()
      for (const e of GRAPH.edges) {
        const fs = stageById.get(e.from), ts = stageById.get(e.to)
        if ((fs === sid && FLOW.includes(ts)) || (ts === sid && FLOW.includes(fs))) {
          e.keys.forEach((k: string) => keys.add(k))
        }
      }
      return [...keys].sort()
    }
    const card = (sid: string, no: number, footer = ''): string => {
      const stg = STAGES.find((s) => s.id === sid)!
      const members = membersOf(sid)
      // width ∝ member count: heavy stages grow wide and short, so the rows
      // stay close in height and the fit-to-view scale stays readable
      return `<section class="stg" style="--c: var(${stg.css}); flex-grow: ${Math.max(1, members.length)}">
        <header><span class="no">${String(no).padStart(2, '0')}</span><h3>${t(stg.title)}</h3><b>${members.length}</b></header>
        <p class="d">${t(stg.desc)}</p>
        <div class="chips">${members.map((n: any) => {
          const c = catColor(n.category)
          const cls = ['pill', n.state === 'failed' ? 'fail' : '', state.sel === n.id ? 'sel' : '',
            freshIds.has(n.id) ? 'pulse' : ''].filter(Boolean).join(' ')
          const mark = n.state === 'failed' ? ' ✕' : (n.state && n.state !== 'active' ? ' ⏳' : '')
          return `<span class="${cls}" data-id="${esc(n.id)}"${c ? ` style="--pc: var(${c})"` : ''}><span class="dot"></span><span class="lb">${esc(nodeLabel(n))}${mark}</span></span>`
        }).join('')}</div>${footer}</section>`
    }
    let flow = ''
    FLOW.forEach((sid, i) => {
      if (i > 0) {
        const keys = crossKeys(FLOW[i - 1], sid)
        flow += `<div class="flow">${keys.length ? `<span class="keys">${keys.join(' ')}</span>` : ''}<span class="arr">→</span></div>`
      }
      flow += card(sid, i + 1)
    })
    let side = `<span class="sideTag">${t('sideTag')}</span>`
    SIDE.forEach((sid, i) => {
      const keys = sideKeys(sid)
      const footer = keys.length
        ? `<div class="xkeys"><b>↔</b> ${keys.slice(0, 8).map(esc).join(' · ')}${keys.length > 8 ? ` +${keys.length - 8}` : ''}</div>`
        : ''
      side += card(sid, FLOW.length + i + 1, footer)
    })
    $('.journey').innerHTML = `<p class="hint">${t('journeyHint')}</p><div class="jr"><div class="jrZoom"><div class="jrFit"><div class="jrRow">${flow}</div><div class="jrRow side">${side}</div></div></div></div>`
    $('.journey').querySelectorAll<HTMLElement>('.pill').forEach((chip) => {
      const n = byId.get(chip.dataset.id ?? '')
      if (n) bindHover(chip, n)
    })
    $('.stats').textContent = t('statsJourney', { m: GRAPH.nodes.length })
    fitJourney(true)
  }

  /** Journey zoom multiplier on top of the auto-fit scale: 1 = fit, up to 4 for reading. */
  let journeyZoom = 1
  /** Last measured natural (unscaled) journey block size; frozen while zoomed so pill wrapping never re-flows. */
  let journeyNat: { w: number; h: number } | null = null

  /**
   * Scale the journey rows so the whole message path fits the visible area
   * with no scrollbars. `scale()` alone cannot create scrollable extent —
   * layout size is transform-independent — so the measured natural size also
   * drives the `.jrZoom` wrapper's explicit width/height; that wrapper is what
   * `.jr` scrolls when `journeyZoom` > 1 magnifies the block past the viewport.
   * `reset` re-measures the natural layout (render, viewport change at fit);
   * zoom buttons reuse the cached size so wrapping stays stable while reading.
   */
  function fitJourney(reset = false): void {
    const jr = $('.jr') as HTMLElement
    const zoom = jr.querySelector(':scope > .jrZoom') as HTMLElement | null
    const fit = zoom?.querySelector(':scope > .jrFit') as HTMLElement | null
    if (zoom === null || fit === null) return
    const cw = jr.clientWidth
    const ch = jr.clientHeight
    if (reset || journeyNat === null) {
      // measure against the real viewport: stale explicit sizes on the wrapper
      // would otherwise cap the natural layout at the previous pass's scale
      zoom.style.width = ''
      zoom.style.height = ''
      zoom.style.marginLeft = ''
      zoom.style.marginTop = ''
      fit.style.width = ''
      journeyNat = { w: Math.max(fit.offsetWidth, fit.scrollWidth), h: fit.offsetHeight }
    }
    const { w, h } = journeyNat
    fit.style.width = `${w}px`
    const base = Math.min(1, (cw - 2) / Math.max(1, w), (ch - 2) / Math.max(1, h))
    const k = base * journeyZoom
    zoom.style.width = `${w * k}px`
    zoom.style.height = `${h * k}px`
    zoom.style.marginLeft = w * k >= cw ? '0px' : `${(cw - w * k) / 2}px`
    zoom.style.marginTop = h * k >= ch ? '0px' : `${(ch - h * k) / 2}px`
    fit.style.transform = `scale(${k})`
    // applying the fit can itself flip scrollbars on/off (the pre-fit natural
    // layout overflows), which changes the client box no ResizeObserver sees —
    // re-run once when that happened; sizes converge on the second pass
    if (jr.clientWidth !== cw || jr.clientHeight !== ch) fitJourney(reset)
  }

  /** Detail panel for a package-family card (domains view). */
  function renderDetailFamily(famId: string, members: any[]): void {
    $('.detail').innerHTML = `
    <h2>${esc(famId)} · ${members.length}</h2>
    <div class="dir">${t('familyTip')}</div>
    <div class="members">${members.map((m: any) =>
      `<div class="m"><b>${esc(nodeLabel(m))}${m.state === 'failed' ? ' ✕' : m.state !== 'active' && m.state ? ' ⏳' : ''}</b>${descOf(m) ? `<span>${esc(descOf(m) as string)}</span>` : ''}</div>`).join('')}
    </div>
    <button class="open-btn">${t('openGroup')}</button>`
    ;(container.querySelector('.detail .open-btn') as HTMLElement).onclick = () => enterScope('fam:' + famId)
  }

  /** Tooltip + click + open for a family pill. */
  function bindFamilyHover(g: Element, famId: string, members: any[]): void {
    g.addEventListener('mouseenter', () => {
      showTip(`<div class="t">${esc(famId)} · ${members.length}</div>` +
        `<div class="d">${t('familyTip')}</div>` +
        `<div class="k">${members.slice(0, 8).map((m) => nodeLabel(m)).join(', ')}${members.length > 8 ? ' …' : ''}</div>`)
    })
    g.addEventListener('mousemove', moveTip)
    g.addEventListener('mouseleave', hideTip)
    g.addEventListener('click', (ev) => {
      ev.stopPropagation()
      state.sel = 'fam:' + famId
      renderDetailFamily(famId, members)
      render()
    })
    g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); enterScope('fam:' + famId) })
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
    if (variant.includes('cluster') || variant.includes('family')) el('rect', { class: 'bar', x: p.x + 6, y: p.y + 6, width: '4', height: String(H - 12), rx: '2' }, g)
    else el('circle', { class: 'accent', cx: p.x + 14, cy: p.y + H / 2, r: '4.5' }, g)
    const tx = variant.includes('cluster') || variant.includes('family') ? p.x + 18 : p.x + 26
    el('text', { x: tx, y: p.y + H / 2 + 1 }, g).textContent = label
    ;(g as unknown as HTMLElement).dataset.id = id
    if (hit) bindHover(g, hit)
    return g
  }

  function render(refit = false): void {
    if (GRAPH === null) return
    if (state.tab === 'journey') { renderJourney(); paintActivity(); return }
    const scoped = !!state.scope
    const L = scoped ? layoutScope() : layoutOverview()
    lastL = L

    const edgePath = (a: any, b: any): string => {
      const dx = Math.max(30, (b.x - (a.x + a.w)) * 0.45)
      return `M ${a.x + a.w} ${a.y + H / 2} C ${a.x + a.w + dx} ${a.y + H / 2}, ${b.x - dx} ${b.y + H / 2}, ${b.x - 3} ${b.y + H / 2}`
    }
    const catOfUnit = (id: string): string | null => {
      if (id.startsWith('cluster:')) return clusterById.get(id)?.category
      if (id.startsWith('fam:')) return L.units.find((u: any) => u.id === id)?.cat ?? null
      if (id.startsWith('ext:') || id.includes('|')) return null
      return byId.get(id)?.category
    }
    const unitLabel = (id: string): string => clusterById.get(id)?.label
      ?? (byId.has(id) ? nodeLabel(byId.get(id)) : (L.units.find((u: any) => u.id === id)?.label ?? id))

    if (state.tab === 'domains') {
      svg.setAttribute('viewBox', `0 0 ${svg.clientWidth} ${svg.clientHeight}`)
      world.innerHTML = ''
      const gE = el('g', {}, world)
      const gN = el('g', {}, world)
      const nodeEls = new Map<string, Element>(), edgeEls: any[] = []

      const drawEdge = (e: any): void => {
        const a = L.pos.get(e.from), b = L.pos.get(e.to)
        if (!a || !b) return
        const c = catColor(catOfUnit(e.to) ?? '')
        const d = edgePath(a, b)
        const p = el('path', { class: 'edge', style: c ? `--c: var(${c})` : '--c: var(--ink-3)', d }, gE)
        const hit = el('path', { class: 'edgeHit', d }, gE)
        p.dataset.from = e.from
        p.dataset.to = e.to
        p.dataset.keys = e.keys.join(', ')
        const fl = unitLabel(e.from), tl = unitLabel(e.to)
        hit.addEventListener('mouseenter', () => {
          p.classList.add('on')
          showTip(`<div class="t">${esc(fl)} → ${esc(tl)}</div>` +
            `<div class="d">${t('edgeUse', { a: esc(fl), b: esc(tl) })}</div>` +
            `<div class="k">ctx.${e.keys.join(', ctx.')}</div>` +
            `<div class="d">${t('edgeDir')}</div>`)
        })
        hit.addEventListener('mousemove', moveTip)
        hit.addEventListener('mouseleave', () => { p.classList.remove('on'); hideTip() })
        edgeEls.push(p)
      }

      if (scoped) {
        for (const e of L.edges) drawEdge(e)
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
          const v = stateVariant(u.node) + (freshIds.has(u.id) ? ' pulse' : '')
          const g = drawPill(gN, u.id, L.pos.get(u.id), u.label, u.cat, v, u.node)
          nodeEls.set(u.id, g)
        }
        $('.stats').textContent =
          t('scopeStats', { l: L.cluster.label, a: L.members.length, b: L.cluster.members.length, n: L.edges.length })
      } else {
        const unitEdges = overviewEdges(L)
        for (const e of unitEdges) drawEdge(e)
        for (const u of L.units) {
          if (u.kind === 'family') {
            const g = drawPill(gN, u.id, L.pos.get(u.id), u.label, u.cat, 'family' + (freshIds.has(u.id) ? ' pulse' : ''), null)
            bindFamilyHover(g, u.family.id, u.family.members)
            nodeEls.set(u.id, g)
            continue
          }
          const v = (u.kind === 'cluster' ? 'cluster' : stateVariant(u.node)) + (freshIds.has(u.id) ? ' pulse' : '')
          const g = drawPill(gN, u.id, L.pos.get(u.id), u.label, u.cat, v, u.kind === 'node' ? u.node : null)
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
      if (state.sel && nodeEls.has(state.sel)) focusNode(state.sel, nodeEls, edgeEls)
      else resetFocus(nodeEls, edgeEls)
      if (refit) fit(L)
    } else {
      const failed = GRAPH.nodes.filter((n: any) => n.state === 'failed').length
      $('.stats').textContent =
        t('stats', { m: GRAPH.nodes.length, s: GRAPH.nodes.filter(visibleNode).length, e: GRAPH.edges.length })
        + (failed ? t('statsFailed', { f: failed }) : '')
    }

    renderTable(L)
    const crumb = $('.crumb')
    crumb.classList.toggle('on', scoped)
    crumb.textContent = t('overview')
    $('.subtitle').textContent = scoped ? '/ ' + L.cluster.label : t('subtitle')
    paintActivity()
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
    renderDetailCluster(scopeTarget(id))
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
      <dt title="${t('dtListensTip')}">${t('dtListens')}</dt><dd class="keys">${(typeof n.module === 'string' ? modSubs.get(n.module) ?? [] : []).length ? (modSubs.get(n.module) ?? []).map((k: string) => `<code>${k}</code>`).join(' ') : '<span class="empty">—</span>'}</dd>
      <dt title="${t('dtReadsTip')}">${t('dtReads')}</dt><dd class="keys">${(typeof n.module === 'string' ? modReads.get(n.module) ?? [] : []).length ? (modReads.get(n.module) ?? []).map((r: { key: string; count: number }) => `<code>${r.key} <b>×${r.count}</b></code>`).join(' ') : '<span class="empty">—</span>'}</dd>
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
      if (state.sel.startsWith('fam:')) {
        const fam = state.sel.slice(4)
        const members = GRAPH?.nodes.filter((n: any) => n.group === fam) ?? []
        if (members.length > 0) return renderDetailFamily(fam, members)
      }
    }
    if (state.scope) return renderDetailCluster(scopeTarget(state.scope))
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

    const legend = document.createElement('span')
    legend.className = 'legend'
    legend.textContent = '⇢ ' + t('legendEdge')
    f.appendChild(legend)
  }

  function fit(L: any): void {
    const w = Number(world.dataset.width || L.width || 1200)
    const h = Number(world.dataset.height || L.height || 800)
    const k = Math.min(1, svg.clientWidth / (w + 48), svg.clientHeight / (h + 24))
    view = { k, tx: Math.max(8, (svg.clientWidth - w * k) / 2), ty: Math.max(8, (svg.clientHeight - h * k) / 2) }
    applyView()
  }

  // ------- data + live updates -------
  /**
   * Rebuild every derived map from a fetched snapshot and repaint. First
   * application resets selection and honors the #cluster: deep link; later
   * ones keep the current scope/selection when they still exist.
   */
  const applyGraph = (g: any, first: boolean): void => {
    GRAPH = g
    byId = new Map(GRAPH.nodes.map((n: any) => [n.id, n]))
    clusterById = new Map(GRAPH.clusters.map((c: any) => [c.id, c]))
    keyOwners = new Map()
    for (const n of GRAPH.nodes) for (const k of n.provides) {
      if (!keyOwners.has(k)) keyOwners.set(k, [])
      keyOwners.get(k)!.push(n)
    }
    moduleIds = new Map()
    for (const n of GRAPH.nodes) {
      if (typeof n.module !== 'string') continue
      if (!moduleIds.has(n.module)) moduleIds.set(n.module, [])
      moduleIds.get(n.module)!.push(n.id)
    }
    evRecv = new Map((GRAPH.eventSubs ?? []).map((e: any) => [e.name as string, e.listeners as { id: string; module: string | null; count: number }[]]))
    modSubs = new Map()
    for (const e of GRAPH.eventSubs ?? []) {
      for (const l of e.listeners ?? []) {
        if (typeof l.module !== 'string') continue
        if (!modSubs.has(l.module)) modSubs.set(l.module, [])
        modSubs.get(l.module)!.push(e.name)
      }
    }
    modReads = new Map()
    for (const r of GRAPH.serviceReads ?? []) {
      if (typeof r.module !== 'string') continue
      if (!modReads.has(r.module)) modReads.set(r.module, [])
      modReads.get(r.module)!.push({ key: r.key as string, count: r.count as number })
    }
    paintRecv()
    if (first) { state.scope = null; state.sel = null }
    else if (state.scope !== null && scopeTarget(state.scope) === undefined) { state.scope = null; state.sel = null }
    else if (state.sel !== null && !byId.has(state.sel) && !clusterById.has(state.sel) && !state.sel.startsWith('fam:')) state.sel = null
    setMeta()
    renderChips()
    render(first)
    ensureZh()
    refreshDetail()
    if (first) {
      // deep link: open a cluster directly via #cluster:<label> (URL-encoded)
      const m = decodeURIComponent(location.hash).match(/^#cluster:(.+)$/)
      const target = m && GRAPH.clusters.find((c: any) => c.label === m[1])
      if (target) enterScope(target.id)
    }
  }

  /** JSON signature of everything the canvas shows; equal strings = no visual change. */
  const signature = (g: any): string => JSON.stringify([
    g.nodes.map((n: any) => [n.id, n.state, n.provides.join(','), n.inject.join(',')]).sort(),
    g.edges.map((e: any) => [e.from, e.to, e.keys.join(',')]).sort(),
    g.clusters.map((c: any) => [c.id, c.members.length]).sort(),
    g.externalKeys,
  ])

  let lastSig = ''
  const toastEl = $('.toast')
  const toast = (msg: string): void => {
    toastEl.textContent = msg
    toastEl.classList.add('on')
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 6000)
  }

  /** Fetch a snapshot; first load paints it, later loads diff against the shown one. */
  const load = async (first = false): Promise<void> => {
    let g: any
    try {
      g = await (await fetch('/schematic/graph.json', { cache: 'no-store' })).json()
    } catch {
      $('.stats').textContent = t('loadFail')
      return
    }
    if (disposed) return
    const sigNow = signature(g)
    if (first) { applyGraph(g, true); lastSig = sigNow; return }
    if (sigNow === lastSig) return
    const prev = byId
    const addedNodes = g.nodes.filter((n: any) => !prev.has(n.id))
    const removedIds = [...prev.keys()].filter((id) => !g.nodes.some((n: any) => n.id === id))
    freshIds.clear()
    for (const n of addedNodes) freshIds.add(n.id)
    lastSig = sigNow
    applyGraph(g, false)
    const brief = (xs: string[]): string => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` +${xs.length - 3}` : '')
    toast(t('changedToast', {
      a: addedNodes.length > 0 ? brief(addedNodes.map((n: any) => n.label ?? n.id)) : '—',
      r: removedIds.length > 0 ? brief(removedIds.map((id) => prev.get(id)?.label ?? id)) : '—',
    }))
    window.setTimeout(() => { freshIds.clear(); render() }, 7000)
  }

  /** Auto-refresh cadence; a tick is skipped while paused, hidden, or disposed. */
  const REFRESH_MS = 5000
  let autoOn = true
  pollTimer = window.setInterval(() => {
    if (disposed || !autoOn || document.hidden) return
    void load()
  }, REFRESH_MS)
  const autoBtn = $('.autoBtn')
  autoBtn.addEventListener('click', () => {
    autoOn = !autoOn
    autoBtn.setAttribute('aria-pressed', String(autoOn))
    autoBtn.textContent = autoOn ? '⏸' : '▶'
  })

  // ------- activity feed (SSE /schematic/events) -------
  /**
   * The runtime-activity layer rides on top of the structural renders: the
   * 5s graph poll rebuilds the DOM, then paintActivity() re-applies live
   * classes to whatever pills now exist — two independent clocks, one paint.
   */
  const LIVE_TTL_MS = 4000
  const act = {
    sessions: new Map<string, any>(),
    timelines: new Map<string, any[]>(),
    /** null = follow the SPA's current chat session (dsh.sessions.current). */
    pinned: null as string | null,
    followId: '' as string,
    /** set once the first SSE snapshot lands; absence knowledge needs it. */
    seenSnapshot: false,
    includeSub: false,
    /** service-read rows visible in the timeline (toggle on the activity bar). */
    showSvc: true,
    /** module → { until, strong }; strong entries survive the TTL sweeper. */
    active: new Map<string, { until: number; strong: boolean }>(),
    /** last known llm provider module per session (for streaming highlight). */
    lastLlm: new Map<string, string | null>(),
    /** host-scope action ring (RPC mutations + live registry changes). */
    actions: [] as any[],
  }
  const AK: Record<string, string> = {
    user: 'akUser', llm: 'akLlm', tool: 'akTool', 'tool-end': 'akToolEnd', turn: 'akTurn',
    approval: 'akApproval', todo: 'akTodo', compaction: 'akCompaction', retry: 'akRetry',
    subagent: 'akSubagent', title: 'akTitle', action: 'akAction', svc: 'akSvc',
  }
  const sessSel = $('.sessSel') as unknown as HTMLSelectElement
  const subBtn = $('.subBtn')
  const svcBtn = $('.svcBtn')
  const actbar = $('.actbar')
  const actList = $('.actList')
  const runDot = $('.runDot')
  const actSess = $('.actSess')
  const actState = $('.actState')

  /** module → the pills currently drawn for it (node, its cluster, or its family). */
  const cssEscape: (v: string) => string = (globalThis as any).CSS?.escape?.bind((globalThis as any).CSS)
    ?? ((v: string) => v.replace(/["\\]/g, '\\$&'))
  const elsForModule = (module: string): Element[] => {
    const out: Element[] = []
    for (const id of moduleIds.get(module) ?? []) {
      const n = byId.get(id)
      if (n === undefined) continue
      for (const cand of [typeof n.cluster === 'string' ? n.cluster : null, 'fam:' + n.group, id]) {
        if (cand === null) continue
        const els = container.querySelectorAll(`[data-id="${cssEscape(cand)}"]`)
        if (els.length > 0) { out.push(...els); break }
      }
    }
    return out
  }

  /** Re-apply live/live-strong to the currently drawn pills; clears stale ones. */
  function paintActivity(): void {
    container.querySelectorAll('.live').forEach((e) => e.classList.remove('live'))
    container.querySelectorAll('.live-strong').forEach((e) => e.classList.remove('live-strong'))
    const now = Date.now()
    for (const [module, info] of act.active) {
      if (!info.strong && info.until < now) continue
      const els = elsForModule(module)
      for (const el of els) el.classList.add(info.strong ? 'live-strong' : 'live')
    }
  }

  const touchModule = (module: string, strong: boolean): void => {
    const prev = act.active.get(module)
    // strong means "work in flight": it survives the TTL sweeper until the
    // matching end event downgrades it (or a snapshot rebuilds the map).
    const nextStrong = strong || (prev?.strong ?? false)
    act.active.set(module, { until: nextStrong ? Number.POSITIVE_INFINITY : Date.now() + LIVE_TTL_MS, strong: nextStrong })
    paintActivity()
  }

  /**
   * Hydrate in-flight highlights from a session state: in-flight tool owners
   * light up strong (a page opened mid-run, or a missed activity frame), and
   * the streaming provider lights while chunks flow. The has() guard means a
   * tool-end downgrade is never resurrected by a trailing throttled state.
   */
  const hydrateState = (s: any): void => {
    if (!shownEntry(s.sessionId)) return
    const llmMod = act.lastLlm.get(s.sessionId)
      ?? (Array.isArray(s.activeModules) ? s.activeModules.find((m: string) => m.includes('/dsh-llm')) : undefined)
    if (llmMod !== undefined && s.streaming === true) {
      act.lastLlm.set(s.sessionId, llmMod)
      act.active.set(llmMod, { until: Date.now() + LIVE_TTL_MS, strong: true })
    } else if (llmMod !== undefined && act.active.get(llmMod)?.strong) {
      // stream settled (assistant/message / turn/end flipped streaming off):
      // downgrade like a tool-end, or the strong entry never expires
      act.active.set(llmMod, { until: Date.now() + LIVE_TTL_MS, strong: false })
    }
    for (const m of Array.isArray(s.activeModules) ? s.activeModules : []) {
      if (act.active.has(m)) continue
      act.active.set(m, { until: Number.POSITIVE_INFINITY, strong: true })
    }
  }

  /** Which sessions the timeline shows: the followed one, plus subagents when toggled. */
  const shownSessions = (): string[] => {
    const out = [act.pinned ?? act.followId]
    if (act.includeSub) {
      for (const [id, s] of act.sessions) {
        if (s.kind === 'subagent' && !out.includes(id)) out.push(id)
      }
    }
    return out.filter((id) => id !== '' && id !== null)
  }
  const shownEntry = (sessionId: string): boolean =>
    sessionId === (act.pinned ?? act.followId)
    || (act.includeSub && act.sessions.get(sessionId)?.kind === 'subagent')

  const moduleShort = (m: string): string => {
    const last = m.split('/').pop() ?? m
    return last.replace(/^dsh-/, '')
  }
  const moduleColorCss = (m: string): string | null => {
    for (const id of moduleIds.get(m) ?? []) {
      const n = byId.get(id)
      const c = n ? catColor(n.category) : null
      if (c) return `var(${c})`
    }
    return null
  }
  const detailOf = (e: any): string => {
    switch (e.kind) {
      case 'user': return (e.snippet ?? e.name ?? '') || '—'
      case 'llm': return [e.provider, e.model].filter(Boolean).join(' · ') || '—'
      case 'tool': return e.name ?? ''
      case 'tool-end': return (e.name ?? '') + (e.durationMs !== undefined ? ` · ${e.durationMs}ms` : '') + (e.isError ? ' ✕' : '')
      case 'turn': return '#' + (e.name ?? '')
      case 'action': return (e.name ?? '') + (e.durationMs !== undefined ? ` · ${e.durationMs}ms` : '') + (e.isError ? ' ✕' : '')
      case 'svc': return e.name ?? ''
      default: return e.name ?? ''
    }
  }
  const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour12: false })

  /** Full redraw of the timeline list from the shown sessions' rings + host actions. */
  function renderActList(): void {
    const rows: any[] = [...act.actions]
    for (const id of shownSessions()) rows.push(...(act.timelines.get(id) ?? []))
    const visible = act.showSvc ? rows : rows.filter((e) => e.kind !== 'svc')
    visible.sort((a, b) => b.time - a.time)
    const shown = visible.slice(0, 60)
    if (shown.length === 0) {
      actList.innerHTML = `<span class="emptyRow">${t('actEmpty')}</span>`
      return
    }
    actList.innerHTML = shown.map((e) => {
      const badge = e.module !== null
        ? `<span class="md"${moduleColorCss(e.module) ? ` style="--mc: ${moduleColorCss(e.module)}"` : ''}>${esc(moduleShort(e.module))}</span>`
        : ''
      const label = t(AK[e.kind] ?? AK.turn)
      // every non-action row arrived as one session/event broadcast — hover
      // names the units that received it (host-domain actions and service
      // reads did not broadcast)
      const tip = e.kind === 'action' || e.kind === 'svc' ? '' : recvTip()
      return `<div class="actRow${e.isError ? ' err' : ''}"${e.module ? ` data-module="${esc(e.module)}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}><time>${fmtTime(e.time)}</time>${badge}<span class="tx">${label} · ${esc(detailOf(e))}</span></div>`
    }).join('')
  }

  /** Header line: followed session title + running state + in-flight tools. */
  function renderActHead(): void {
    const id = act.pinned ?? act.followId
    const s = id !== '' ? act.sessions.get(id) : undefined
    actSess.textContent = s ? (s.title || s.sessionId) : '—'
    runDot.classList.toggle('on', s?.running === true)
    actState.textContent = s
      ? (s.running ? t('actRunning') : t('actIdle')) + (s.inflightTools?.length ? ' · ' + s.inflightTools.join(' ') : '') + (s.kind === 'subagent' ? ' · ' + t('akSubagent') : '')
      : ''
  }

  /**
   * Header receiver line: which mounted units listen to the session-event
   * broadcast every timeline row rode on. Names in the native tooltip.
   */
  function paintRecv(): void {
    const el = $('.recv')
    if (el === null) return
    const ls = evRecv.get('session/event') ?? []
    const names = ls.map((l) => l.module ?? l.id)
    el.textContent = ls.length > 0 ? t('recvLine', { n: ls.length }) + ' · ' + names.join(', ') : ''
    el.title = names.length > 0 ? t('recvNames') + ':\n' + names.join('\n') : ''
  }

  /** Row tooltip: the session/event broadcast this row rode on, and its receivers. */
  function recvTip(): string {
    const ls = evRecv.get('session/event') ?? []
    return ls.length > 0 ? `session/event → ${ls.map((l) => l.module ?? l.id).join(', ')}` : ''
  }

  /** Session selector options: follow-chat first, then sessions (running ● first). */
  function renderSessSel(): void {
    const order = [...act.sessions.values()].sort((a: any, b: any) =>
      (Number(b.running) - Number(a.running)) || (Number(a.kind === 'main') - Number(b.kind === 'main')))
    const opts = [`<option value="">${t('sessFollow')}</option>`].concat(order.map((s: any) => {
      const label = (s.running ? '● ' : '') + (s.title || s.sessionId.slice(0, 18)) + (s.kind === 'subagent' ? ' ⌥' : '')
      return `<option value="${esc(s.sessionId)}">${esc(label)}</option>`
    }))
    sessSel.innerHTML = opts.join('')
    sessSel.value = act.pinned ?? ''
  }
  sessSel.addEventListener('change', () => {
    act.pinned = sessSel.value === '' ? null : sessSel.value
    try { localStorage.setItem('sch.session', act.pinned ?? '') } catch { /* storage unavailable: choice lasts for this page only */ }
    renderActHead()
    renderActList()
    paintActivity()
  })
  subBtn.addEventListener('click', () => {
    act.includeSub = !act.includeSub
    subBtn.setAttribute('aria-pressed', String(act.includeSub))
    renderActList()
  })
  svcBtn.addEventListener('click', () => {
    act.showSvc = !act.showSvc
    svcBtn.setAttribute('aria-pressed', String(act.showSvc))
    renderActList()
  })
  // Clicking a row performs the same selection a pill click performs above:
  // the module's detail panel opens in whatever tab is showing. Rows whose
  // module is unmounted or unattributed carry no data-module and stay inert.
  actList.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest('.actRow') as HTMLElement | null
    const module = row?.dataset.module
    if (module === undefined) return
    const n = byId.get(moduleIds.get(module)?.[0] ?? '')
    if (n === undefined) return
    state.sel = n.id
    renderDetail(n)
    render()
  })
  $('.actFold').addEventListener('click', () => {
    const folded = actbar.classList.toggle('folded')
    $('.actFold').setAttribute('aria-pressed', String(!folded))
  })

  /** Follow mode: track the SPA's current session from localStorage. */
  const applyFollow = (): void => {
    unpinIfGone()
    if (act.pinned !== null) return
    let id = ''
    try {
      const raw = JSON.parse(localStorage.getItem('dsh.sessions.current') ?? 'null')
      if (raw !== null && typeof raw.sessionId === 'string') id = raw.sessionId
    } catch { /* unreadable selection falls through to the running/first chain */ }
    if (id === '' || !act.sessions.has(id)) {
      // no SPA selection to follow: prefer a running session, else the most
      // recently active one, so the bar does not land on a stale empty session
      const all = [...act.sessions.values()]
      const running = all.find((s: any) => s.running)
      const recent = [...all].sort((a: any, b: any) => (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0))[0]
      id = (running ?? recent)?.sessionId ?? ''
    }
    if (id !== act.followId) {
      act.followId = id
      renderSessSel()
      renderActHead()
      renderActList()
    }
  }

  /** A pinned session that no longer exists must not pin the bar forever. */
  const unpinIfGone = (): void => {
    // only trust absence once a snapshot has stated what exists — before it,
    // an empty map says nothing and a valid pin must survive
    if (!act.seenSnapshot || act.pinned === null || act.sessions.has(act.pinned)) return
    act.pinned = null
    try { localStorage.setItem('sch.session', '') } catch { /* storage unavailable: pin lasts for this page only */ }
    sessSel.value = ''
    renderActHead()
    renderActList()
  }
  window.addEventListener('storage', (e) => {
    if (e.key === 'dsh.sessions.current') applyFollow()
  }, sig)
  // Any resize of the journey viewport — window resize, the activity bar
  // growing as the SSE snapshot arrives or being folded — re-fits the scale.
  // Observing the static .journey container (renderJourney replaces .jr's
  // subtree each render); a transform never resizes it, so this cannot loop.
  if (typeof ResizeObserver !== 'undefined') {
    const journey = $('.journey') as Element | null
    if (journey !== null) {
      const ro = new ResizeObserver(() => { if (state.tab === 'journey') fitJourney(journeyZoom === 1) })
      ro.observe(journey)
      ac.signal.addEventListener('abort', () => ro.disconnect())
    }
  }

  /** One SSE frame. State frames are full; activity frames are incremental. */
  function onFrame(frame: any): void {
    if (frame.type === 'snapshot') {
      const changed: string[] = []
      for (const s of frame.sessions as any[]) {
        const prev = act.sessions.get(s.sessionId)
        if (prev === undefined
          || prev.title !== s.title || prev.running !== s.running || prev.kind !== s.kind) changed.push(s.sessionId)
        act.sessions.set(s.sessionId, s)
      }
      for (const { sessionId, entries } of frame.timeline as any[]) {
        act.timelines.set(sessionId, entries)
      }
      act.actions = Array.isArray(frame.actions) ? frame.actions.slice(-200) : []
      act.seenSnapshot = true
      applyFollow()
      // The snapshot is authoritative for in-flight work: rebuild the
      // highlight map from it so connecting mid-run lights up immediately.
      act.active.clear()
      for (const s of frame.sessions as any[]) hydrateState(s)
      renderSessSel()
      renderActHead()
      renderActList()
      paintActivity()
      return
    }
    if (frame.type === 'state') {
      const s = frame.state
      if (s.disposed === true) {
        act.sessions.delete(s.sessionId)
        act.timelines.delete(s.sessionId)
        if (act.followId === s.sessionId || act.pinned === s.sessionId) applyFollow()
        renderSessSel()
        renderActHead()
        renderActList()
        return
      }
      const prev = act.sessions.get(s.sessionId)
      act.sessions.set(s.sessionId, s)
      // a session appearing can resolve a follow that raced ahead of it:
      // the storage event fired before this session existed, so applyFollow
      // fell back to an older one — re-read the SPA's pick now that it can match
      if (prev === undefined) applyFollow()
      if (prev === undefined || prev.title !== s.title || prev.running !== s.running) renderSessSel()
      if (shownEntry(s.sessionId)) {
        renderActHead()
        hydrateState(s)
        paintActivity()
      }
      return
    }
    if (frame.type === 'activity') {
      const { sessionId, entry } = frame
      const ring = act.timelines.get(sessionId) ?? []
      ring.push(entry)
      if (ring.length > 200) ring.splice(0, ring.length - 200)
      act.timelines.set(sessionId, ring)
      if (entry.kind === 'llm') act.lastLlm.set(sessionId, entry.module)
      // highlight only what the timeline shows; a tool-end or a completed
      // assistant message downgrades strong (touchModule would keep it strong)
      if (entry.module !== null && entry.kind !== 'user' && shownEntry(sessionId)) {
        if (entry.kind === 'tool-end' || entry.kind === 'llm') {
          act.active.set(entry.module, { until: Date.now() + LIVE_TTL_MS, strong: false })
          paintActivity()
        } else {
          touchModule(entry.module, entry.kind === 'tool')
        }
      }
      if (shownEntry(sessionId)) renderActList()
      return
    }
    if (frame.type === 'action') {
      // Host-scope actions are process-level, not per-chat: always recorded
      // and always lit, regardless of which session the timeline follows.
      act.actions.push(frame.entry)
      if (act.actions.length > 200) act.actions.splice(0, act.actions.length - 200)
      if (frame.entry.module !== null) touchModule(frame.entry.module, false)
      renderActList()
      return
    }
    if (frame.type === 'traffic') {
      // The pure-wiring signal: a package actually read an injected ctx key.
      // Both ends light — the reader and the key's provider(s) — which is the
      // only live highlight packages with no broadcast listeners ever get.
      const time = Date.now()
      for (const r of frame.rows as any[]) {
        act.actions.push({ time, kind: 'svc', module: r.module ?? null, name: `ctx.${r.key} ×${r.n}` })
        if (act.actions.length > 200) act.actions.splice(0, act.actions.length - 200)
        if (typeof r.module === 'string') touchModule(r.module, false)
        for (const owner of keyOwners.get(r.key) ?? []) {
          if (typeof owner.module === 'string') touchModule(owner.module, false)
        }
      }
      renderActList()
    }
  }

  // restore a pinned session, then connect; EventSource auto-reconnects
  try {
    const saved = localStorage.getItem('sch.session')
    if (saved !== null && saved !== '') act.pinned = saved
  } catch { /* storage unavailable: always follow */ }
  const es = new EventSource('/schematic/events')
  let everConnected = false
  es.onopen = () => {
    // silent on the first connect; a later open means the stream dropped and
    // EventSource reconnected (snapshot-first makes that seamless)
    if (!everConnected) { everConnected = true; return }
    toast(t('actReconnected'))
  }
  es.onmessage = (ev) => {
    try { onFrame(JSON.parse(ev.data)) } catch { /* malformed frame: skip it, snapshot self-heals */ }
  }
  const sweep = window.setInterval(() => {
    const now = Date.now()
    let dirty = false
    for (const [module, info] of act.active) {
      if (info.strong || info.until >= now) continue
      act.active.delete(module)
      dirty = true
    }
    if (dirty) paintActivity()
  }, 600)
  disposeExtra = () => { es.close(); window.clearInterval(sweep) }

  // ------- events -------
  $('.search').addEventListener('input', (e) => { state.q = (e.target as HTMLInputElement).value.trim().toLowerCase(); render() })
  $('.crumb').addEventListener('click', exitScope)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { state.scope ? exitScope() : (state.sel = null, render()) }
  }, sig)
  container.querySelectorAll<HTMLButtonElement>('.tabBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = (btn.dataset.tab ?? 'journey') as typeof state.tab
      container.dataset.tab = state.tab
      container.querySelectorAll('.tabBtn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)))
      render(state.tab === 'domains')
    })
  })
  // drag-to-pan the journey row (plain HTML — the SVG canvas has its own pan;
  // touch input keeps the native overflow scroll, only mouse gets the drag)
  const jrPane = $('.journey')
  let jrDrag: { row: HTMLElement; x: number; y: number; left: number; top: number; moved: boolean } | null = null
  jrPane.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    // renderJourney rebuilds .jr via innerHTML on every render — resolve the
    // live row per drag, never cache the element across renders
    const row = jrPane.querySelector<HTMLElement>('.jr')
    if (row === null) return
    jrDrag = { row, x: e.clientX, y: e.clientY, left: row.scrollLeft, top: row.scrollTop, moved: false }
    jrPane.classList.add('dragging')
  })
  window.addEventListener('pointermove', (e) => {
    if (jrDrag === null) return
    const dx = e.clientX - jrDrag.x
    const dy = e.clientY - jrDrag.y
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) jrDrag.moved = true
    jrDrag.row.scrollLeft = jrDrag.left - dx
    jrDrag.row.scrollTop = jrDrag.top - dy
  }, sig)
  window.addEventListener('pointerup', () => {
    if (jrDrag?.moved === true) {
      // a drag ending on a pill must not also select it: swallow the
      // click that follows (dispatched before this timeout runs)
      const swallow = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault() }
      jrPane.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => jrPane.removeEventListener('click', swallow, { capture: true }), 0)
    }
    jrDrag = null
    jrPane.classList.remove('dragging')
  }, sig)
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
    renderSessSel()
    renderActHead()
    paintRecv()
    renderActList()
  })
  updateLangButton()
  $('.refresh').addEventListener('click', () => { void load() })
  $('.zoomIn').addEventListener('click', () => {
    if (state.tab === 'journey') { journeyZoom = Math.min(4, journeyZoom * 1.25); fitJourney(); return }
    view.k = Math.min(2.5, view.k * 1.25); applyView()
  })
  $('.zoomOut').addEventListener('click', () => {
    if (state.tab === 'journey') { journeyZoom = Math.max(1, journeyZoom / 1.25); fitJourney(); return }
    view.k = Math.max(0.25, view.k / 1.25); applyView()
  })
  $('.zoomFit').addEventListener('click', () => {
    if (state.tab === 'journey') { journeyZoom = 1; fitJourney(); return }
    if (lastL) fit(lastL)
  })
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

  void load(true)
  return dispose
}
