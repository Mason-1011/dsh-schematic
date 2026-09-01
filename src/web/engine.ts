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
  langTitle:       { en: 'switch to Chinese', zh: '切换到英文' },
  trans:           { en: 'translating {d}/{n}…', zh: '翻译中 {d}/{n}…' },
  emptyDetail:     { en: 'Click anything for details (groups included); double-click a group to open it.', zh: '点击任意元素(含分组)查看详情;双击分组进入。' },
  fit:             { en: 'fit', zh: '适配' },
  refreshTitle:    { en: 'Re-fetch the live snapshot', zh: '重新拉取实时快照' },
  stats:           { en: '{m} mounted · {s} shown · {e} edges', zh: '已挂载 {m} · 显示 {s} · 边 {e}' },
  statsFailed:     { en: ' · {f} failed', zh: ' · 失败 {f}' },
  scopeStats:      { en: '{l} · {a}/{b} members · {n} internal edges', zh: '{l} · 成员 {a}/{b} · 内部边 {n}' },
  zoneExt:         { en: 'HOST / UNRESOLVED CTX KEYS', zh: '宿主 / 未解析上下文键' },
  zoneIn:          { en: 'INJECTED BY', zh: '注入方' },
  zoneOut:         { en: 'MEMBERS INJECT', zh: '成员注入' },
  tipExtCount:     { en: 'injected by {n} unit(s)', zh: '由 {n} 个单元注入' },
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
  extKeys:         { en: 'host/unresolved keys', zh: '宿主/未解析键' },
  tipHostKey:      { en: 'host-provided: the launcher provides this key before the tree mounts', zh: '宿主提供:启动器在插件树挂载前就提供了这个键' },
  tipUnresKey:     { en: 'unresolved: nothing provides this key in this process — injectors read undefined', zh: '未解析:本进程里没有任何提供方——注入方读到 undefined' },
  statsUnres:      { en: ' · {n} unresolved key(s)', zh: ' · 未解析键 {n}' },
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
  edgeUse:         { en: '{a} provides the ctx services {b} injects', zh: '{a} 提供的 ctx 服务,由 {b} 注入' },
  edgeDir:         { en: 'arrow = provider → consumer; keys are ctx service names', zh: '箭头 = 提供者 → 使用者;键为 ctx 服务名' },
  legendEdge:      { en: 'A → B: A provides ctx services B injects', zh: 'A → B:A 提供 ctx 服务,B 注入' },
  familyTip:       { en: 'same package family — no capability seam between them', zh: '同包前缀家族——彼此未构成能力接缝' },
  spineTip:        { en: 'core loop packages — they ride only universal keys, so no capability seam claims them', zh: '核心脊柱——只依赖通用键,不构成任何能力接缝' },
  familyMembers:   { en: 'family members', zh: '家族成员' },
  changedToast:    { en: 'topology changed: +{a} · −{r}', zh: '拓扑变化:+{a} · −{r}' },
  autoTitle:       { en: 'toggle auto-refresh (every 5s)', zh: '切换自动刷新(每 5 秒)' },
  sessFollow:      { en: '↪ follow chat', zh: '↪ 跟随聊天' },
  actSub:          { en: 'subagents', zh: '含子代理' },
  actSubTitle:     { en: 'also show subagent sessions running in this process', zh: '同时显示本进程里运行的子代理会话' },
  sessSelTitle:    { en: 'which session the activity bar shows', zh: '活动条显示哪个会话的活动' },
  expandAll:       { en: 'expand all', zh: '全部展开' },
  collapseAll:     { en: 'collapse all', zh: '全部收起' },
  expAllTitle:     { en: 'scatter every group card into its member pills and re-pack the mesh (domains overview)', zh: '把所有分组卡打散成成员药丸并重排网状布局(领域总览)' },
  expTip:          { en: 'scatter this group into the mesh', zh: '把这个分组打散进网状布局' },
  expInOverview:   { en: 'scatter into overview', zh: '在总览中展开' },
  collapseGroup:   { en: 'collapse back into one card', zh: '收回为一张卡' },
  actEmpty:        { en: 'no activity yet — send a message in the followed session', zh: '暂无活动——在跟随的会话里发条消息试试' },
  actRunning:      { en: 'running', zh: '运行中' },
  actIdle:         { en: 'idle', zh: '空闲' },
  actLiveHint:     { en: 'glow = active now', zh: '发光 = 正在活动' },
  actReconnected:  { en: 'activity stream reconnected', zh: '活动流已重连' },
  actRep:          { en: 'replay', zh: '回放' },
  actRepTitle:     { en: 'replay this session\'s log history below the live rows', zh: '在实时行下方回放该会话的日志历史' },
  actRepDivider:   { en: 'live above · replayed below', zh: '以上实时 · 以下回放' },
  actRepMore:      { en: 'load earlier', zh: '加载更早' },
  actRepOldest:    { en: 'start of log reached', zh: '已到日志开头' },
  actRepLoading:   { en: 'reading history…', zh: '读取历史中…' },
  actRepFail:      { en: 'history read failed', zh: '历史读取失败' },
  actStats:        { en: 'stats', zh: '统计' },
  actStatsTitle:   { en: 'per-plugin activity counts of this instance\'s live window (replay excluded)', zh: '本实例观察窗内各插件的活动计数（不含回放）' },
  actStPlugin:     { en: 'plugin', zh: '插件' },
  actStRows:       { en: 'rows', zh: '行' },
  actStTool:       { en: 'tool', zh: '工具' },
  actStErr:        { en: 'err', zh: '败' },
  actStMs:         { en: 'tool time', zh: '耗时' },
  actStLlm:        { en: 'llm', zh: 'LLM' },
  actStNow:        { en: 'now', zh: '此刻' },
  actStLast:       { en: 'last', zh: '最近' },
  actStEmpty:      { en: 'no session activity observed in this window yet', zh: '观察窗内还没有会话活动' },
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
  akJob:           { en: 'background job', zh: '后台任务' },
  akWorkflow:      { en: 'workflow', zh: '工作流' },
  akWorkflowEnd:   { en: 'workflow done', zh: '工作流完成' },
  akSvc:           { en: 'service access', zh: '服务访问' },
  akTopo:          { en: 'topology', zh: '拓扑' },
  topoOn:          { en: 'mounted', zh: '已挂载' },
  topoOff:         { en: 'unmounted', zh: '已卸载' },
  actSvc:          { en: 'service access', zh: '服务访问' },
  actSvcTitle:     { en: 'show service-access rows: which package actually accessed which ctx service key (the provide/inject wiring in use)', zh: '显示服务访问行:哪个包真的访问了哪个 ctx 服务键(实际发生作用的提供/注入接线)' },
  recvLine:        { en: 'session/event broadcast → {n} in-listeners', zh: 'session/event 广播 → {n} 个插件在听' },
  recvNames:       { en: 'listeners of the session-event broadcast (from the live event bus)', zh: '会话事件广播的接收插件(来自运行中的事件总线)' },
  dtListens:       { en: 'listens to', zh: '监听事件' },
  dtListensTip:    { en: 'broadcast events this package listens to; packages that only provide/inject services register none', zh: '该包监听的广播事件;纯服务接线(只提供/注入服务)的包不注册任何监听' },
  dtReads:         { en: 'runtime access', zh: '运行时访问' },
  dtReadsTip:      { en: 'ctx service keys this package actually accessed since process start, with counts — the wiring that did work, not just the wiring that exists', zh: '进程启动以来该包真实访问过的 ctx 服务键及次数——是实际发生作用的接线,不只是存在的接线' },
  // composition edit (v0.3)
  editTitle:       { en: 'toggle edit mode (default off — the page stays a pure observer)', zh: '切换编辑模式(默认关——页面保持纯旁观)' },
  eLocked:         { en: 'composition view is read-only: {r}. Refresh or fix the file, then retry.', zh: '组合视图只读:{r}。刷新或修好文件后重试。' },
  eLastFail:       { en: 'harness rejected the last reload ({m}); the previous tree keeps running. Roll back?', zh: 'harness 拒载了上一次重载({m});旧插件树仍在运行。回滚吗?' },
  eRollback:       { en: '⟲ rollback', zh: '⟲ 回滚' },
  eRolledBack:     { en: 'rolled back to {f}', zh: '已回滚到 {f}' },
  eNoBackups:      { en: 'nothing to roll back to', zh: '没有可回滚的备份' },
  eApplied:        { en: 'applied — harness reloading…', zh: '已应用——harness 正在热重载…' },
  eApplyFail:      { en: 'apply failed: {m}', zh: '应用失败:{m}' },
  ePreviewFail:    { en: 'preview failed: {m}', zh: '预览失败:{m}' },
  eStale:          { en: 'the patch file changed elsewhere — model refreshed, please retry', zh: 'patch 文件被其他方修改——模型已刷新,请重试' },
  eDrawerTitle:    { en: 'composition preview · {n} op(s)', zh: '组合预览 · {n} 个操作' },
  eDiffRemoved:    { en: 'removed', zh: '移除' },
  eDiffAdded:      { en: 'added (provides unknown until mounted)', zh: '新增(挂载前 provides 未知)' },
  eDiffChanged:    { en: 'changed', zh: '变更' },
  eChangeDisabled: { en: 'disable', zh: '停用' },
  eChangeConfig:   { en: 'config', zh: '配置' },
  eNoChanges:      { en: 'no effective change', zh: '无实际变化' },
  eYamlDiff:       { en: 'managed block YAML', zh: '受管区块 YAML' },
  eWarnings:       { en: 'warnings', zh: '警告' },
  eOrphaned:       { en: 'orphaned keys (no known provider left)', zh: '失供键(已无已知提供方)' },
  wSelf:           { en: 'this removes the editor itself — after applying, this page dies. Restore: revert ~/.dsh/profiles/<name>/cordis.patch.yml to the newest backup in ~/.dsh/schematic/patches/, or hand-delete the marked block.', zh: '这会移除编辑器本体——应用后本页面会消失。恢复:把 ~/.dsh/profiles/<名>/cordis.patch.yml 写回 ~/.dsh/schematic/patches/ 里最新的备份,或手工删除标记区块。' },
  wFreeze:         { en: '{ids}: {fields} currently hold !!js expressions evaluated per boot; editing freezes them to literals. Original values are in the YAML diff below.', zh: '{ids}:{fields} 目前是每次启动求值的 !!js 表达式;编辑会把它冻结为字面量。原值见下方 YAML diff。' },
  wConflict:       { en: 'the old and new provider may both register the seam key; if the harness rejects the double registration it keeps the previous tree — roll back from the drawer.', zh: '新旧提供方可能同时注册接缝键;若 harness 拒绝双注册,它会保持旧插件树——在抽屉里回滚即可。' },
  wOrphan:         { en: 'key {keys} loses its last known provider; units still injecting it: {detail}. A pending new provider may cover it (unknown until mounted).', zh: '键 {keys} 失去最后一个已知提供方;仍在注入的单元:{detail}。待挂载的新提供方可能补上(挂载前未知)。' },
  wDropped:        { en: '{ids}: fields {keys} are dropped by the new config — patch semantics replace config whole.', zh: '{ids}:新配置丢掉了字段 {keys}——patch 语义是整体替换 config。' },
  wBoot:           { en: '{ids} is boot-critical ({detail}); the harness keeps the previous tree if the reload fails.', zh: '{ids} 是启动关键项({detail});重载失败时 harness 会保持旧插件树。' },
  eConfirmNeed:    { en: 'type {ids} to confirm the danger operation', zh: '输入 {ids} 以确认危险操作' },
  eConfirmPh:      { en: 'type the entry id', zh: '输入条目 id' },
  eApply:          { en: 'apply', zh: '应用' },
  eCancel:         { en: 'discard draft', zh: '丢弃草稿' },
  eClear:          { en: 'clear all schematic edits', zh: '撤销全部 schematic 改动' },
  eCleared:        { en: 'cleared — {n} row(s) removed', zh: '已清空——移除 {n} 行' },
  eCfgTitle:       { en: 'edit config · {id}', zh: '编辑配置 · {id}' },
  eCfgTitleAdd:    { en: 'add config · {id}', zh: '新增配置 · {id}' },
  eCfgHint:        { en: 'patch semantics replace the whole config — keep every field you want to keep; !!js freezes to literals.', zh: 'patch 语义整体替换 config——想保留的字段都要写上;!!js 会冻结为字面量。' },
  eCfgHintAdd:     { en: 'this entry has no config yet — it runs on defaults. The fields you write below become its new config (a normal patch row), previewed and backed up like every change.', zh: '这个条目现在没有配置——一直用默认值跑。你在下面写下的字段将成为它的新配置(一条正常的 patch 行),和其他改动一样先预览、有备份。' },
  eCfgPreview:     { en: 'preview change', zh: '预览变更' },
  eCfgEmpty:       { en: 'config must be a YAML mapping (can be empty: {})', zh: 'config 必须是 YAML 映射(可以为空:{})' },
  eCfgReset:       { en: 'reset', zh: '恢复原文' },
  eCfgKeys:        { en: 'fields — struck-through ones your edit drops', zh: '字段——划掉的是你的改动会丢掉的字段' },
  eCfgNoKeys:      { en: 'no fields yet — add “key: value” lines', zh: '还没有字段——加一行「键: 值」试试' },
  eCfgTabErr:      { en: 'no Tab characters in YAML — use spaces', zh: 'YAML 里不能用 Tab——请用空格' },
  eCfgQuote:       { en: 'line {n}: unclosed quote', zh: '第 {n} 行:引号没闭合' },
  eCfgUnit:        { en: 'lines', zh: '行' },
  eCfgDraft:       { en: 'draft, not previewed yet', zh: '草稿,尚未预览' },
  eBack:           { en: 'back', zh: '返回' },
  eClose:          { en: 'close', zh: '关闭' },
  eCfgAskTitle:    { en: 'unsaved edits — apply as a preview, or restore the original?', zh: '有未预览的修改——应用为预览,还是恢复原文?' },
  eCfgAskApply:    { en: 'apply', zh: '应用' },
  eCfgAskDiscard:  { en: 'restore & back', zh: '恢复原文并返回' },
  eCfgAskResume:   { en: 'keep editing', zh: '继续编辑' },
  eDisable:        { en: '⏻ disable entry', zh: '⏻ 停用条目' },
  eEnable:         { en: '⏻ enable entry', zh: '⏻ 启用条目' },
  eEditCfg:        { en: '✎ edit config', zh: '✎ 编辑配置' },
  eRuntime:        { en: 'runtime-mounted — this plugin was attached while running (e.g. an agent session\'s own mount), not by the boot composition, so it has no entry row to toggle or edit here', zh: '运行时挂载——这个插件是运行中被动态挂上的(比如 agent 会话自己的挂载),不是启动配置装的;配置清单里没有它的条目行,所以这里无从停用、也无从改配置' },
  eMachinery:      { en: 'host machinery — mounted directly by the dsh boot itself (the include engine, hot reload, platform-native pieces like this), outside the editable config layers, so there is no entry row to toggle or edit here', zh: '宿主机制——由 dsh 启动过程直接挂载(装载引擎、热重载、平台原生组件这类),不在可编辑的配置层里,没有可停用或编辑的条目行' },
  eOrigin:         { en: 'layer', zh: '来源层' },
  eOriginManaged:  { en: 'layer {l} · schematic-managed', zh: '来源层 {l} · schematic 托管' },
  eProtected:      { en: 'protected: {r}', zh: '受保护:{r}' },
  wrSelf:          { en: 'the editor itself', zh: '编辑器本体' },
  wrHot:           { en: 'hot-reload machinery', zh: '热重载机制' },
  wrPage:          { en: 'the server this page rides on', zh: '本页面的服务器' },
  wrSpa:           { en: 'SPA boot roster', zh: 'SPA 启动名单' },
  wrSecrets:       { en: 'settings/credentials plumbing', zh: '设置/凭据管线' },
  wrDura:          { en: 'session durability chain', zh: '会话持久化链' },
  wrMany:          { en: 'many dependents', zh: '多方依赖' },
  eSwapTitle:      { en: 'swap provider', zh: '换提供方' },
  eSwapCurrent:    { en: 'current', zh: '当前' },
  eAltInTree:      { en: 'in tree', zh: '已在树中' },
  eAltInTreeOff:   { en: 'in tree · disabled', zh: '已在树中 · 已停用' },
  eAltInstalled:   { en: 'installed', zh: '已安装' },
  eAltCatalog:     { en: 'not installed', zh: '未安装' },
  eSwapTo:         { en: 'swap to this', zh: '换到这个' },
  eInstallCmd:     { en: 'install first:', zh: '先安装:' },
  eCopy:           { en: 'copy', zh: '复制' },
  eCopied:         { en: 'copied', zh: '已复制' },
  eGhostLegend:    { en: 'dashed = pending addition · struck = pending removal', zh: '虚线 = 待新增 · 删除线 = 待移除' },
  eUnavailable:    { en: 'composition editing unavailable (host plugin older than the page?)', zh: '组合编辑不可用(宿主插件比页面旧?)' },
  // v0.3.2 recovery affordances: everything routes through queueEnable, which
  // never flips edit mode itself — the page stays a pure observer until ✎
  eEditFirst:      { en: 'press ✎ to turn on edit mode first — the page stays a pure observer, so nothing is queued', zh: '先按 ✎ 开启编辑模式——页面默认纯旁观,不会排队任何操作' },
  rowEnableHint:   { en: 'enable this entry again — queues a preview; nothing is written until Apply', zh: '重新启用该条目——只排队预览,按「应用」前不会写入' },
  rowGone:         { en: 'entry {id} is no longer in the composed tree — nothing to enable here', zh: '条目 {id} 已不在组合树中——这里没有可启用的行' },
  eDisabledChip:   { en: 'disabled', zh: '已停用' },
  eDisabledTitle:  { en: 'every entry disabled in the composed tree (edit mode) — click to list them', zh: '组合树中所有已停用的条目(编辑模式)——点击列出' },
  eDisabledList:   { en: 'disabled entries · {n}', zh: '已停用条目 · {n}' },
  eDisabledEmpty:  { en: 'no disabled entries in the composed tree', zh: '组合树中没有已停用的条目' },
  eDisabledHint:   { en: 'these rows exist in the composed tree but are not mounted — their provides/inject are unknown until they are', zh: '这些行在组合树中但未挂载——挂载前 provides/inject 未知' },
  eEnableBtn:      { en: '⏻ enable', zh: '⏻ 启用' },
  pkRecover:       { en: 'recovery', zh: '恢复' },
  pkEnableEntry:   { en: 're-enable {l}', zh: '重新启用 {l}' },
  pkEnableAlt:     { en: 'enable {p}', zh: '启用 {p}' },
  pkFromRing:      { en: 'from a recent topology row', zh: '来自最近一条拓扑行' },
  pkNone:          { en: 'no recovery is known from here — the ✎ disabled list covers every disabled entry', zh: '这里无从恢复——✎ 的「已停用」列表列出了全部已停用条目' },
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
.sch aside .keys code, .sch aside .keys .ext, .sch aside .keys .unres {
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px;
}
.sch aside .keys .ext { border-style: dashed; color: var(--ink-3); }
.sch aside .keys .unres { border-style: dashed; color: var(--s8); border-color: var(--s8); }
.sch aside .empty { color: var(--ink-3); }
.sch aside .desc { font-size: 12px; color: var(--ink-2); margin: 0 0 10px; }
.sch aside .members { display: flex; flex-direction: column; gap: 7px; margin: 4px 0 10px; }
.sch aside .m b { font-size: 12px; font-weight: 600; display: block; word-break: break-all; }
.sch aside .m span { font-size: 11.5px; color: var(--ink-2); }
.sch aside .open-btn { margin-top: 2px; font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--surface-1); color: var(--ink-1); cursor: pointer; }
.sch aside .ask-btn { display: block; margin-top: 10px; font: inherit; font-size: 12px; padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--surface-1); color: var(--ink-1); cursor: pointer; }
.sch aside .btns { display: flex; gap: 6px; margin-top: 2px; }
.sch .node .xp { opacity: 0; transition: opacity .12s; cursor: pointer; }
.sch .node:hover .xp { opacity: 1; }
.sch .node .xp circle { fill: var(--page); stroke: var(--c); stroke-width: 1.5; }
.sch .node .xp text { fill: var(--c); font-size: 11px; text-anchor: middle; font-weight: 700; pointer-events: none; }
.sch .node .xp:hover circle { fill: var(--c); }
.sch .node .xp:hover text { fill: var(--page); }
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
.sch .node.ext.unres rect { stroke: var(--s8); stroke-width: 1.6; }
.sch .node.ext.unres text { fill: var(--s8); }
.sch .edge { fill: none; stroke: var(--c); stroke-opacity: 0.34; stroke-width: 1.5; marker-end: url(#sch-arrow); }
.sch .edgeHit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; cursor: pointer; }
.sch .dim { opacity: 0.16; }
.sch .edge.on { stroke-opacity: 0.95; stroke-width: 2.2; }
.sch .tabs { display: flex; gap: 4px; }
.sch .tabs button { padding: 3px 10px; }
.sch[data-tab="journey"] .filters { display: none; }
.sch:not([data-tab="domains"]) .expBtn { display: none; }
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
.sch .actList .actDiv { color: var(--ink-3); font-size: 10.5px; text-align: center; margin: 4px 0 2px; letter-spacing: 0.04em; }
.sch .actList .actTail { color: var(--ink-3); font-size: 11px; text-align: center; padding: 2px 0; }
.sch .actList .actTail.err { color: var(--s8); }
.sch .actList .actMore { align-self: center; margin: 2px 0; font-size: 11px; color: var(--ink-2); background: none; border: 1px solid var(--border); border-radius: 6px; padding: 1px 10px; cursor: pointer; }
.sch .actList .actMore:hover { color: var(--ink-1); border-color: var(--ink-3); }
.sch .actList .actStRow { display: grid; grid-template-columns: minmax(0, 1.7fr) repeat(6, minmax(0, 1fr)); gap: 4px; align-items: center; font-size: 11px; padding: 1px 6px; color: var(--ink-2); }
.sch .actList .actStRow.hd { color: var(--ink-3); font-size: 10px; border-bottom: 1px solid var(--border); margin-bottom: 2px; }
.sch .actList .actStRow span:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
.sch .actList .actStRow .er { color: var(--s8); }
.sch .actList .actStRow .nw { color: var(--ink-1); font-weight: 600; }
.sch .actList .actStRow .md.un { opacity: 0.55; }
/* composition edit (v0.3) */
.sch .editBtn { font-size: 14px; line-height: 1; padding: 3px 9px; border-radius: 7px; border: 1px solid var(--border); background: none; color: var(--ink-2); cursor: pointer; }
.sch .editBtn[aria-pressed="true"] { color: var(--ink-1); border-color: var(--ink-2); background: color-mix(in oklab, var(--ink-1) 8%, transparent); }
.sch .editBanner { display: none; }
.sch .editBanner.on { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 5px 14px; font-size: 12px; color: var(--ink-1); background: color-mix(in oklab, var(--s8) 10%, var(--surface-1)); border-bottom: 1px solid var(--border); }
.sch .editBanner .ebRollback { font-size: 11.5px; border: 1px solid var(--ink-3); background: none; color: var(--ink-1); border-radius: 6px; padding: 2px 9px; cursor: pointer; }
.sch .editSec { border-top: 1px dashed var(--border); margin-top: 10px; padding-top: 8px; }
.sch .editSec .editMeta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--ink-3); margin-bottom: 6px; }
.sch .editSec .rtNote { font-size: 11px; line-height: 1.6; color: var(--ink-3); padding: 6px 9px; border: 1px dashed var(--border); border-radius: 8px; background: color-mix(in oklab, var(--page) 92%, var(--ink-3)); }
.sch .editSec .protBadge { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--ink-3); }
.sch .editSec .protBadge.danger { color: var(--s8); border-color: color-mix(in oklab, var(--s8) 40%, transparent); background: color-mix(in oklab, var(--s8) 7%, transparent); }
.sch .editSec .protBadge.warn { color: var(--ink-2); }
.sch .editSec .btns { display: flex; gap: 6px; flex-wrap: wrap; }
.sch .editSec button, .sch .editDrawer .dbtns button { font-size: 11.5px; border: 1px solid var(--border); background: none; color: var(--ink-1); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
.sch .editSec button:hover, .sch .editDrawer .dbtns button:hover:not(:disabled) { border-color: var(--ink-3); }
.sch .editSec .swapSec h4 { margin: 0 0 4px; font-size: 11.5px; color: var(--ink-2); }
.sch .editSec .swapCur { font-size: 11.5px; color: var(--ink-2); margin-bottom: 4px; }
.sch .editSec .swapRow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 3px 0; font-size: 11.5px; }
.sch .editSec .swapRow .pkg { font-size: 10.5px; color: var(--ink-2); }
.sch .editSec .badge { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--ink-3); white-space: nowrap; }
.sch .editSec .badge.cur { color: var(--ink-1); border-color: var(--ink-3); }
.sch .editSec .badge.installed { color: var(--s3); border-color: var(--s3); }
.sch .editSec .badge.catalog { color: var(--ink-3); border-style: dashed; }
.sch .editSec .eb-copy { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.sch .editScrim { display: none; }
.sch .editScrim.on { display: block; position: fixed; inset: 0; z-index: 40; background: transparent; pointer-events: none; }
.sch .editDrawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(540px, 94vw); z-index: 41; background: var(--surface-1); color: var(--ink-1); border-left: 1px solid var(--border); box-shadow: -12px 0 32px #0002; transform: translateX(102%); transition: transform .18s ease; padding: 14px 16px; overflow-y: auto; font-size: 12.5px; }
.sch .editDrawer.on { transform: none; }
.sch .editDrawer h3 { margin: 0 0 8px; font-size: 13.5px; padding-right: 30px; }
.sch .editDrawer .dClose { position: absolute; top: 10px; right: 12px; width: 24px; height: 24px; line-height: 1; font-size: 12px; border: 1px solid var(--border); background: none; color: var(--ink-3); border-radius: 6px; cursor: pointer; }
.sch .editDrawer .dClose:hover { color: var(--ink-1); border-color: var(--ink-3); }
.sch .editDrawer h4 { margin: 12px 0 4px; font-size: 11.5px; color: var(--ink-3); text-transform: none; }
.sch .editDrawer .hint { color: var(--ink-3); font-size: 11.5px; margin: 4px 0; }
.sch .editDrawer .dRows { list-style: none; margin: 4px 0; padding: 0; }
.sch .editDrawer .dRow { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; border-bottom: 1px dashed var(--border); }
.sch .editDrawer .dRow.removed b { text-decoration: line-through; color: var(--ink-3); }
.sch .editDrawer .dRow.added b { color: var(--s3); }
.sch .editDrawer .dRow span { color: var(--ink-3); font-size: 11px; text-align: right; }
.sch .editDrawer .warnList { list-style: none; margin: 6px 0; padding: 0; }
.sch .editDrawer .warnItem { padding: 5px 8px; margin: 4px 0; border-left: 3px solid var(--ink-3); background: color-mix(in oklab, var(--ink-3) 6%, transparent); font-size: 11.5px; line-height: 1.45; }
.sch .editDrawer .warnItem.warn { border-left-color: var(--s8); }
.sch .editDrawer .warnItem.danger { border-left-color: var(--s8); background: color-mix(in oklab, var(--s8) 7%, transparent); }
.sch .editDrawer .confirmLbl { display: block; margin: 6px 0 3px; color: var(--s8); font-size: 11.5px; }
.sch .editDrawer .confirmIn { width: 100%; box-sizing: border-box; padding: 4px 8px; border: 1px solid color-mix(in oklab, var(--s8) 40%, transparent); border-radius: 6px; background: none; color: var(--ink-1); font-size: 12px; }
.sch .editDrawer .yamlDiff { margin: 2px 0; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; overflow-x: auto; font-size: 11px; line-height: 1.5; white-space: pre; }
.sch .editDrawer .yamlDiff .l { display: block; }
.sch .editDrawer .yamlDiff .l.- { color: var(--s8); background: color-mix(in oklab, var(--s8) 8%, transparent); }
.sch .editDrawer .yamlDiff .l.+ { color: var(--s3); background: color-mix(in oklab, var(--s3) 8%, transparent); }
.sch .editDrawer .cfgEd { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
.sch .editDrawer .cfgKeys { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.sch .editDrawer .cfgKeysLbl { font-size: 10.5px; color: var(--ink-3); margin-right: 2px; }
.sch .editDrawer .kChip { font: 10.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 7px; border-radius: 99px; border: 1px solid var(--border); color: var(--ink-2); background: color-mix(in srgb, var(--surface-1) 70%, transparent); }
.sch .editDrawer .kChip.drop { text-decoration: line-through; color: var(--s8); border-color: color-mix(in srgb, var(--s8) 45%, transparent); }
.sch .editDrawer .yEd { display: flex; border: 1px solid var(--border); border-radius: 8px; background: color-mix(in srgb, var(--surface-1) 55%, var(--page)); overflow: hidden; }
.sch .editDrawer .yEd:focus-within { border-color: color-mix(in srgb, var(--s1) 55%, transparent); }
.sch .editDrawer .yEd.bad { border-color: var(--s8); }
.sch .editDrawer .yGutter { flex: none; overflow: hidden; padding: 8px 6px 8px 0; margin-left: 8px; text-align: right; white-space: pre; font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink-3); border-right: 1px solid var(--border); user-select: none; }
.sch .editDrawer .yWrap { position: relative; flex: 1; min-width: 0; height: 46vh; }
.sch .editDrawer .yHl, .sch .editDrawer .ySrc { position: absolute; inset: 0; margin: 0; padding: 8px 10px; font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; border: none; box-sizing: border-box; }
.sch .editDrawer .yHl { overflow: hidden; pointer-events: none; }
.sch .editDrawer .yHl code { display: block; }
.sch .editDrawer .ySrc { color: transparent; caret-color: var(--ink-1); background: transparent; resize: none; outline: none; overflow: auto; }
.sch .editDrawer .ySrc::selection { background: color-mix(in srgb, var(--s1) 30%, transparent); }
.sch .editDrawer .tc { color: var(--ink-3); font-style: italic; }
.sch .editDrawer .tk { color: var(--s1); font-weight: 600; }
.sch .editDrawer .ts { color: var(--s3); }
.sch .editDrawer .tn { color: var(--s7); }
.sch .editDrawer .tb { color: var(--s7); font-weight: 600; }
.sch .editDrawer .tj { color: var(--s4); font-weight: 700; }
.sch .editDrawer .tje { color: var(--s4); opacity: 0.85; }
.sch .editDrawer .tp { color: var(--ink-1); }
.sch .editDrawer .cfgFoot { display: flex; align-items: center; gap: 8px; }
.sch .editDrawer .yMsg { flex: 1; font-size: 10.5px; color: var(--ink-3); }
.sch .editDrawer .yMsg.bad { color: var(--s8); }
.sch .editDrawer .yReset { font-size: 10.5px; padding: 3px 9px; border-radius: 99px; border: 1px solid var(--border); background: none; color: var(--ink-2); cursor: pointer; }
.sch .editDrawer .yReset:hover { border-color: var(--baseline); color: var(--ink-1); }
.sch .editDrawer .askBar { display: flex; flex-direction: column; gap: 7px; margin: 2px 0 8px; padding: 9px 11px; border: 1px solid color-mix(in srgb, var(--s4) 55%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--s4) 8%, var(--surface-1)); }
.sch .editDrawer .askMsg { font-size: 11.5px; color: var(--ink-1); }
.sch .editDrawer .askBtns { display: flex; gap: 6px; flex-wrap: wrap; }
.sch .editDrawer .dbtns { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.sch .editDrawer .dPrimary { border-color: var(--ink-2) !important; font-weight: 600; }
.sch .editDrawer .dPrimary:disabled { opacity: 0.45; cursor: not-allowed; }
.sch .editDrawer .dGhost { color: var(--ink-3) !important; }
.sch .graph .node.ghostRem { opacity: 0.38; }
.sch .graph .node.ghostRem rect { stroke-dasharray: 3 3; }
.sch .graph .node.ghostRem text { text-decoration: line-through; opacity: 0.7; }
.sch .graph .node.ghostAdd rect { fill: none; stroke: var(--ink-2); stroke-dasharray: 4 4; }
.sch .graph .node.ghostAdd text { fill: var(--ink-2); font-size: 10px; }
/* v0.3.2 recovery: actionable topo rows, clickable unresolved keys, popover */
.sch .actRow[data-entry] { cursor: pointer; }
.sch .actRow[data-entry]:hover .tx { color: var(--ink-1); }
.sch .actRow .rec { color: var(--s3); flex: 0 0 auto; }
.sch .graph .node.ext.unres { cursor: pointer; }
.sch aside .keys .unres.pk { cursor: pointer; }
.sch aside .keys .unres.pk:hover { text-decoration: underline; }
.sch .schPop { position: fixed; z-index: 30; display: none; max-width: 360px;
  background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px;
  padding: 9px 11px; box-shadow: 0 6px 18px rgba(0,0,0,0.16); font-size: 12px; }
.sch .schPop.on { display: block; }
.sch .schPop .t { font: 12px ui-monospace, Menlo, monospace; font-weight: 650; word-break: break-all; }
.sch .schPop .d { color: var(--ink-2); margin: 3px 0; }
.sch .schPop .k { color: var(--ink-3); font: 11px ui-monospace, Menlo, monospace; word-break: break-all; }
.sch .schPop h4 { margin: 8px 0 3px; font-size: 11px; color: var(--ink-3); }
.sch .schPop .pkRow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 3px 0; }
.sch .schPop button { font-size: 11.5px; border: 1px solid var(--border); background: none;
  color: var(--ink-1); border-radius: 6px; padding: 2px 9px; cursor: pointer; }
.sch .schPop button:hover { border-color: var(--ink-3); }
.sch .schPop .pkRow .badge { font-size: 10px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--ink-3); white-space: nowrap; }
.sch .editDrawer .dRow.dis { align-items: center; }
.sch .editDrawer .dRow.dis .badge { font-size: 10px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--ink-3); white-space: nowrap; }
.sch .editDrawer .dRow.dis button { font-size: 11.5px; border: 1px solid var(--border); background: none;
  color: var(--ink-1); border-radius: 6px; padding: 2px 9px; cursor: pointer; }
.sch .editDrawer .dRow.dis button:hover { border-color: var(--ink-3); }
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
  <select class="sessSel" title="${t('sessSelTitle')}"></select>
  <input type="search" class="search" placeholder="${t('searchPh')}">
  <button class="editBtn" aria-pressed="false" title="${t('editTitle')}">✎</button>
  <button class="langToggle" title="${t('langTitle')}">中</button>
  <button class="themeToggle">◐</button>
</header>
<div class="editBanner"></div>
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
    <button class="chip subBtn" aria-pressed="false" title="${t('actSubTitle')}">${t('actSub')}</button>
    <button class="chip svcBtn" aria-pressed="true" title="${t('actSvcTitle')}">${t('actSvc')}</button>
    <button class="chip repBtn" aria-pressed="false" title="${t('actRepTitle')}">${t('actRep')}</button>
    <button class="chip statBtn" aria-pressed="false" title="${t('actStatsTitle')}">${t('actStats')}</button>
    <span class="legend">${t('actLiveHint')}</span>
    <button class="actFold" aria-pressed="true">▾</button>
  </div>
  <div class="actList"></div>
</div>
<footer>
  <span class="meta"></span>
  <span class="spacer" style="flex:1"></span>
  <button class="zoomOut">−</button><button class="zoomIn">+</button><button class="zoomFit">${t('fit')}</button><button class="expBtn" aria-pressed="false" title="${t('expAllTitle')}">${t('expandAll')}</button>
  <button class="autoBtn" aria-pressed="true" title="${t('autoTitle')}">⏸</button>
  <button class="refresh" title="${t('refreshTitle')}">⟳</button>
</footer>
<div class="toast"></div>
<div class="tooltip"></div>
<div class="schPop"></div>
<div class="editScrim"></div>
<aside class="editDrawer"></aside>`
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
    window.clearInterval(statTimer)
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
    /** Overview group cards dissolved into member pills (unit ids). */
    expanded: new Set<string>(),
    tab: bootTab,
  }
  container.querySelectorAll<HTMLElement>('.tabBtn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === state.tab)))
  /** Node ids that appeared in the latest auto-refresh; they pulse once. */
  const freshIds = new Set<string>()
  /** Every scatterable group id in the latest overview layout, carded or dissolved (expand-all's target list and its all/none test). */
  let lastExpandable: string[] = []
  /** ?expand=all deep link: expand every scatterable group on the first overview layout that names any. */
  let pendingExpandAll = new URLSearchParams(location.search).get('expand') === 'all'
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
   * The scope target for a cluster id, a family card id (fam:<group>), or the
   * core-spine card ('spine'): families and the spine synthesize the cluster
   * shape from their unclustered members, so all three open into the same
   * scope view.
   */
  const scopeTarget = (id: string): any | undefined => {
    if (clusterById.has(id)) return clusterById.get(id)
    if (GRAPH === null) return undefined
    const members = id === 'spine'
      ? GRAPH.nodes.filter((n: any) => !n.cluster && n.spine)
      : id.startsWith('fam:')
        ? GRAPH.nodes.filter((n: any) => !n.cluster && n.group === id.slice(4))
        : []
    if (members.length === 0) return undefined
    const catCount = new Map<string, number>()
    for (const n of members) catCount.set(n.category, (catCount.get(n.category) ?? 0) + 1)
    const cat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return { id, label: id === 'spine' ? 'core' : id.slice(4), category: cat, members: members.map((n: any) => n.id), seamKeys: [] }
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

  /**
   * Radial placement for the domains overview: units are ranked by unit-level
   * edge count and packed outward from the center — the most-linked unit sits
   * in the middle, each next unit continues along the current elliptical row
   * until its pill no longer fits the perimeter, then the row moves out one
   * pitch. There are no dedicated layers: radial position tracks link count
   * directly, and small pitch steps keep the disc compact. Rows are ellipses
   * instead of circles, so the fit-scaled mesh fills a wide canvas instead of
   * letterboxing a circle; aspect 1 is the plain circle. Slots are measured
   * in arc length (the ellipse's parameter speed varies around it), and the
   * walk may stop mid-row. The axis ratio is bisected for fit balance — the
   * point where fit()'s two scale terms cross — which is the widest mesh the
   * canvas shows without letterboxing; row jumps make the crossing fuzzy, so
   * every walked candidate keeps the crown on the largest fit scale. Fully
   * deterministic (degree desc, then label).
   * @param units - the overview units (clusters, families, lone pills).
   * @param edges - aggregated unit→unit edges (drives the degree ranking).
   * @param x0 - left edge of the mesh area (right of the ext-key column).
   * @param aspect - axis-ratio seed for the bisection (near the canvas's).
   */
  function placeRadial(units: any[], edges: any[], x0: number, aspect = 1) {
    const deg = new Map<string, number>(units.map((u) => [u.id, 0]))
    for (const e of edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1)
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1)
    }
    const ranked = [...units].sort((a: any, b: any): number =>
      (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || a.label.localeCompare(b.label))

    // walk the ranking outward: claim the next arc slot on the current row,
    // skip slots whose pill would touch an already-placed one (ellipse rows
    // collide diagonally on the disc's east/west flanks), start a new row one
    // pitch out when the current one wraps
    const GAPX = 26
    const ROW_PITCH = H + 34
    const walk = (asp: number): Map<string, { x: number; y: number; w: number }> => {
      const pos = new Map<string, { x: number; y: number; w: number }>()
      const clear = (x: number, y: number, w: number): boolean => {
        for (const p of pos.values()) {
          if (x < p.x + p.w + 10 && p.x < x + w + 10 && y < p.y + H + 10 && p.y < y + H + 10) return false
        }
        return true
      }
      let rx = 0
      let ry = 0
      let phi = 0
      for (const u of ranked) {
        const w = pillW(u.label)
        if (pos.size === 0) {
          pos.set(u.id, { x: -w / 2, y: -H / 2, w })
          ry = w / 2 + H / 2 + 40
          rx = ry * asp
          continue
        }
        for (;;) {
          const a = -Math.PI / 2 + phi
          const speed = Math.hypot(rx * Math.sin(a), ry * Math.cos(a)) || 1
          const th = (w + GAPX) / speed
          if (phi + th > 2 * Math.PI) {
            ry += ROW_PITCH
            rx = ry * asp
            phi = 0
            continue
          }
          const mid = -Math.PI / 2 + phi + th / 2
          const x = Math.round(rx * Math.cos(mid) - w / 2)
          const y = Math.round(ry * Math.sin(mid) - H / 2)
          if (!clear(x, y, w)) {
            phi += th
            continue
          }
          pos.set(u.id, { x, y, w })
          phi += th
          break
        }
      }
      return pos
    }
    // Candidate evaluation mirrors fit() exactly: the scale the canvas gives
    // each axis (w/h include the west x0, east 24, north 40, south 24 pads the
    // shift below adds; fit tacks on its own 48/24). kx falls and ky rises as
    // the ellipse widens, so the fit scale — min(kx, ky, 1) — peaks where they
    // cross: that crossing is the widest disc the canvas shows without
    // letterboxing. Bisect toward it; row jumps make the crossing fuzzy, so
    // every walked candidate keeps the crown on the largest fit scale.
    const fitTerms = (pos: Map<string, { x: number; y: number; w: number }>): { kx: number; ky: number } => {
      if (pos.size === 0) return { kx: 1, ky: 1 }
      let minX = 0, maxX = Number.NEGATIVE_INFINITY, minY = 0, maxY = Number.NEGATIVE_INFINITY
      for (const p of pos.values()) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w)
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + H)
      }
      const w = maxX - minX + x0 + 24
      const h = maxY - minY + H + 64
      return { kx: svg.clientWidth / (w + 48), ky: svg.clientHeight / (h + 24) }
    }
    const walkAt = (a: number): { pos: Map<string, { x: number; y: number; w: number }>; k: number; kx: number; ky: number } => {
      const pos = walk(a)
      const { kx, ky } = fitTerms(pos)
      return { pos, k: Math.min(kx, ky, 1), kx, ky }
    }
    let best = walkAt(aspect)
    let lo = 0.25
    let hi = 16
    for (let i = 0; i < 10 && best.pos.size > 0; i++) {
      const mid = (lo + hi) / 2
      const cand = walkAt(mid)
      if (cand.k > best.k) best = cand
      // steer by the mid candidate's own terms: width-limited → narrow,
      // height-limited → widen
      if (cand.kx < cand.ky) hi = mid
      else lo = mid
    }

    // shift the centered mesh into absolute space, clear of the ext column
    const pos = best.pos
    if (pos.size === 0) return { pos, width: x0 + 24, height: 80 }
    const all = [...pos.values()]
    const minX = Math.min(0, ...all.map((p) => p.x))
    const minY = Math.min(0, ...all.map((p) => p.y))
    const dx = x0 - minX, dy = 40 - minY
    for (const p of pos.values()) { p.x += dx; p.y += dy }
    const width = Math.max(...all.map((p) => p.x + p.w)) + 24
    const height = Math.max(...all.map((p) => p.y + H)) + 24
    return { pos, width, height }
  }

  function layoutOverview() {
    const units: any[] = []
    // every group that can scatter in this render, carded or already dissolved —
    // the footer chip's all/none test needs scattered groups listed too
    const expandable: string[] = []
    // node id → the unit representing it in this layout (its own pill id when
    // the group is expanded into the mesh); node id → its group card id
    // (which card a scattered pill collapses back into)
    const nodeUnit = new Map<string, string>()
    const nodeGroup = new Map<string, string>()
    const pushNode = (n: any): void => {
      units.push({ id: n.id, label: nodeLabel(n), cat: n.category, rank: n.rank, kind: 'node', node: n })
      nodeUnit.set(n.id, n.id)
    }
    const pushCard = (u: any, members: any[]): void => {
      units.push(u)
      for (const m of members) nodeUnit.set(m.id, u.id)
    }
    const memberShown = (n: any): boolean => originOk(n) && matchNode(n)
    // Unclustered nodes: the core-spine packages form one card; ≥2 sharing a
    // package family collapse into one family card (llm ×4 …); everything the
    // graph cannot categorize (group 'other') and true singles stay lone
    // pills — a misc bucket would fake a hub out of unrelated packages.
    // state.expanded dissolves a card into member pills packed into the mesh.
    const byFam = new Map<string, any[]>()
    for (const n of GRAPH.nodes) {
      if (!n.cluster && !n.spine) {
        if (!byFam.has(n.group)) byFam.set(n.group, [])
        byFam.get(n.group)!.push(n)
      }
    }
    const spineList = GRAPH.nodes.filter((n: any) => !n.cluster && n.spine)
    if (spineList.some(memberShown)) {
      expandable.push('spine')
      const shown = spineList.filter(memberShown)
      for (const n of shown) nodeGroup.set(n.id, 'spine')
      if (state.expanded.has('spine')) shown.forEach(pushNode)
      else pushCard({
        id: 'spine', label: `core · ${spineList.length}`, cat: 'core-spine',
        rank: Math.min(...spineList.map((n: any) => n.rank)), kind: 'family', family: { members: spineList },
      }, spineList)
    }
    for (const [fam, list] of byFam) {
      if (list.length < 2 || fam === 'other') {
        for (const n of list) if (visibleNode(n)) pushNode(n)
        continue
      }
      const shown = list.filter(memberShown)
      if (shown.length === 0) continue
      expandable.push('fam:' + fam)
      for (const n of shown) nodeGroup.set(n.id, 'fam:' + fam)
      if (state.expanded.has('fam:' + fam)) { shown.forEach(pushNode); continue }
      const catCount = new Map<string, number>()
      for (const n of list) catCount.set(n.category, (catCount.get(n.category) ?? 0) + 1)
      const cat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
      pushCard({
        id: 'fam:' + fam, label: `${fam} · ${list.length}`, cat, rank: Math.min(...list.map((n: any) => n.rank)),
        kind: 'family', family: { members: list },
      }, list)
    }
    for (const c of GRAPH.clusters) {
      const catOk = state.cats.has(c.category) || (c.category === 'other' && state.other)
      if (!catOk) continue
      const members = c.members.map((m: string) => byId.get(m))
      const labelHit = state.q && c.label.toLowerCase().includes(state.q)
      const shown = members.filter(memberShown)
      if (!(shown.length > 0 || labelHit)) continue
      for (const n of shown) nodeGroup.set(n.id, c.id)
      if (shown.length > 0) expandable.push(c.id)
      if (state.expanded.has(c.id) && shown.length > 0) { shown.forEach(pushNode); continue }
      const rank = Math.round(members.reduce((s: number, m: any) => s + m.rank, 0) / members.length)
      pushCard({ id: c.id, label: `${c.label} · ${c.members.length}`, cat: c.category, rank, kind: 'cluster', cluster: c }, members)
    }
    lastExpandable = expandable
    const injectedByShown = new Set(
      GRAPH.nodes.filter((n: any) => nodeUnit.has(n.id)).flatMap((n: any) => n.inject))
    const extList = state.ext ? [...GRAPH.hostKeys, ...GRAPH.unresolvedKeys].filter((k: string) => injectedByShown.has(k)) : []
    const extW = extList.length ? Math.max(...extList.map((k: string) => k.length * 6.6 + 38)) : 0
    // the overview body is a radial mesh: link count decides centrality
    // (placeUnits stays for the scope view). placeRadial bisects the ellipse
    // axis ratio for the canvas's fit balance — the seed here just starts the
    // search near the answer.
    const unitEdges = overviewEdges({ units, nodeUnit })
    const x0 = 24 + (extList.length ? extW + COLGAP : 0)
    const aspect = svg.clientWidth > 0 && svg.clientHeight > 0
      ? Math.min(4, Math.max(0.5, (svg.clientWidth - x0) / svg.clientHeight))
      : 1
    const { pos, width, height } = placeRadial(units, unitEdges, x0, aspect)
    extList.forEach((k: string, i: number) => pos.set('ext:' + k, { x: 24, y: 40 + i * PITCH, w: k.length * 6.6 + 38 }))
    return { units, extList, pos, height: Math.max(80, height), width: Math.max(width, 24 + extW), nodeUnit, nodeGroup }
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
    const extList: string[] = state.ext
      ? [...new Set(members.flatMap((n: any) => n.inject.filter((k: string) => !keyOwners.has(k))))].sort()
        .map(String)
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
    const agg = new Map()
    for (const e of GRAPH.edges) {
      // nodeUnit already knows each endpoint's unit — its group card, or its
      // own pill when that group is expanded into the mesh
      const ua = L.nodeUnit.get(e.from), ub = L.nodeUnit.get(e.to)
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
        if ((fs === sid && ts !== undefined && FLOW.includes(ts)) || (ts === sid && fs !== undefined && FLOW.includes(fs))) {
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
   * with no scrollbars and spans its full width — pills re-wrap at the scaled
   * width instead of letterboxing a fixed-width block. `scale()` alone cannot
   * create scrollable extent — layout size is transform-independent — so the
   * solved layout size also drives the `.jrZoom` wrapper's explicit
   * width/height; that wrapper is what `.jr` scrolls when `journeyZoom` > 1
   * magnifies the block past the viewport. `reset` re-solves against the live
   * viewport (render, viewport change at fit); zoom buttons reuse the cached
   * size so wrapping stays stable while reading.
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
      // would otherwise cap the layout at the previous pass's scale
      zoom.style.width = ''
      zoom.style.height = ''
      zoom.style.marginLeft = ''
      zoom.style.marginTop = ''
      fit.style.transform = ''
      fit.style.width = ''
      // The block height depends on its own width (pills wrap inside the
      // flex-grown cards), so filling the canvas means solving for the scale:
      // layout at (cw-2)/k must stand k-times shorter than the viewport.
      // k*H(cw/k) is monotone rising in k, so binary-search between the plain
      // height-fit floor (always feasible: wider layout is never taller) and 1.
      const availW = cw - 2
      const availH = ch - 2
      let lo = Math.min(1, availH / Math.max(1, fit.offsetHeight))
      let hi = 1
      for (let i = 0; i < 9 && hi - lo > 0.002; i++) {
        const mid = (lo + hi) / 2
        fit.style.width = `${availW / mid}px`
        if (mid * fit.offsetHeight <= availH) lo = mid
        else hi = mid
      }
      fit.style.width = `${availW / lo}px`
      journeyNat = { w: availW / lo, h: fit.offsetHeight }
    }
    const { w, h } = journeyNat
    const base = Math.min(1, (cw - 2) / Math.max(1, w), (ch - 2) / Math.max(1, h))
    const k = base * journeyZoom
    zoom.style.width = `${w * k}px`
    zoom.style.height = `${h * k}px`
    zoom.style.marginLeft = w * k >= cw ? '0px' : `${(cw - w * k) / 2}px`
    zoom.style.marginTop = h * k >= ch ? '0px' : `${(ch - h * k) / 2}px`
    fit.style.transform = `scale(${k})`
    // applying the fit can itself flip scrollbars on/off (the pre-fit layout
    // overflows), which changes the client box no ResizeObserver sees —
    // re-run once when that happened; sizes converge on the second pass
    if (jr.clientWidth !== cw || jr.clientHeight !== ch) fitJourney(reset)
  }

  /** Detail panel for an aggregated card — a family or the core spine (domains view). */
  function renderDetailFamily(unitId: string, title: string, tip: string, members: any[]): void {
    $('.detail').innerHTML = `
    <h2>${esc(title)} · ${members.length}</h2>
    <div class="dir">${tip}</div>
    <div class="members">${members.map((m: any) =>
      `<div class="m"><b>${esc(nodeLabel(m))}${m.state === 'failed' ? ' ✕' : m.state !== 'active' && m.state ? ' ⏳' : ''}</b>${descOf(m) ? `<span>${esc(descOf(m) as string)}</span>` : ''}</div>`).join('')}
    </div>
    <div class="btns">
      <button class="open-btn exp">${state.expanded.has(unitId) ? t('collapseGroup') : t('expInOverview')}</button>
      <button class="open-btn">${t('openGroup')}</button>
    </div>`
    ;(container.querySelector('.detail .open-btn.exp') as HTMLElement).onclick = () => toggleExpand(unitId)
    ;(container.querySelector('.detail .open-btn:not(.exp)') as HTMLElement).onclick = () => enterScope(unitId)
  }

  /** Tooltip + click + open for an aggregated pill — a family or the core spine. */
  function bindFamilyHover(g: Element, unitId: string, title: string, tip: string, members: any[]): void {
    g.addEventListener('mouseenter', () => {
      showTip(`<div class="t">${esc(title)} · ${members.length}</div>` +
        `<div class="d">${tip}</div>` +
        `<div class="k">${members.slice(0, 8).map((m) => nodeLabel(m)).join(', ')}${members.length > 8 ? ' …' : ''}</div>`)
    })
    g.addEventListener('mousemove', moveTip)
    g.addEventListener('mouseleave', hideTip)
    g.addEventListener('click', (ev) => {
      ev.stopPropagation()
      state.sel = unitId
      renderDetailFamily(unitId, title, tip, members)
      render()
    })
    g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); enterScope(unitId) })
  }

  /**
   * Corner ⊕ on every group card: one click dissolves the card into member
   * pills packed into the radial mesh (layoutOverview reads state.expanded;
   * the mesh re-ranks by each member's own edge count). Revealed on hover;
   * click and double-click never leak into the card's own handlers.
   */
  function addExpander(g: Element, p: any, unitId: string): void {
    const xp = el('g', { class: 'xp' }, g)
    const cx = p.x + p.w, cy = p.y
    el('circle', { cx, cy, r: '7.5' }, xp)
    el('text', { x: cx, y: cy + 3.5 }, xp).textContent = '+'
    el('title', {}, xp).textContent = t('expTip')
    xp.addEventListener('click', (ev) => { ev.stopPropagation(); toggleExpand(unitId) })
    xp.addEventListener('dblclick', (ev) => ev.stopPropagation())
  }

  /** Expand or re-card one group, then re-solve the mesh and the detail panel. */
  const toggleExpand = (unitId: string): void => {
    if (state.expanded.has(unitId)) state.expanded.delete(unitId)
    else state.expanded.add(unitId)
    updateExpBtn()
    render(true)
    refreshDetail()
  }

  // ------- render -------
  const NS = 'http://www.w3.org/2000/svg'
  const el = (name: string, attrs: Record<string, string | number>, parent?: Element): SVGElement => {
    const e = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
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

  /**
   * Scope crumb + header subtitle, in the active language. Every render
   * path must end here — the journey branch returns early and calls this
   * itself, or a language toggle on that tab leaves both in the old language.
   */
  function updateCrumb(scoped: boolean, label?: string): void {
    const crumb = $('.crumb')
    crumb.classList.toggle('on', scoped)
    crumb.textContent = t('overview')
    $('.subtitle').textContent = scoped && label !== undefined ? `/ ${label}` : t('subtitle')
  }

  function render(refit = false): void {
    if (GRAPH === null) return
    if (state.tab === 'journey') { renderJourney(); updateCrumb(false); paintActivity(); return }
    const scoped = !!state.scope
    const L: any = scoped ? layoutScope() : layoutOverview()
    lastL = L

    const edgePath = (a: any, b: any): string => {
      // anchor where the center-to-center line crosses each rect's border —
      // the overview mesh is radial, so an edge may leave in any direction
      const cross = (cx: number, cy: number, hw: number, dx: number, dy: number): [number, number] => {
        const tx = dx > 0 ? hw / dx : dx < 0 ? -hw / dx : Number.POSITIVE_INFINITY
        const ty = dy > 0 ? (H / 2) / dy : dy < 0 ? -(H / 2) / dy : Number.POSITIVE_INFINITY
        const k = Math.min(tx, ty)
        return [cx + dx * k, cy + dy * k]
      }
      const dx = (b.x + b.w / 2) - (a.x + a.w / 2)
      const dy = (b.y + H / 2) - (a.y + H / 2)
      const [x1, y1] = cross(a.x + a.w / 2, a.y + H / 2, a.w / 2, dx, dy)
      const [x2, y2] = cross(b.x + b.w / 2, b.y + H / 2, b.w / 2, -dx, -dy)
      const len = Math.hypot(dx, dy) || 1
      // stop 4px short of the target border so the arrowhead tip lands on it
      const ex = x2 - (4 * dx) / len, ey = y2 - (4 * dy) / len
      return `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`
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
        // the arrow rides the service flow: drawn provider → consumer, so the
        // marker lands on the injector (e.from), not on the dependency
        const d = edgePath(b, a)
        const p = el('path', { class: 'edge', style: c ? `--c: var(${c})` : '--c: var(--ink-3)', d }, gE)
        const hit = el('path', { class: 'edgeHit', d }, gE)
        p.setAttribute('data-from', e.from)
        p.setAttribute('data-to', e.to)
        p.setAttribute('data-keys', e.keys.join(', '))
        const fl = unitLabel(e.from), tl = unitLabel(e.to)
        hit.addEventListener('mouseenter', () => {
          p.classList.add('on')
          showTip(`<div class="t">${esc(tl)} → ${esc(fl)}</div>` +
            `<div class="d">${t('edgeUse', { a: esc(tl), b: esc(fl) })}</div>` +
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
          const unres = GRAPH.unresolvedKeys.includes(k)
          const g = el('g', { class: 'node ext' + (unres ? ' unres' : '') }, gN)
          el('rect', { x: p.x, y: p.y, width: p.w, height: H, rx: '7' }, g)
          el('text', { x: p.x + 20, y: p.y + H / 2 + 1 }, g).textContent = k
          g.addEventListener('mouseenter', () => {
            showTip(`<div class="t">⌁ ${k}</div><div class="d">${t(unres ? 'tipUnresKey' : 'tipHostKey')}</div><div class="d">${t('tipExtCount', { n: countInj(k) })}</div>`)
          })
          g.addEventListener('mousemove', moveTip)
          g.addEventListener('mouseleave', hideTip)
          // unresolved keys open the recovery popover; host keys stay
          // hover-only — a launcher-provided key has no composition remedy
          if (unres) g.addEventListener('click', (ev) => { ev.stopPropagation(); openUnresPop(k, ev) })
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
            const spine = u.id === 'spine'
            const g = drawPill(gN, u.id, L.pos.get(u.id), u.label, u.cat, 'family' + (freshIds.has(u.id) ? ' pulse' : ''), null)
            bindFamilyHover(g, u.id, spine ? 'core' : u.id.slice(4), spine ? t('spineTip') : t('familyTip'), u.family.members)
            addExpander(g, L.pos.get(u.id), u.id)
            nodeEls.set(u.id, g)
            continue
          }
          const v = (u.kind === 'cluster' ? 'cluster' : stateVariant(u.node)) + (freshIds.has(u.id) ? ' pulse' : '')
          const g = drawPill(gN, u.id, L.pos.get(u.id), u.label, u.cat, v, u.kind === 'node' ? u.node : null)
          if (u.kind === 'cluster') {
            bindClusterHover(g, u.cluster)
            addExpander(g, L.pos.get(u.id), u.id)
          }
          nodeEls.set(u.id, g)
        }
        if (L.extList.length) el('text', { class: 'zone-h', x: '24', y: '26' }, gN).textContent = t('zoneExt')
        for (const k of L.extList) {
          const p = L.pos.get('ext:' + k)
          const unres = GRAPH.unresolvedKeys.includes(k)
          const g = el('g', { class: 'node ext' + (unres ? ' unres' : '') }, gN)
          el('rect', { x: p.x, y: p.y, width: p.w, height: H, rx: '7' }, g)
          el('text', { x: p.x + 20, y: p.y + H / 2 + 1 }, g).textContent = k
          g.addEventListener('mouseenter', () => showTip(`<div class="t">⌁ ${k}</div><div class="d">${t(unres ? 'tipUnresKey' : 'tipHostKey')}</div><div class="d">${t('tipExtCount', { n: countInj(k) })}</div>`))
          g.addEventListener('mousemove', moveTip)
          g.addEventListener('mouseleave', hideTip)
          if (unres) g.addEventListener('click', (ev) => { ev.stopPropagation(); openUnresPop(k, ev) })
        }
        const failed = GRAPH.nodes.filter((n: any) => n.state === 'failed').length
        $('.stats').textContent =
          t('stats', { m: GRAPH.nodes.length, s: L.units.length, e: unitEdges.length })
          + (failed ? t('statsFailed', { f: failed }) : '')
          + (GRAPH.unresolvedKeys.length ? t('statsUnres', { n: GRAPH.unresolvedKeys.length }) : '')
      }

      svg.setAttribute('height', String(svg.clientHeight))
      world.dataset.height = String(L.height)
      world.dataset.width = String(L.width)
      if (state.sel && nodeEls.has(state.sel)) focusNode(state.sel, nodeEls, edgeEls)
      else resetFocus(nodeEls, edgeEls)
      if (refit) fit(L)
      // The ?expand=all deep link: consumed only once an overview layout has
      // named scatterable groups (a journey/table landing keeps it pending
      // until the first domains render). The recursive render already ran the
      // tail below with the expanded layout, so this call stops here.
      if (pendingExpandAll && lastExpandable.length > 0) {
        pendingExpandAll = false
        for (const id of lastExpandable) state.expanded.add(id)
        render(true)
        refreshDetail()
        updateExpBtn()
        return
      }
    } else {
      const failed = GRAPH.nodes.filter((n: any) => n.state === 'failed').length
      $('.stats').textContent =
        t('stats', { m: GRAPH.nodes.length, s: GRAPH.nodes.filter(visibleNode).length, e: GRAPH.edges.length })
        + (failed ? t('statsFailed', { f: failed }) : '')
        + (GRAPH.unresolvedKeys.length ? t('statsUnres', { n: GRAPH.unresolvedKeys.length }) : '')
    }

    renderTable(L)
    updateCrumb(scoped, scoped ? L.cluster.label : undefined)
    paintActivity()
    paintEditOverlay()
  }

  const countInj = (k: string): number => GRAPH.nodes.filter((n: any) => n.inject.includes(k)).length
  const tip = $('.tooltip')
  /** Singleton unresolved-key popover (surface for recovery offers). */
  const pop = $('.schPop')
  const showTip = (html: string): void => { tip.innerHTML = html; tip.style.display = 'block' }
  const hideTip = (): void => { tip.style.display = 'none' }
  const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
  const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const moveTip = (ev: Event): void => {
    const mouse = ev as MouseEvent
    tip.style.left = Math.min(window.innerWidth - 360, mouse.clientX + 14) + 'px'
    tip.style.top = (mouse.clientY + 14) + 'px'
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

  /** Detail-panel edit section: only in edit mode. Loader entries get the actions
   *  (config edit included for config-less entries — an added config is a normal
   *  patch row); runtime mounts get the boundary note instead of silent absence. */
  function editSection(n: any): string {
    if (!editOn || compose === null || !compose.editable) return ''
    const e = composeEntryOf(n)
    if (e === null) {
      // Either mounted while running, or boot machinery the loader tree carries
      // without an editable row (the include engine, HMR, native pieces).
      return `<div class="editSec"><div class="rtNote">${t(n.origin === 'runtime' ? 'eRuntime' : 'eMachinery')}</div></div>`
    }
    const origin = e.origin.managed ? t('eOriginManaged', { l: e.origin.layer }) : `${t('eOrigin')}: ${e.origin.layer}`
    const prot = e.protected === null ? '' : `<div class="protBadge ${e.protected.tier}">${t('eProtected', { r: t(WREASONS[e.protected.reason] ?? 'wrMany') })}</div>`
    return `
    <div class="editSec">
      <div class="editMeta">${origin}${prot}</div>
      <div class="btns">
        <button class="eb-toggle" data-id="${esc(e.id)}">${e.disabled ? t('eEnable') : t('eDisable')}</button>
        <button class="eb-cfg" data-id="${esc(e.id)}">${t('eEditCfg')}</button>
      </div>
    </div>`
  }

  /** Wire the edit section's buttons (called right after renderDetail paints). */
  function bindEditSection(): void {
    const toggle = container.querySelector('.detail .eb-toggle') as HTMLButtonElement | null
    if (toggle !== null) {
      const id = toggle.dataset.id as string
      const disabled = entryById.get(id)?.disabled ?? false
      toggle.onclick = () => addOp({ kind: disabled ? 'enable' : 'disable', id })
    }
    const cfg = container.querySelector('.detail .eb-cfg') as HTMLButtonElement | null
    if (cfg !== null) cfg.onclick = () => { configEditFor = cfg.dataset.id as string; cfgAskBack = false; renderDrawer() }
  }

  function renderDetail(n: any): void {
    // In config-edit mode the drawer follows the selection: clicking another
    // pill swaps the editor to that entry (per-entry drafts make it lossless).
    if (editOn && configEditFor !== null && compose !== null) {
      const ce = composeEntryOf(n)
      if (ce !== null && ce.id !== configEditFor) {
        configEditFor = ce.id
        cfgAskBack = false
        renderDrawer()
      }
    }
    const owners = (k: string): string => (keyOwners.get(k) ?? []).map((o) => nodeLabel(o)).join(', ')
    const keyChips = (list: string[]): string => list.map((k) => {
      const o = owners(k)
      if (o) return `<code>${k} → ${o}</code>`
      if (GRAPH.hostKeys.includes(k)) return `<span class="ext" title="${t('tipHostKey')}">${k}</span>`
      return `<span class="unres pk" data-key="${esc(k)}" title="${t('tipUnresKey')}">${k}</span>`
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
    ${(state.tab === 'domains' && !state.scope && state.expanded.has(lastL?.nodeGroup?.get(n.id) ?? ''))
      ? `<button class="open-btn grp">${t('collapseGroup')}</button>` : ''}
    ${editSection(n)}
    <button class="ask-btn" title="${t('askTitle')}">${t('ask')}</button>`
    const grpBtn = container.querySelector('.detail .open-btn.grp') as HTMLElement | null
    if (grpBtn !== null) {
      grpBtn.onclick = () => { const gid = lastL?.nodeGroup?.get(n.id); if (gid !== undefined) toggleExpand(gid) }
    }
    // unresolved inject keys open the same recovery popover the ext-zone
    // pills do (host keys stay hover-only)
    container.querySelectorAll<HTMLElement>('.detail .keys .unres.pk').forEach((chip) => {
      chip.onclick = (ev) => openUnresPop(chip.dataset.key as string, ev)
    })
    ;(container.querySelector('.detail .ask-btn') as HTMLElement).onclick = () => {
      // Hand-off to the SPA: its schematic client half turns the params into a
      // fresh ungrouped session with the question prefilled (see src/client/index.ts).
      const name = n.pluginName ?? n.label ?? n.id
      const params = new URLSearchParams({ 'sch-ask': n.id })
      if (name !== n.id) params.set('sch-name', name)
      window.open(`/?${params.toString()}`, '_blank', 'noopener')
    }
    bindEditSection()
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
    <div class="btns">
      <button class="open-btn exp">${state.expanded.has(c.id) ? t('collapseGroup') : t('expInOverview')}</button>
      <button class="open-btn">${t('openGroup')}</button>
    </div>
    ${swapSection(c)}`
    ;(container.querySelector('.detail .open-btn.exp') as HTMLElement).onclick = () => toggleExpand(c.id)
    ;(container.querySelector('.detail .open-btn:not(.exp)') as HTMLElement).onclick = () => enterScope(c.id)
    bindSwapSection(c)
  }

  /** Cluster-card provider-swap section: live registrars + catalog alternatives. */
  function swapSection(c: any): string {
    if (!editOn || compose === null || !compose.editable) return ''
    const seam = (compose.seams ?? []).find((s: any) => (c.seamKeys ?? []).includes(s.key))
    if (seam === undefined || seam.alternatives.length === 0) return ''
    const from = stripInc(seam.registrars[0]?.entryId ?? seam.owner?.id ?? '')
    const cur = seam.registrars.length > 0
      ? `<div class="swapCur"><span class="badge cur">${t('eSwapCurrent')}</span> ${esc(seam.registrars.map((r: any) => stripInc(r.entryId ?? r.id)).join(', '))}</div>`
      : ''
    const altRow = (a: any): string => {
      const badge = a.state === 'in-tree' ? (a.disabled ? t('eAltInTreeOff') : t('eAltInTree')) : a.state === 'installed' ? t('eAltInstalled') : t('eAltCatalog')
      const cls = a.state === 'in-tree' ? 'inTree' : a.state === 'installed' ? 'installed' : 'catalog'
      if (a.state === 'catalog') {
        return `<div class="swapRow"><span class="badge ${cls}">${badge}</span><code class="pkg">${esc(a.package)}</code>
          <button class="eb-copy" data-cmd="${esc(a.install ?? '')}">${t('eCopy')} · ${esc(a.install ?? '')}</button></div>`
      }
      return `<div class="swapRow"><span class="badge ${cls}">${badge}</span><code class="pkg">${esc(a.package)}</code>
        <button class="eb-swap" data-seam="${esc(seam.key)}" data-from="${esc(from)}" data-to-id="${esc(a.id ?? '')}" data-to-name="${esc(a.state === 'in-tree' ? '' : a.package)}">${t('eSwapTo')}</button></div>`
    }
    return `
    <div class="editSec swapSec">
      <h4>${t('eSwapTitle')} · <code>${esc(seam.key)}</code></h4>
      ${cur}
      ${seam.alternatives.map(altRow).join('')}
    </div>`
  }

  /** Wire the swap section's buttons. */
  function bindSwapSection(c: any): void {
    const seam = compose === null ? undefined : (compose.seams ?? []).find((s: any) => (c.seamKeys ?? []).includes(s.key))
    if (seam === undefined) return
    container.querySelectorAll<HTMLButtonElement>('.detail .eb-swap').forEach((btn) => {
      btn.onclick = () => {
        const to: any = {}
        if (btn.dataset.toId !== '') to.id = btn.dataset.toId
        if (btn.dataset.toName !== '') to.name = btn.dataset.toName
        addOp({ kind: 'swap', seam: btn.dataset.seam, from: btn.dataset.from, to })
      }
    })
    container.querySelectorAll<HTMLButtonElement>('.detail .eb-copy').forEach((btn) => {
      btn.onclick = () => {
        const command = btn.dataset.cmd ?? ''
        void navigator.clipboard?.writeText(command).then(
          () => { btn.textContent = t('eCopied'); window.setTimeout(() => { btn.textContent = `${t('eCopy')} · ${btn.dataset.cmd}` }, 1500) },
          () => toast(command),
        )
      }
    })
  }

  /** Re-localize whichever detail panel is showing (language flip). */
  function refreshDetail(): void {
    if (state.sel) {
      if (byId.has(state.sel)) return renderDetail(byId.get(state.sel))
      if (clusterById.has(state.sel)) return renderDetailCluster(clusterById.get(state.sel))
      if (state.sel === 'spine') {
        const members = GRAPH?.nodes.filter((n: any) => !n.cluster && n.spine) ?? []
        if (members.length > 0) return renderDetailFamily('spine', 'core', t('spineTip'), members)
      }
      if (state.sel.startsWith('fam:')) {
        const fam = state.sel.slice(4)
        const members = GRAPH?.nodes.filter((n: any) => n.group === fam) ?? []
        if (members.length > 0) return renderDetailFamily(state.sel, fam, t('familyTip'), members)
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
    ext.innerHTML = `<span class="dot ext"></span>${t('extKeys')} <b>${GRAPH.hostKeys.length + GRAPH.unresolvedKeys.length}</b>`
    ext.onclick = () => { state.ext = !state.ext; renderChips(); render() }
    f.appendChild(ext)

    // edit chrome: every disabled entry in the composed tree — the durable
    // companion to the timeline's recovery rows, which age out of the ring
    if (editOn && compose !== null && compose.editable) {
      const dis = (compose.entries ?? []).filter((e: any): boolean => e.disabled)
      const chip = document.createElement('span')
      chip.className = 'chip'
      chip.title = t('eDisabledTitle')
      chip.setAttribute('aria-pressed', String(disabledList))
      chip.innerHTML = `<span class="dot plain"></span>${t('eDisabledChip')} <b>${dis.length}</b>`
      chip.onclick = () => { disabledList = !disabledList; renderDrawer() }
      f.appendChild(chip)
    }

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
    else if (state.sel !== null && !byId.has(state.sel) && !clusterById.has(state.sel) && state.sel !== 'spine' && !state.sel.startsWith('fam:')) state.sel = null
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
    g.hostKeys,
    g.unresolvedKeys,
  ])

  let lastSig = ''
  const toastEl = $('.toast')
  const toast = (msg: string): void => {
    toastEl.textContent = msg
    toastEl.classList.add('on')
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 6000)
  }

  // ------- composition edit (the graph is the editor) -------
  /**
   * Mirror of the host half's compose endpoints: a model fetched on demand,
   * a pending operation list previewed in the right drawer, ghost overlays
   * on the mesh while a preview is open, and writes that ride the harness's
   * own hot reload. Everything sits behind the ✎ toggle (sessionStorage
   * 'sch-edit'); off = the pure-observer page, with no edit affordance.
   */
  let editOn = false
  let compose: any = null
  let composeSeq = 0
  let entryById = new Map<string, any>()
  let draftOps: any[] = []
  let draftPreview: any = null
  let configEditFor: string | null = null
  /** Back with unsaved edits raises the apply-or-restore prompt (drawer-local, cleared on any exit). */
  let cfgAskBack = false
  /** Un-previewed editor texts by entry id — switching pills keeps each entry's half-typed config. */
  const cfgDrafts = new Map<string, string>()
  let confirmText = ''
  /** Disabled-entries list open in the drawer — the standing recovery path
   *  timeline rows age out of (the SSE snapshot carries only 40 host actions). */
  let disabledList = false
  const editBtn = $('.editBtn')

  const stripInc = (id: string): string => id.replace(/^include:/, '')

  const composeEntryOf = (n: any): any | null =>
    compose === null || n.origin === 'runtime' ? null : entryById.get(stripInc(n.id)) ?? null

  const postCompose = async (path: string, body: any): Promise<{ status: number; json: any }> => {
    const r = await fetch('/schematic/compose/' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: r.status, json: await r.json().catch(() => null) }
  }

  const refreshCompose = async (): Promise<void> => {
    const seq = ++composeSeq
    let body: any = null
    try { body = await (await fetch('/schematic/compose.json', { cache: 'no-store' })).json() } catch { /* host older than the page */ }
    if (seq !== composeSeq || !editOn) return
    compose = body
    entryById = new Map((compose?.entries ?? []).map((e: any): [string, any] => [e.id, e]))
    if (GRAPH !== null) renderChips()
    renderEditChrome()
    refreshDetail()
  }

  /** Banner + ✎ state; the drawer renders itself via renderDrawer(). */
  const renderEditChrome = (): void => {
    editBtn.setAttribute('aria-pressed', String(editOn))
    const banner = $('.editBanner')
    banner.classList.toggle('on', editOn && (compose === null || !compose.editable || compose.lastError !== null))
    if (!editOn) { banner.innerHTML = ''; renderDrawer(); return }
    if (compose === null) { banner.innerHTML = `<span>${t('eUnavailable')}</span>`; renderDrawer(); return }
    if (!compose.editable) {
      banner.innerHTML = `<span>${t('eLocked', { r: compose.notEditableReason ?? '?' })}</span>` +
        (compose.backups.length > 0 ? `<button class="ebRollback">${t('eRollback')}</button>` : '')
    } else if (compose.lastError !== null) {
      banner.innerHTML = `<span>${t('eLastFail', { m: esc(compose.lastError.message.split('\n')[0]) })}</span>` +
        (compose.backups.length > 0 ? `<button class="ebRollback">${t('eRollback')}</button>` : '')
    } else banner.innerHTML = ''
    const rb = banner.querySelector('.ebRollback') as HTMLElement | null
    if (rb !== null) rb.onclick = () => { void doRollback() }
    renderDrawer()
  }

  const doRollback = async (): Promise<void> => {
    const r = await postCompose('rollback', {})
    if (r.status === 200) toast(t('eRolledBack', { f: r.json.restored }))
    else toast(r.json?.error ?? t('eNoBackups'))
    void load()
    void refreshCompose()
  }

  /** Queue one operation, refresh the preview, open the drawer. */
  const addOp = (op: any): void => {
    if (compose === null || !compose.editable) return
    draftOps = [...draftOps, op]
    confirmText = ''
    configEditFor = null
    void runPreview()
  }

  /**
   * Re-enable an unmounted entry from outside the graph — timeline topo rows,
   * the disabled list, unresolved-key popovers all funnel here. Every gate
   * addOp would fail silently on gets its own toast instead: the mode is never
   * flipped for the user (✎ stays the only door into editing).
   */
  const queueEnable = (id: string): void => {
    if (!editOn) { toast(t('eEditFirst')); return }
    if (compose === null) { toast(t('eUnavailable')); return }
    if (!compose.editable) { toast(t('eLocked', { r: compose.notEditableReason ?? '?' })); return }
    if (!entryById.has(id)) { toast(t('rowGone', { id })); return }
    addOp({ kind: 'enable', id })
  }

  // ------- unresolved-key popover -------
  /** Every recovery button in the popover carries its entry id here. */
  const closePop = (): void => { pop.classList.remove('on') }

  const openUnresPop = (key: string, ev: Event): void => {
    const mouse = ev as MouseEvent
    const injectors = GRAPH.nodes.filter((n: any) => n.inject.includes(key))
    const inj = injectors.slice(0, 6).map((n: any) => n.label).join(', ') + (injectors.length > 6 ? ' …' : '')
    // best-effort ring lookup: the topo-provider row that watched this key
    // fall unresolved names the vacated entry (suppressed when the unit's own
    // unmount row told the story — hence "best-effort", the hint says so)
    const vacated = [...act.actions].reverse().find((a: any): boolean =>
      a.kind === 'topo' && a.name === 'ctx.' + key && typeof a.entry === 'string' && (a.snippet ?? '').endsWith('→ ∅'))
    const vacLabel = vacated !== undefined ? (vacated.snippet.split(' → ')[0] ?? vacated.entry) : ''
    // 'host' vacated a launcher key (no compose row); an entry the model
    // already shows enabled would queue a no-op — neither gets an offer
    const vacShow = vacated !== undefined && vacLabel !== '∅' && vacLabel !== 'host'
      && !(compose !== null && entryById.get(vacated.entry)?.disabled === false)
    // curated seam alternatives are the reliable offer — but they only exist
    // with the compose model loaded, i.e. while edit mode is on (by design)
    const seam = compose === null ? undefined : (compose.seams ?? []).find((s: any): boolean => s.key === key)
    const alts = (seam?.alternatives ?? []).filter((a: any): boolean => a.state === 'in-tree' && a.disabled)
    pop.innerHTML = `
      <div class="t">⌁ ctx.${esc(key)}</div>
      <div class="d">${t('tipUnresKey')}</div>
      <div class="d">${t('tipExtCount', { n: injectors.length })}</div>
      ${inj !== '' ? `<div class="k">${esc(inj)}</div>` : ''}
      <h4>${t('pkRecover')}</h4>
      ${vacShow ? `
      <div class="pkRow"><button data-entry="${esc(vacated.entry)}">${t('pkEnableEntry', { l: esc(vacLabel) })}</button><span class="k">${t('pkFromRing')}</span></div>` : ''}
      ${alts.map((a: any): string => `
      <div class="pkRow"><button data-entry="${esc(a.id)}">${t('pkEnableAlt', { p: esc(a.package) })}</button><span class="badge">${t('eAltInTreeOff')}</span></div>`).join('')}
      ${!vacShow && alts.length === 0 ? `<div class="d">${t('pkNone')}</div>` : ''}`
    pop.querySelectorAll<HTMLButtonElement>('button[data-entry]').forEach((btn) => {
      btn.onclick = () => queueEnable(btn.dataset.entry as string)
    })
    pop.style.left = Math.min(window.innerWidth - 372, mouse.clientX + 12) + 'px'
    pop.style.top = Math.max(8, Math.min(window.innerHeight - 240, mouse.clientY + 12)) + 'px'
    pop.classList.add('on')
  }

  const resetDraft = (): void => {
    draftOps = []
    draftPreview = null
    configEditFor = null
    confirmText = ''
    renderDrawer()
    render()
  }

  const runPreview = async (): Promise<void> => {
    if (compose === null) return
    const r = await postCompose('preview', { baseHash: compose.patch.hash, operations: draftOps })
    if (r.status === 200) { draftPreview = r.json; renderDrawer(); render(); return }
    if (r.status === 409) { toast(t('eStale')); resetDraft(); void refreshCompose(); return }
    toast(t('ePreviewFail', { m: r.json?.error ?? r.status }))
    draftOps = draftOps.slice(0, -1)
    renderDrawer()
  }

  const applyDraft = async (): Promise<void> => {
    if (compose === null || draftPreview === null) return
    const confirmIds = confirmText.split(/[\s,，]+/).filter(Boolean)
    const r = await postCompose('apply', { baseHash: compose.patch.hash, operations: draftOps, confirmIds })
    if (r.status === 200) {
      toast(t('eApplied'))
      draftOps = []; draftPreview = null; confirmText = ''
      void load()
      window.setTimeout(() => { void load(); void refreshCompose() }, 2500)
      renderDrawer()
      return
    }
    if (r.status === 409) { toast(t('eStale')); resetDraft(); void refreshCompose(); return }
    toast(t('eApplyFail', { m: r.json?.error ?? r.status }))
    renderDrawer()
  }

  const doClear = async (): Promise<void> => {
    if (compose === null) return
    const r = await postCompose('clear', { baseHash: compose.patch.hash })
    if (r.status === 200) { toast(t('eCleared', { n: r.json.removedRowCount })); resetDraft(); void load(); void refreshCompose() }
    else if (r.status === 409) { toast(t('eStale')); void refreshCompose() }
    else toast(t('eApplyFail', { m: r.json?.error ?? r.status }))
  }

  /** One LCS line diff of the managed block; blocks are small, so the full table is fine. */
  const lineDiff = (a: string, b: string): { s: ' ' | '-' | '+', t: string }[] => {
    const A = a === '' ? [] : a.split('\n'), B = b === '' ? [] : b.split('\n')
    const m = A.length, n = B.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    const out: { s: ' ' | '-' | '+', t: string }[] = []
    let i = 0, j = 0
    while (i < m && j < n) {
      if (A[i] === B[j]) { out.push({ s: ' ', t: A[i] }); i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ s: '-', t: A[i] }); i++ }
      else { out.push({ s: '+', t: B[j] }); j++ }
    }
    while (i < m) { out.push({ s: '-', t: A[i] }); i++ }
    while (j < n) { out.push({ s: '+', t: B[j] }); j++ }
    return out
  }

  const WKEYS: Record<string, string> = {
    SELF_DISABLE: 'wSelf', FREEZE_JS_EXPR: 'wFreeze', KEY_CONFLICT_RISK: 'wConflict',
    ORPHANED_KEY: 'wOrphan', CONFIG_FIELD_DROPPED: 'wDropped', BOOT_CRITICAL: 'wBoot',
  }
  const WREASONS: Record<string, string> = {
    self: 'wrSelf', hotReload: 'wrHot', pageServer: 'wrPage', spaRoster: 'wrSpa',
    settingsSecrets: 'wrSecrets', durability: 'wrDura', manyDependents: 'wrMany',
  }

  const warnRow = (w: any): string => {
    const key = WKEYS[w.code]
    if (key === undefined) return ''
    const params: Record<string, string | number> = {
      ids: (w.ids ?? []).join(', '), keys: (w.keys ?? []).join(', '), detail: w.detail ?? '',
    }
    if (w.code === 'BOOT_CRITICAL' && WREASONS[w.detail] !== undefined) params.detail = t(WREASONS[w.detail])
    return `<li class="warnItem ${w.level}">${t(key, params)}</li>`
  }

  /** Color one YAML line lexically. Consumes every character exactly once, so the highlight layer never misaligns with the transparent textarea on top. */
  const hlValue = (v: string): string => {
    let out = '', i = 0
    while (i < v.length) {
      const c = v[i]!
      if (c === '"' || c === "'") {
        const close = v.indexOf(c, i + 1)
        const end = close === -1 ? v.length : close + 1
        out += `<span class="ts">${esc(v.slice(i, end))}</span>`; i = end; continue
      }
      if (c === '!' && v[i + 1] === '!') {
        const sp = v.indexOf(' ', i)
        const end = sp === -1 ? v.length : sp
        out += `<span class="tj">${esc(v.slice(i, end))}</span>`
        if (sp !== -1) out += `<span class="tje">${esc(v.slice(sp))}</span>`
        return out
      }
      const num = /^\d[\d._]*/.exec(v.slice(i))
      if (num !== null) { out += `<span class="tn">${esc(num[0])}</span>`; i += num[0].length; continue }
      const word = /^[A-Za-z_$][\w$.-]*/.exec(v.slice(i))
      if (word !== null) {
        const w = word[0]
        out += (w === 'true' || w === 'false' || w === 'null')
          ? `<span class="tb">${esc(w)}</span>` : `<span class="tp">${esc(w)}</span>`
        i += w.length; continue
      }
      out += `<span class="tp">${esc(c)}</span>`; i += 1
    }
    return out
  }
  const hlYamlLine = (line: string): string => {
    if (line.trimStart().startsWith('#')) return `<span class="tc">${esc(line)}</span>`
    let code = line, cmt = ''
    const hash = line.indexOf(' #')
    if (hash > 0 && ((line.slice(0, hash).match(/["']/g) ?? []).length) % 2 === 0) {
      code = line.slice(0, hash); cmt = line.slice(hash)
    }
    const key = /^(\s*(?:-\s+)*)([\w.$-]+)(:)(.*)$/.exec(code)
    const body = key !== null
      ? (key[1] !== '' ? `<span class="tp">${esc(key[1])}</span>` : '')
        + `<span class="tk">${esc(key[2])}</span><span class="tp">:</span>` + hlValue(key[4])
      : hlValue(code)
    return body + (cmt !== '' ? `<span class="tc">${esc(cmt)}</span>` : '')
  }
  /** Mapping keys declared in a config text (any nesting level; enough for the dropped-field chips). */
  const yamlKeys = (text: string): string[] => {
    const keys: string[] = []
    for (const m of text.matchAll(/^[\s-]*([\w.$-]+):(?=\s|$)/gm)) keys.push(m[1])
    return keys
  }

  /** The right drawer: config-edit mode, or the pending preview. */
  const renderDrawer = (): void => {
    const drawer = $('.editDrawer'), scrim = $('.editScrim')
    // Re-localizing rebuilds the drawer. Preserve the editor's interaction
    // state as well as its text so a language switch is invisible to the
    // user's cursor and scroll position.
    const oldSource = drawer.querySelector<HTMLTextAreaElement>('.ySrc')
    const editorView = oldSource === null ? null : {
      focused: document.activeElement === oldSource,
      start: oldSource.selectionStart,
      end: oldSource.selectionEnd,
      direction: oldSource.selectionDirection,
      top: oldSource.scrollTop,
      left: oldSource.scrollLeft,
    }
    const open = editOn && (configEditFor !== null || draftPreview !== null || disabledList)
    drawer.classList.toggle('on', open)
    scrim.classList.toggle('on', open)
    if (!open) { drawer.innerHTML = ''; cfgDrafts.clear(); cfgAskBack = false; disabledList = false; return }

    if (configEditFor !== null) {
      const edId = configEditFor
      const e = entryById.get(edId)
      const raw = e?.config?.raw ?? ''
      const initial = cfgDrafts.get(edId) ?? raw
      const origKeys = yamlKeys(raw)
      drawer.innerHTML = `
      <button class="dClose" title="${t('eClose')}" aria-label="${t('eClose')}">✕</button>
      <h3>${t(raw === '' ? 'eCfgTitleAdd' : 'eCfgTitle', { id: esc(edId) })}</h3>
      <p class="hint">${t(raw === '' ? 'eCfgHintAdd' : 'eCfgHint')}</p>
      <div class="cfgEd">
        <div class="cfgKeys"><span class="cfgKeysLbl">${t('eCfgKeys')}</span>${
          origKeys.map((k) => `<span class="kChip" data-k="${esc(k)}">${esc(k)}</span>`).join('')
          || `<span class="hint">${t('eCfgNoKeys')}</span>`}</div>
        <div class="yEd">
          <div class="yGutter"></div>
          <div class="yWrap">
            <pre class="yHl" aria-hidden="true"><code></code></pre>
            <textarea class="ySrc" spellcheck="false" wrap="off">${esc(initial)}</textarea>
          </div>
        </div>
        <div class="cfgFoot">
          <span class="yMsg"></span>
          <button class="yReset">${t('eCfgReset')}</button>
        </div>
      </div>
      ${cfgAskBack && initial !== raw ? `
      <div class="askBar">
        <span class="askMsg">${t('eCfgAskTitle')}</span>
        <div class="askBtns">
          <button class="dPrimary askApply">${t('eCfgAskApply')}</button>
          <button class="dGhost askDiscard">${t('eCfgAskDiscard')}</button>
          <button class="dGhost askResume">${t('eCfgAskResume')}</button>
        </div>
      </div>` : ''}
      <div class="dbtns">
        <button class="dPrimary cfgGo">${t('eCfgPreview')}</button>
        <button class="dGhost cfgBack">${t('eBack')}</button>
      </div>`
      const ta = drawer.querySelector('.ySrc') as HTMLTextAreaElement
      const code = drawer.querySelector('.yHl code') as HTMLElement
      const hl = drawer.querySelector('.yHl') as HTMLElement
      const gutter = drawer.querySelector('.yGutter') as HTMLElement
      const yEd = drawer.querySelector('.yEd') as HTMLElement
      const msg = drawer.querySelector('.yMsg') as HTMLElement
      const paint = (): void => {
        const text = ta.value
        const lines = text.split('\n')
        code.innerHTML = lines.map(hlYamlLine).join('\n') + (text.endsWith('\n') ? '\n ' : '')
        gutter.textContent = lines.map((_, i) => String(i + 1)).join('\n')
        const now = new Set(yamlKeys(text))
        drawer.querySelectorAll<HTMLElement>('.kChip').forEach((chip) => {
          chip.classList.toggle('drop', !now.has(chip.dataset.k as string))
        })
        const errs: string[] = []
        if (text.includes('\t')) errs.push(t('eCfgTabErr'))
        lines.forEach((l, i) => {
          if (((l.match(/["']/g) ?? []).length) % 2 === 1) errs.push(t('eCfgQuote', { n: i + 1 }))
        })
        const dirty = text !== raw
        msg.textContent = errs.length > 0
          ? errs.join(' · ')
          : (dirty ? `✎ ${t('eCfgDraft')} · ` : '') + `${lines.length} ${t('eCfgUnit')}`
        msg.classList.toggle('bad', errs.length > 0)
        yEd.classList.toggle('bad', errs.length > 0)
      }
      let deb = 0
      ta.addEventListener('input', () => { cfgDrafts.set(edId, ta.value); clearTimeout(deb); deb = window.setTimeout(paint, 180) })
      ta.addEventListener('scroll', () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop })
      ta.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Tab') return
        ev.preventDefault()
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end')
        cfgDrafts.set(edId, ta.value)
        paint()
      })
      ;(drawer.querySelector('.yReset') as HTMLElement).onclick = () => { ta.value = raw; cfgDrafts.delete(edId); paint() }
      paint()
      if (editorView !== null) {
        ta.setSelectionRange(editorView.start, editorView.end, editorView.direction)
        ta.scrollTop = editorView.top
        ta.scrollLeft = editorView.left
        hl.scrollTop = editorView.top
        hl.scrollLeft = editorView.left
        gutter.scrollTop = editorView.top
        if (editorView.focused) ta.focus({ preventScroll: true })
      }
      const go = (): void => {
        const text = ta.value
        if (text.trim() === '') { toast(t('eCfgEmpty')); return }
        configEditFor = null
        cfgAskBack = false
        cfgDrafts.delete(edId)
        addOp({ kind: 'setConfig', id: edId, config: text })
      }
      ;(drawer.querySelector('.cfgGo') as HTMLElement).onclick = go
      const back = (): void => {
        if (ta.value === raw) { configEditFor = null; renderDrawer(); return }
        cfgAskBack = true
        renderDrawer()
        ;(drawer.querySelector('.askResume') as HTMLElement | null)?.focus()
      }
      ;(drawer.querySelector('.cfgBack') as HTMLElement).onclick = back
      ;(drawer.querySelector('.dClose') as HTMLElement).onclick = back
      const askApply = drawer.querySelector('.askApply') as HTMLElement | null
      const askDiscard = drawer.querySelector('.askDiscard') as HTMLElement | null
      const askResume = drawer.querySelector('.askResume') as HTMLElement | null
      if (askApply !== null) askApply.onclick = go
      if (askDiscard !== null) askDiscard.onclick = () => {
        cfgDrafts.delete(edId)
        configEditFor = null
        cfgAskBack = false
        renderDrawer()
      }
      if (askResume !== null) askResume.onclick = () => {
        cfgAskBack = false
        renderDrawer()
        ;(drawer.querySelector('.ySrc') as HTMLElement).focus()
      }
      return
    }

    // Standing disabled-entries list — the durable recovery surface (timeline
    // rows age out of the action ring). Queueing an op sets draftPreview and
    // flips the drawer to the preview branch below; cancel lands back here
    // while disabledList stays true.
    if (draftPreview === null) {
      const dis = (compose?.entries ?? []).filter((e: any): boolean => e.disabled)
      drawer.innerHTML = `
      <button class="dClose" title="${t('eClose')}" aria-label="${t('eClose')}">✕</button>
      <h3>${t('eDisabledList', { n: dis.length })}</h3>
      <p class="hint">${t('eDisabledHint')}</p>
      <ul class="dRows">${dis.length === 0
        ? `<li class="dRow"><span>${t('eDisabledEmpty')}</span></li>`
        : dis.map((e: any): string => `
        <li class="dRow dis">
          <b>${esc(e.id)}</b>
          <span class="badge">${t('eAltInTreeOff')}</span>
          <button class="dEnable" data-id="${esc(e.id)}">${t('eEnableBtn')}</button>
        </li>`).join('')}</ul>`
      ;(drawer.querySelector('.dClose') as HTMLElement).onclick = () => { disabledList = false; renderDrawer() }
      drawer.querySelectorAll<HTMLButtonElement>('.dEnable').forEach((btn) => {
        btn.onclick = () => queueEnable(btn.dataset.id as string)
      })
      return
    }

    const p = draftPreview
    const kindRow = (e: any): string => {
      const label = e.kind === 'removed' ? t('eDiffRemoved') : e.kind === 'added' ? t('eDiffAdded') : t('eDiffChanged')
      const change = e.kind === 'changed'
        ? ' (' + e.changes.map((c: string) => t(c === 'disabled' ? 'eChangeDisabled' : 'eChangeConfig')).join(' · ') + ')' : ''
      return `<li class="dRow ${e.kind}"><b>${esc(e.id)}</b><span>${label}${change}</span></li>`
    }
    const dangerIds: string[] = [...new Set<string>((p.warnings ?? []).filter((w: any) => w.level === 'danger').flatMap((w: any) => w.ids ?? []))]
    const confirmed = dangerIds.length === 0 || dangerIds.every((id) => confirmText.split(/[\s,，]+/).includes(id))
    const diff = lineDiff(p.blockYamlBefore ?? '', p.blockYamlAfter ?? '')
    drawer.innerHTML = `
    <h3>${t('eDrawerTitle', { n: draftOps.length })}</h3>
    ${p.entries.length > 0
      ? `<ul class="dRows">${p.entries.map(kindRow).join('')}</ul>`
      : `<p class="hint">${t('eNoChanges')}</p>`}
    ${p.orphanedKeys.length > 0 ? `<p class="hint">${t('eOrphaned')}: ${p.orphanedKeys.map((o: any) => `<code>${esc(o.key)}</code>`).join(' ')}</p>` : ''}
    ${p.warnings.length > 0 ? `<ul class="warnList">${p.warnings.map(warnRow).join('')}</ul>` : ''}
    ${dangerIds.length > 0 ? `<label class="confirmLbl">${t('eConfirmNeed', { ids: dangerIds.join(' ') })}</label>
      <input class="confirmIn" placeholder="${t('eConfirmPh')}" value="${esc(confirmText)}">` : ''}
    <h4>${t('eYamlDiff')}</h4>
    <pre class="yamlDiff">${diff.map((l) => `<span class="l ${l.s}">${l.s === ' ' ? ' ' : l.s} ${esc(l.t)}</span>`).join('\n')}</pre>
    <p class="hint">${t('eGhostLegend')}</p>
    <div class="dbtns">
      <button class="dPrimary dApply" ${confirmed ? '' : 'disabled'}>${t('eApply')}</button>
      <button class="dGhost dCancel">${t('eCancel')}</button>
      <span class="spacer" style="flex:1"></span>
      ${compose?.backups?.length > 0 ? `<button class="dGhost dRollback">${t('eRollback')} (${compose.backups.length})</button>` : ''}
      <button class="dGhost dClear">${t('eClear')}</button>
    </div>`
    ;(drawer.querySelector('.dCancel') as HTMLElement).onclick = () => resetDraft()
    ;(drawer.querySelector('.dApply') as HTMLElement).onclick = () => { void applyDraft() }
    const rb = drawer.querySelector('.dRollback') as HTMLElement | null
    if (rb !== null) rb.onclick = () => { void doRollback(); resetDraft() }
    ;(drawer.querySelector('.dClear') as HTMLElement).onclick = () => { void doClear() }
    const ci = drawer.querySelector('.confirmIn') as HTMLInputElement | null
    if (ci !== null) ci.oninput = () => {
      confirmText = ci.value
      const ok = dangerIds.every((id) => confirmText.split(/[\s,，]+/).includes(id))
      ;(drawer.querySelector('.dApply') as HTMLButtonElement).disabled = !ok
    }
  }

  /**
   * Ghost overlay while a preview is open: struck/faded pills for entries the
   * draft removes or disables, dashed pills beside the mesh for additions
   * (their provides are unknown until mounted, hence the ?).
   */
  const paintEditOverlay = (): void => {
    world.querySelectorAll('g.editGhosts').forEach((g) => g.remove())
    world.querySelectorAll('.node.ghostRem').forEach((g) => g.classList.remove('ghostRem'))
    if (!editOn || draftPreview === null || state.tab === 'journey') return
    for (const e of draftPreview.entries) {
      if (e.liveNodeId === null) continue
      const going = e.kind === 'removed' || (e.kind === 'changed' && e.changes.includes('disabled') && e.disabledAfter)
      if (!going) continue
      world.querySelectorAll(`.node[data-id="${cssEscape(e.liveNodeId)}"]`).forEach((g) => g.classList.add('ghostRem'))
    }
    const adds = draftPreview.entries.filter((e: any) => e.kind === 'added')
    const pos: any[] = [...(lastL?.pos?.values() ?? [])]
    if (adds.length === 0 || pos.length === 0) return
    const gG = el('g', { class: 'editGhosts' }, world)
    const gx = Math.max(...pos.map((p) => p.x + p.w)) + 24
    const gy = Math.min(...pos.map((p) => p.y))
    adds.forEach((e: any, i: number) => {
      const g = el('g', { class: 'node ghostAdd' }, gG)
      const y = gy + i * (H + 8)
      el('rect', { x: String(gx), y: String(y), width: String(Math.max(96, e.id.length * 7.2 + 44)), height: String(H), rx: '7' }, g)
      const tx = el('text', { x: String(gx + 14), y: String(y + H / 2 + 1) }, g)
      tx.textContent = `${e.id} ?`
    })
  }

  editBtn.addEventListener('click', () => {
    editOn = !editOn
    try { sessionStorage.setItem('sch-edit', editOn ? '1' : '0') } catch { /* session storage unavailable */ }
    if (!editOn) { compose = null; entryById = new Map(); disabledList = false; resetDraft() }
    else void refreshCompose()
    renderEditChrome()
    if (GRAPH !== null) renderChips()
    render()
    refreshDetail()
  })
  ;(() => { // restore the remembered mode, but never silently enable affordances
    try { editOn = sessionStorage.getItem('sch-edit') === '1' } catch { /* keep off */ }
    if (editOn) { editBtn.setAttribute('aria-pressed', 'true'); void refreshCompose() }
  })()

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
    /** replay toggle: history pages of the shown session render below the live rows. */
    replay: false,
    /** one page at a time; older pages append (rows are newest-first). */
    hist: { rows: [] as any[], hasMore: false, nextBeforeSeq: null as number | null, loading: false, failed: false },
    /** stats toggle: the actList swaps to the per-plugin monitoring table. */
    stats: false,
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
    subagent: 'akSubagent', title: 'akTitle', action: 'akAction', job: 'akJob',
    workflow: 'akWorkflow', 'workflow-end': 'akWorkflowEnd', svc: 'akSvc', topo: 'akTopo',
  }
  const sessSel = $('.sessSel') as unknown as HTMLSelectElement
  const subBtn = $('.subBtn')
  const svcBtn = $('.svcBtn')
  const expBtn = $('.expBtn')
  /** Label the footer chip "collapse all" only when every group is scattered — a partial scatter must not read as all-expanded. */
  const allExpanded = (): boolean =>
    lastExpandable.length > 0 && lastExpandable.every((id) => state.expanded.has(id))
  const updateExpBtn = (): void => {
    const on = allExpanded()
    expBtn.textContent = on ? t('collapseAll') : t('expandAll')
    expBtn.setAttribute('aria-pressed', String(on))
    expBtn.title = t('expAllTitle')
  }
  expBtn.addEventListener('click', () => {
    // Union, not replace: groups already scattered (absent from lastExpandable,
    // which lists only current cards) must stay scattered when expanding the rest.
    if (allExpanded()) state.expanded.clear()
    else for (const id of lastExpandable) state.expanded.add(id)
    updateExpBtn()
    render(true)
    refreshDetail()
  })
  updateExpBtn()
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
      for (const cand of [typeof n.cluster === 'string' ? n.cluster : null, n.spine ? 'spine' : null, 'fam:' + n.group, id]) {
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
   * Modules whose strong glow a state frame granted; the next frame that
   * drops them (a workflow run ended, a tool call settled) downgrades them,
   * since no per-row event necessarily will.
   */
  const stateHeld = new Set<string>()
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
    const mods: string[] = Array.isArray(s.activeModules) ? s.activeModules : []
    for (const m of mods) {
      stateHeld.add(m)
      if (act.active.has(m)) continue
      act.active.set(m, { until: Number.POSITIVE_INFINITY, strong: true })
    }
    for (const m of stateHeld) {
      if (mods.includes(m)) continue
      stateHeld.delete(m)
      if (act.active.get(m)?.strong) act.active.set(m, { until: Date.now() + LIVE_TTL_MS, strong: false })
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
      case 'job': return (e.name ?? '') + (e.snippet !== undefined ? ` · ${e.snippet}` : '') + (e.durationMs !== undefined ? ` · ${e.durationMs}ms` : '') + (e.isError ? ' ✕' : '')
      case 'workflow': return [e.name, e.snippet].filter(Boolean).join(' · ') + (e.durationMs !== undefined ? ` · ${e.durationMs}ms` : '') + (e.isError ? ' ✕' : '')
      case 'workflow-end': return (e.snippet ?? '') + (e.durationMs !== undefined ? ` · ${e.durationMs}ms` : '') + (e.isError ? ' ✕' : '')
      case 'svc': return e.name ?? ''
      case 'topo': {
        // snippet is '+'/'-' for mount/unmount rows, else 'from → to · reason'
        const d = e.snippet ?? ''
        if (d === '+' || d === '-') return `${e.name ?? ''} ${d === '+' ? t('topoOn') : t('topoOff')}`
        return [e.name, d].filter(Boolean).join(' · ') + (e.isError ? ' ✕' : '')
      }
      default: return e.name ?? ''
    }
  }
  const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour12: false })

  /** Full redraw of the timeline list from the shown sessions' rings + host actions. */
  function renderActList(): void {
    if (act.stats) { renderStatsTable(); return }
    const rows: any[] = [...act.actions]
    for (const id of shownSessions()) rows.push(...(act.timelines.get(id) ?? []))
    const visible = act.showSvc ? rows : rows.filter((e) => e.kind !== 'svc')
    visible.sort((a, b) => b.time - a.time)
    const shown = visible.slice(0, 60)
    const rowHtml = (e: any): string => {
      const badge = e.module !== null
        ? `<span class="md"${moduleColorCss(e.module) ? ` style="--mc: ${moduleColorCss(e.module)}"` : ''}>${esc(moduleShort(e.module))}</span>`
        : ''
      const label = t(AK[e.kind] ?? AK.turn)
      // every non-action row arrived as one session/event broadcast — hover
      // names the units that received it (host-domain actions, job rows,
      // service reads, and live workflow rows did not broadcast)
      const tip = e.kind === 'action' || e.kind === 'job' || e.kind === 'svc' || e.kind === 'topo' || e.kind === 'workflow' || e.kind === 'workflow-end' ? '' : recvTip()
      // A topo row naming an entry that is no longer on the graph still points
      // at a compose row: it grows an enable affordance (⏻) in place of the
      // selection click — resolves mirrors the click handler's own lookup
      const resolves = e.module !== null && byId.has(moduleIds.get(e.module)?.[0] ?? '')
      const rec = e.kind === 'topo' && typeof e.entry === 'string' && !resolves
      const entryAttr = typeof e.entry === 'string' ? ` data-entry="${esc(e.entry)}"` : ''
      return `<div class="actRow${e.isError ? ' err' : ''}"${e.module ? ` data-module="${esc(e.module)}"` : ''}${entryAttr}${rec ? ` title="${esc(t('rowEnableHint'))}"` : tip ? ` title="${esc(tip)}"` : ''}><time>${fmtTime(e.time)}</time>${badge}<span class="tx">${label} · ${esc(detailOf(e))}</span>${rec ? ' <span class="rec">⏻</span>' : ''}</div>`
    }
    let html = ''
    if (shown.length > 0) html = shown.map(rowHtml).join('')
    else html = `<span class="emptyRow">${t('actEmpty')}</span>`
    // Replay section: history pages of the followed session below the live rows.
    if (act.replay) {
      const h = act.hist
      const tail = h.loading
        ? `<div class="actTail">${t('actRepLoading')}</div>`
        : h.failed
          ? `<div class="actTail err">${t('actRepFail')}</div>`
          : h.hasMore
            ? `<button class="actMore">${t('actRepMore')}</button>`
            : `<div class="actTail">${t('actRepOldest')}</div>`
      html += `<div class="actDiv">${t('actRepDivider')}</div>` + h.rows.map(rowHtml).join('') + tail
    }
    actList.innerHTML = html
  }

  /** Fetch one history page of the shown session (reset=true restarts at the tail). */
  const fetchHistory = async (reset: boolean): Promise<void> => {
    const sid = act.pinned ?? act.followId
    if (sid === '') return
    if (reset) {
      act.hist = { rows: [], hasMore: false, nextBeforeSeq: null, loading: true, failed: false }
    } else {
      act.hist.loading = true
      act.hist.failed = false
    }
    renderActList()
    try {
      const before = reset || act.hist.nextBeforeSeq === null ? '' : `&beforeSeq=${act.hist.nextBeforeSeq}`
      const r = await fetch(`/schematic/history?session=${encodeURIComponent(sid)}${before}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const page = await r.json() as { rows: any[]; hasMore: boolean; nextBeforeSeq: number | null }
      act.hist.rows = reset ? page.rows : act.hist.rows.concat(page.rows)
      act.hist.hasMore = page.hasMore
      act.hist.nextBeforeSeq = page.nextBeforeSeq
    } catch {
      act.hist.failed = true
    }
    act.hist.loading = false
    renderActList()
  }

  /** Last /schematic/stats.json snapshot; null until the stats view first loads. */
  let statSnap: any = null
  /** stats-view poll handle; runs only while the view is open. */
  let statTimer = 0
  /** Compact duration for the stats table (sums run to minutes). */
  const fmtDur = (ms: number): string =>
    ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
      : ms >= 10_000 ? `${Math.round(ms / 1000)}s`
        : ms >= 1_000 ? `${(ms / 1000).toFixed(1)}s`
          : `${ms}ms`

  /** The per-plugin monitoring table: window counters + in-flight gauge. */
  function renderStatsTable(): void {
    if (statSnap === null) {
      actList.innerHTML = `<span class="emptyRow">${t('actRepLoading')}</span>`
      return
    }
    const inflight = new Map<string | null, number>(
      (statSnap.inflight ?? []).map((x: any) => [x.module as string | null, x.n as number]))
    const cell = (s: any): string => {
      const badge = s.module !== null
        ? `<span class="md"${moduleColorCss(s.module) ? ` style="--mc: ${moduleColorCss(s.module)}"` : ''}>${esc(moduleShort(s.module))}</span>`
        : `<span class="md un">?</span>`
      const now = inflight.get(s.module) ?? 0
      return `<div class="actStRow"${s.module !== null ? ` data-module="${esc(s.module)}"` : ''} title="${esc(s.module ?? '')} · ${t('actStLast')} ${s.lastAt > 0 ? fmtTime(s.lastAt) : '—'}">`
        + `${badge}<span>${s.rows}</span><span>${s.toolCalls}</span><span${s.toolErrors > 0 ? ' class="er"' : ''}>${s.toolErrors}</span>`
        + `<span title="${t('actStMs')} max ${fmtDur(s.toolMaxMs)}">${fmtDur(s.toolMs)}</span><span>${s.llmCalls}</span>`
        + `<span${now > 0 ? ' class="nw"' : ''}>${now}</span></div>`
    }
    const stats: any[] = statSnap.stats ?? []
    actList.innerHTML = stats.length === 0
      ? `<span class="emptyRow">${t('actStEmpty')}</span>`
      : `<div class="actStRow hd"><span>${t('actStPlugin')}</span><span>${t('actStRows')}</span><span>${t('actStTool')}</span>`
        + `<span>${t('actStErr')}</span><span>${t('actStMs')}</span><span>${t('actStLlm')}</span><span>${t('actStNow')}</span></div>`
        + stats.map(cell).join('')
  }

  /** Refresh the stats snapshot; a failed fetch keeps the last good one. */
  const fetchStats = async (): Promise<void> => {
    try {
      const r = await fetch('/schematic/stats.json', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      statSnap = await r.json()
    } catch { /* keep the last good snapshot; next tick retries */ }
    if (act.stats) renderStatsTable()
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
    if (act.replay) void fetchHistory(true)
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
  const repBtn = $('.repBtn')
  repBtn.addEventListener('click', () => {
    act.replay = !act.replay
    repBtn.setAttribute('aria-pressed', String(act.replay))
    if (act.replay) void fetchHistory(true)
    else renderActList()
  })
  const statBtn = $('.statBtn')
  statBtn.addEventListener('click', () => {
    act.stats = !act.stats
    statBtn.setAttribute('aria-pressed', String(act.stats))
    // Poll only while the table is on; the counters are process-lifetime
    // monotonic, so a stopped view loses nothing (next open re-fetches).
    window.clearInterval(statTimer)
    if (act.stats) {
      void fetchStats()
      statTimer = window.setInterval(() => { void fetchStats() }, 2000)
    }
    renderActList()
  })
  // The load-earlier button lives inside actList, which is rebuilt wholesale —
  // delegate. It carries no data-module, so the row-click handler ignores it.
  actList.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('.actMore') === null) return
    if (!act.hist.loading) void fetchHistory(false)
  })
  // Clicking a row performs the same selection a pill click performs above:
  // the module's detail panel opens in whatever tab is showing. Rows whose
  // module is unmounted or unattributed fall back to the topo entry id they
  // carry — re-enabling queues through the workbench preview like any ⏻.
  // Stats-table rows share the interaction (closest matches both classes) but
  // never carry data-entry.
  actList.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest('.actRow, .actStRow') as HTMLElement | null
    if (row === null) return
    const module = row.dataset.module
    const n = module !== undefined ? byId.get(moduleIds.get(module)?.[0] ?? '') : undefined
    if (n !== undefined) {
      state.sel = n.id
      renderDetail(n)
      render()
      return
    }
    const entry = row.dataset.entry
    if (entry !== undefined) queueEnable(entry)
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
      if (act.replay) void fetchHistory(true)
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
  // The domains mesh re-renders instead of re-fitting: its packing ellipse
  // matches the canvas aspect, so a resize must re-layout to keep filling
  // (.stage stays static across renders for the same reason).
  if (typeof ResizeObserver !== 'undefined') {
    const journey = $('.journey') as Element | null
    if (journey !== null) {
      const ro = new ResizeObserver(() => { if (state.tab === 'journey') fitJourney(journeyZoom === 1) })
      ro.observe(journey)
      ac.signal.addEventListener('abort', () => ro.disconnect())
    }
    const stage = $('.stage') as Element | null
    if (stage !== null) {
      const ro = new ResizeObserver(() => { if (state.tab === 'domains') render(true) })
      ro.observe(stage)
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
      // highlight only what the timeline shows; a tool-end, a completed
      // assistant message, or a settled workflow run downgrades strong
      // (touchModule would keep it strong)
      if (entry.module !== null && entry.kind !== 'user' && shownEntry(sessionId)) {
        if (entry.kind === 'tool-end' || entry.kind === 'llm' || entry.kind === 'workflow-end') {
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
  // Popover dismissal: pointerdown (capture) so clicking another unresolved
  // pill closes-then-reopens cleanly.
  document.addEventListener('pointerdown', (e) => {
    if (pop.classList.contains('on') && !pop.contains(e.target as Node)) closePop()
  }, { ...sig, capture: true })
  // One capture-phase Escape stack keeps nested surfaces deterministic:
  // unresolved-key popover → drawer/prompt → scoped view → selection.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (pop.classList.contains('on')) {
      e.preventDefault(); e.stopPropagation(); closePop(); return
    }
    if ($('.editDrawer').classList.contains('on')) {
      e.preventDefault(); e.stopPropagation()
      if (configEditFor !== null) {
        if (cfgAskBack) {
          cfgAskBack = false
          renderDrawer()
          ;($('.editDrawer').querySelector('.ySrc') as HTMLElement | null)?.focus()
          return
        }
        const edId = configEditFor
        const raw = entryById.get(edId)?.config?.raw ?? ''
        const source = $('.editDrawer').querySelector<HTMLTextAreaElement>('.ySrc')
        if (source !== null) cfgDrafts.set(edId, source.value)
        if ((cfgDrafts.get(edId) ?? raw) !== raw) {
          cfgAskBack = true
          renderDrawer()
          ;($('.editDrawer').querySelector('.askResume') as HTMLElement | null)?.focus()
        } else {
          configEditFor = null
          renderDrawer()
        }
        return
      }
      if (draftPreview !== null) resetDraft()
      else { disabledList = false; renderDrawer() }
      return
    }
    if (state.scope) exitScope()
    else { state.sel = null; render() }
  }, { ...sig, capture: true })
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
  /**
   * Shell chrome the tab renders never rebuild — tab buttons, search
   * placeholder, activity chips, footer controls — so the toggle re-sets
   * their strings itself. Without this, chrome stays in the boot language.
   */
  const relocalizeShell = (): void => {
    const tabKeys: Record<string, string> = { journey: 'tabJourney', domains: 'tabDomains', table: 'tabTable' }
    for (const btn of container.querySelectorAll<HTMLButtonElement>('.tabBtn')) {
      const key = tabKeys[btn.dataset.tab ?? '']
      if (key !== undefined) btn.textContent = t(key)
    }
    ;($('.search') as HTMLInputElement).placeholder = t('searchPh')
    subBtn.textContent = t('actSub')
    subBtn.title = t('actSubTitle')
    sessSel.title = t('sessSelTitle')
    svcBtn.textContent = t('actSvc')
    svcBtn.title = t('actSvcTitle')
    repBtn.textContent = t('actRep')
    statBtn.textContent = t('actStats')
    statBtn.title = t('actStatsTitle')
    repBtn.title = t('actRepTitle')
    $('.legend').textContent = t('actLiveHint')
    updateExpBtn()
    $('.zoomFit').textContent = t('fit')
    $('.autoBtn').title = t('autoTitle')
    $('.refresh').title = t('refreshTitle')
    // stats is render-owned; only the pre-load "loading…" state needs help
    if (GRAPH === null) $('.stats').textContent = t('loading')
  }
  langToggle.addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh'
    try { localStorage.setItem('sch.lang', lang) } catch { /* storage unavailable: choice lasts for this page only */ }
    updateLangButton()
    relocalizeShell()
    setMeta()
    closePop() // re-opened on the next click, in the new language
    renderChips()
    render()
    refreshDetail()
    renderEditChrome()
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
