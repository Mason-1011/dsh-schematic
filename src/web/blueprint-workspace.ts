type Lang = 'en' | 'zh'

type BlueprintMeta = { id: string; name: string; desc: string | null; savedAt: string; memberCount: number; includeSchematic: boolean }
type Entry = {
  id: string; name: string; desc: string | null; groupPath: string | null; disabled: boolean; capability: string
  protected: { tier: string; reason: string } | null
  origin: { layer: string; label: string; managed: boolean }
  live: { state: string | null; provides: string[]; inject: string[] } | null
  config: { raw: string; value?: unknown; jsExprFields: string[] } | null
}
type Detail = {
  id: string
  document: { schema: 2; name: string; desc: string | null; includeSchematic: boolean; savedAt: string; world: string[]; members: { id: string; name: string; config: unknown | null }[] }
  memberYaml: Record<string, string>
  entries: Entry[]
  unmanaged: { id: string; name: string; disabled: boolean; capability: string }[]
}
type Draft = { name: string; desc: string; includeSchematic: boolean; memberIds: string[]; configs: Record<string, unknown>; yaml: Record<string, string> }

export interface BlueprintWorkspaceOptions {
  lang: () => Lang
  describe: (description: string | null) => string | null
  registerDescriptions: (descriptions: string[]) => void
  notify: (message: string) => void
  onSwitch: (id: string, name: string, ops: unknown[], report: unknown, adopted: string[]) => void
  onChanged: () => void
  onCreated?: () => void
}

export interface BlueprintWorkspaceController {
  refresh(): Promise<void>
  relocalize(): void
  openCreate(): void
  dispose(): void
}

const copy = {
  en: {
    title: 'Blueprints', subtitle: 'Desired capability compositions', create: 'New blueprint', import: 'Import YAML', empty: 'No blueprints yet',
    emptyBody: 'Capture the running system, copy a proven blueprint, or begin with the protected core.', choose: 'Choose a blueprint',
    name: 'Blueprint name', desc: 'What is this composition for?', current: 'CURRENT', diverged: 'DRIFTED', blocked: 'BLOCKED', members: 'members',
    save: 'Save blueprint', saved: 'Blueprint saved', switch: 'Switch to blueprint', noChanges: 'Already matches the running system',
    enabled: 'will be on', disabled: 'will be off', config: 'config updates', capability: 'Capabilities', advanced: 'Advanced YAML',
    model: 'Models', tools: 'Tools', memory: 'Memory & context', safety: 'Safety & policy', other: 'System extensions',
    liveOn: 'running', liveOff: 'stopped', protected: 'protected core', configure: 'Configure', draft: 'LOCAL DRAFT', discard: 'Discard draft',
    fromCurrent: 'Copy running system', fromCurrentD: 'Start with everything running now.', fromExisting: 'Copy selected blueprint', fromExistingD: 'Duplicate a proven composition.', blank: 'Protected core only', blankD: 'Start with no optional members.', cancel: 'Cancel',
    unmanaged: 'Unmanaged additions', unmanagedD: 'These appeared after the blueprint was saved. Decide before switching.', keep: 'Keep as-is', stop: 'Disable this time', include: 'Add to blueprint', continue: 'Continue preflight',
    readonly: 'Editing is available on desktop (768 px or wider).', invalid: 'The server rejected this draft: ', imported: 'Blueprint imported', export: 'Export', duplicate: 'Duplicate', remove: 'Delete', more: 'Blueprint actions',
    merge: 'Merge selected live changes', drift: 'Live drift', saveFirst: 'Save or discard the local draft before switching.',
    whyLocked: 'Why is this locked?', pluginAbout: 'Plugin details', provides: 'Provides', depends: 'Depends on', source: 'Source', noDescription: 'No package description is available.',
    schematic: 'Mount Schematic', schematicOn: 'Editor available', schematicOff: 'Editor offline', schematicD: 'Keep the visual topology and blueprint editor mounted with this composition.', schematicWarn: 'Applying this blueprint will disconnect this page. Restoring Schematic requires another profile switch or a manual config edit.',
  },
  zh: {
    title: '蓝图', subtitle: '插件能力与配置的期望组合', create: '新建蓝图', import: '导入 YAML', empty: '还没有蓝图',
    emptyBody: '从当前运行系统开始、复制成熟蓝图，或只保留受保护核心。', choose: '选择一张蓝图',
    name: '蓝图名称', desc: '这套组合用来做什么？', current: '正在使用', diverged: '已偏离', blocked: '已阻塞', members: '个成员',
    save: '保存蓝图', saved: '蓝图已保存', switch: '切换到此蓝图', noChanges: '当前系统已与蓝图一致',
    enabled: '将启用', disabled: '将停用', config: '配置更新', capability: '能力组装', advanced: '高级 YAML',
    model: '模型', tools: '工具', memory: '记忆与上下文', safety: '安全与策略', other: '系统扩展',
    liveOn: '运行中', liveOff: '已停止', protected: '受保护核心', configure: '配置', draft: '本地草稿', discard: '丢弃草稿',
    fromCurrent: '复制当前系统', fromCurrentD: '以此刻正在运行的全部能力开始。', fromExisting: '复制所选蓝图', fromExistingD: '从已经验证的组合继续。', blank: '仅保留核心', blankD: '不含任何可选成员。', cancel: '取消',
    unmanaged: '未管理的新增插件', unmanagedD: '它们在蓝图保存后出现。切换前请明确决定。', keep: '保持原状', stop: '本次停用', include: '纳入蓝图', continue: '继续预检',
    readonly: '编辑需要桌面视口（宽度至少 768 px）。', invalid: '服务端拒绝了这份草稿：', imported: '蓝图已导入', export: '导出', duplicate: '复制', remove: '删除', more: '蓝图操作',
    merge: '合并选中的实时变化', drift: '实时偏离', saveFirst: '切换前请先保存或丢弃本地草稿。',
    whyLocked: '为什么无法勾选？', pluginAbout: '插件说明', provides: '提供能力', depends: '依赖能力', source: '配置来源', noDescription: '该插件没有提供说明。',
    schematic: '搭载 Schematic', schematicOn: '编辑器可用', schematicOff: '编辑器离线', schematicD: '让这套组合继续搭载实时拓扑与蓝图编辑器。', schematicWarn: '应用这张蓝图后当前页面会断开。恢复 Schematic 需要切换其他 profile 或手工修改配置。',
  },
} as const

const protectedCopy = {
  en: {
    self: 'This is the schematic editor itself. Disabling it would close this interface and require manual recovery.',
    hotReload: 'Required by hot reload, which safely applies changes and performs rollback.',
    pageServer: 'Serves this page. Disabling it would immediately disconnect the editor.',
    spaRoster: 'Part of the application runtime or transport needed to keep this interface working.',
    settingsSecrets: 'Carries settings or credentials required by other plugins.',
    durability: 'Protects session or storage durability. Disabling it can make running work unavailable.',
    manyDependents: 'Many running plugins depend on a service provided here, so blueprints cannot disable it directly.',
  },
  zh: {
    self: '这是 schematic 编辑器自身。停用后界面会断开，只能手工恢复配置。',
    hotReload: '安全应用变更和自动回滚依赖这项热重载基础设施。',
    pageServer: '它负责提供当前页面，停用会立即断开编辑器。',
    spaRoster: '它属于应用运行时或通信链路，是维持当前界面工作的必要组件。',
    settingsSecrets: '它承载其他插件需要的设置或凭据。',
    durability: '它保障会话或存储持久性，停用可能导致正在进行的工作不可用。',
    manyDependents: '大量运行中插件依赖它提供的服务，因此蓝图不能直接将其停用。',
  },
} as const

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function mountBlueprintWorkspace(root: HTMLElement, options: BlueprintWorkspaceOptions): BlueprintWorkspaceController {
  let metas: BlueprintMeta[] = []
  let compose: any = null
  let detail: Detail | null = null
  let selected = ''
  let draft: Draft | null = null
  let createOpen = false
  let unmanaged: Detail['unmanaged'] = []
  let decisions: Record<string, 'keep' | 'disable' | 'include'> = {}
  let renderedDiffs: ReturnType<typeof liveDiffs> = []
  let infoOpenId: string | null = null
  const t = (key: keyof typeof copy.en): string => copy[options.lang()][key]
  const protectedReason = (reason: string): string => protectedCopy[options.lang()][reason as keyof typeof protectedCopy.en] ?? (options.lang() === 'zh' ? '该插件是运行系统的受保护核心，不能由蓝图停用。' : 'This plugin is protected runtime core and cannot be disabled by a blueprint.')
  const writable = (): boolean => window.matchMedia('(min-width: 768px)').matches && compose?.editable === true
  const draftKey = (): string => `sch.blueprint.draft:${compose?.profile?.name ?? 'default'}:${selected}`
  const request = async (path: string, init?: RequestInit): Promise<any> => {
    const response = await fetch('/schematic/' + path, init)
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? String(response.status))
    return body
  }
  const post = (action: string, body: unknown): Promise<any> => request(`blueprints/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const persist = (): void => { if (draft !== null && selected !== '') try { localStorage.setItem(draftKey(), JSON.stringify(draft)) } catch {} }
  const loadDetail = async (id: string): Promise<void> => {
    selected = id
    detail = await request(`blueprints/detail?id=${encodeURIComponent(id)}`) as Detail
    options.registerDescriptions(detail.entries.flatMap((entry) => entry.desc ? [entry.desc] : []))
    const fresh: Draft = {
      name: detail.document.name, desc: detail.document.desc ?? '', includeSchematic: detail.document.includeSchematic, memberIds: detail.document.members.map((m) => m.id),
      configs: Object.fromEntries(detail.document.members.map((m) => [m.id, clone(m.config)])), yaml: { ...detail.memberYaml },
    }
    try {
      draft = JSON.parse(localStorage.getItem(draftKey()) ?? 'null') as Draft | null ?? fresh
      if (typeof draft.includeSchematic !== 'boolean') draft.includeSchematic = fresh.includeSchematic
    } catch { draft = fresh }
    unmanaged = []
    render()
  }
  const counts = (): { on: number; off: number; config: number } => {
    if (draft === null || detail === null) return { on: 0, off: 0, config: 0 }
    const ids = new Set(draft.memberIds)
    const world = new Set(detail.document.world)
    let on = 0; let off = 0; let config = 0
    const schematicRunning = detail.entries.some((entry) => entry.id === 'schematic' && !entry.disabled)
    if (draft.includeSchematic !== schematicRunning) draft.includeSchematic ? on++ : off++
    for (const entry of detail.entries) {
      if (ids.has(entry.id) && entry.disabled) on++
      if (!ids.has(entry.id) && !entry.disabled && entry.protected === null && world.has(entry.id)) off++
      const original = detail.document.members.find((member) => member.id === entry.id)?.config
      if (ids.has(entry.id) && JSON.stringify(original ?? null) !== JSON.stringify(draft.configs[entry.id] ?? null)) config++
    }
    return { on, off, config }
  }
  const liveDiffs = (): { id: string; kind: 'membership' | 'config' | 'schematic'; label: string; entry?: Entry }[] => {
    if (draft === null || detail === null) return []
    const memberIds = new Set(draft.memberIds); const world = new Set(detail.document.world)
    const out: { id: string; kind: 'membership' | 'config' | 'schematic'; label: string; entry?: Entry }[] = []
    const schematicRunning = detail.entries.some((entry) => entry.id === 'schematic' && !entry.disabled)
    if (draft.includeSchematic !== schematicRunning) {
      out.push({ id: 'schematic', kind: 'schematic', label: `${draft.includeSchematic ? '+' : '−'} schematic` })
    }
    for (const entry of detail.entries) {
      if (!world.has(entry.id) || entry.protected !== null) continue
      const desired = memberIds.has(entry.id); const running = !entry.disabled
      if (desired !== running) out.push({ id: entry.id, kind: 'membership', label: running ? `+ ${entry.id}` : `− ${entry.id}`, entry })
      if (desired && running && JSON.stringify(draft.configs[entry.id] ?? null) !== JSON.stringify(entry.config?.value ?? null)) out.push({ id: entry.id, kind: 'config', label: `~ ${entry.id}`, entry })
    }
    return out
  }
  const field = (id: string, path: string, value: unknown): string => {
    if (value !== null && typeof value === 'object') return ''
    if (typeof value === 'boolean') return `<label class="bpField bpBool"><input type="checkbox" data-config="${esc(id)}" data-path="${esc(path)}" ${value ? 'checked' : ''}><span>${esc(path)}</span></label>`
    const type = typeof value === 'number' ? 'number' : 'text'
    return `<label class="bpField"><span>${esc(path)}</span><input type="${type}" data-config="${esc(id)}" data-path="${esc(path)}" value="${esc(value ?? '')}"></label>`
  }
  const flatten = (id: string, value: unknown, prefix = ''): string => {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || '__jsExpr' in (value as object)) return ''
    return Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      if (key.includes('.') || key === '__proto__' || key === 'prototype' || key === 'constructor') return ''
      const path = prefix === '' ? key : `${prefix}.${key}`
      return child !== null && typeof child === 'object' && !Array.isArray(child) && !('__jsExpr' in child) ? flatten(id, child, path) : field(id, path, child)
    }).join('')
  }
  const setPath = (object: Record<string, unknown>, path: string, value: unknown): void => {
    const parts = path.split('.'); let cursor = object
    if (parts.some((part) => part === '__proto__' || part === 'prototype' || part === 'constructor')) return
    for (const part of parts.slice(0, -1)) cursor = (cursor[part] ??= {}) as Record<string, unknown>
    cursor[parts.at(-1)!] = value
  }
  const render = (): void => {
    const c = counts(); const active = compose?.blueprint; const diffs = liveDiffs(); renderedDiffs = diffs
    const list = metas.map((meta) => `<button class="bpCard ${meta.id === selected ? 'selected' : ''}" data-select="${esc(meta.id)}"><span><b>${esc(meta.name)}</b>${active?.id === meta.id ? `<em>${active.diverged ? t('diverged') : t('current')}</em>` : ''}</span><small>${meta.memberCount} ${t('members')} · SCH ${meta.includeSchematic ? 'ON' : 'OFF'} · ${esc(meta.savedAt.slice(0, 10))}</small><p>${esc(meta.desc ?? '')}</p></button>`).join('')
    const groups = detail === null || draft === null ? '' : ['model', 'tools', 'memory', 'safety', 'other'].map((capability) => {
      const rows = detail!.entries.filter((entry) => entry.capability === capability).map((entry) => {
        const member = draft!.memberIds.includes(entry.id)
        const form = member ? flatten(entry.id, draft!.configs[entry.id]) : ''
        const lockId = `bp-lock-${entry.id}`; const infoId = `bp-info-${entry.id}`
        const lock = entry.protected ? `<span class="bpLockTip" id="${esc(lockId)}" role="tooltip"><b>${t('whyLocked')}</b>${esc(protectedReason(entry.protected.reason))}</span>` : ''
        const provides = entry.live?.provides ?? []; const inject = entry.live?.inject ?? []
        const info = `<div class="bpEntryInfo" id="${esc(infoId)}" role="tooltip"><span>${t('pluginAbout')}</span><p>${esc(options.describe(entry.desc) ?? t('noDescription'))}</p><dl><dt>${t('source')}</dt><dd>${esc(entry.origin.label)}</dd>${provides.length ? `<dt>${t('provides')}</dt><dd>${esc(provides.join(', '))}</dd>` : ''}${inject.length ? `<dt>${t('depends')}</dt><dd>${esc(inject.join(', '))}</dd>` : ''}</dl></div>`
        return `<article class="bpEntry ${member ? 'member' : ''} ${infoOpenId === entry.id ? 'infoOpen' : ''}"><div class="bpEntryMain"><span class="bpCheckWrap ${entry.protected ? 'locked' : ''}" ${entry.protected ? `tabindex="0" aria-describedby="${esc(lockId)}"` : ''}><input id="bp-member-${esc(entry.id)}" type="checkbox" data-member="${esc(entry.id)}" ${member ? 'checked' : ''} ${entry.protected ? `disabled aria-describedby="${esc(lockId)}"` : ''}>${lock}</span><span class="bpSignal ${entry.disabled ? 'off' : ''}"></span><span class="bpIdentity"><label for="bp-member-${esc(entry.id)}"><b>${esc(entry.id)}</b></label><button type="button" class="bpPluginName" data-info="${esc(entry.id)}" aria-expanded="${String(infoOpenId === entry.id)}" aria-describedby="${esc(infoId)}">${esc(entry.name)}</button>${info}</span><em>${entry.protected ? t('protected') : entry.disabled ? t('liveOff') : t('liveOn')}</em></div>${member && (form !== '' || entry.config !== null) ? `<details class="bpConfig"><summary>${t('configure')}</summary><div class="bpForm">${form || `<p>${t('advanced')}</p>`}</div><label class="bpYaml"><span>${t('advanced')}</span><textarea data-yaml="${esc(entry.id)}" spellcheck="false">${esc(draft!.yaml[entry.id] ?? entry.config?.raw ?? '')}</textarea></label></details>` : ''}</article>`
      }).join('')
      return rows === '' ? '' : `<section class="bpGroup"><header><span>${t(capability as keyof typeof copy.en)}</span><b>${detail!.entries.filter((entry) => entry.capability === capability && draft!.memberIds.includes(entry.id)).length}/${detail!.entries.filter((entry) => entry.capability === capability && entry.protected === null).length}</b></header>${rows}</section>`
    }).join('')
    const unmanagedPanel = unmanaged.length === 0 ? '' : `<div class="bpUnmanaged"><h3>${t('unmanaged')}</h3><p>${t('unmanagedD')}</p>${unmanaged.map((entry) => `<label><span><b>${esc(entry.id)}</b><small>${esc(entry.name)}</small></span><select data-decision="${esc(entry.id)}"><option value="keep">${t('keep')}</option><option value="disable">${t('stop')}</option><option value="include">${t('include')}</option></select></label>`).join('')}<button class="primaryAction bpContinue">${t('continue')}</button></div>`
    const schematicControl = detail === null || draft === null ? '' : `<section class="bpRuntime ${draft.includeSchematic ? 'on' : 'off'}"><div><span class="bpRuntimeMark" aria-hidden="true">SCH</span><span><b>${t('schematic')}</b><small>${t('schematicD')}</small></span></div><label class="bpSchToggle"><input class="blueprintWrite" type="checkbox" data-schematic ${draft.includeSchematic ? 'checked' : ''}><span aria-hidden="true"></span><em>${draft.includeSchematic ? t('schematicOn') : t('schematicOff')}</em></label>${draft.includeSchematic ? '' : `<p>${t('schematicWarn')}</p>`}</section>`
    root.innerHTML = `<aside class="bpRail"><header><span><b>${t('title')}</b><small>${t('subtitle')}</small></span><button class="bpNew blueprintWrite">＋</button></header><div class="bpList">${list || `<div class="bpEmptySmall">${t('empty')}</div>`}</div><div class="bpRailFoot"><button class="bpImport blueprintWrite">${t('import')}</button><input class="bpImportFile" type="file" accept=".yml,.yaml,text/yaml" hidden></div></aside>` +
      (detail === null || draft === null ? `<section class="bpEmpty"><span>BLUEPRINT / 00</span><h2>${metas.length === 0 ? t('empty') : t('choose')}</h2><p>${t('emptyBody')}</p><button class="primaryAction bpNew blueprintWrite">${t('create')}</button></section>` : `<section class="bpEditor"><header class="bpEditorHead"><div><span>${localStorage.getItem(draftKey()) ? t('draft') : 'BLUEPRINT / 02'}</span><input class="bpName blueprintWrite" value="${esc(draft.name)}" maxlength="80"><textarea class="bpDesc blueprintWrite" maxlength="200" placeholder="${t('desc')}">${esc(draft.desc)}</textarea></div><details class="bpMenu"><summary aria-label="${t('more')}">•••</summary><button data-action="duplicate">${t('duplicate')}</button><button data-action="export">${t('export')}</button><button data-action="delete">${t('remove')}</button></details></header><div class="bpGroups">${schematicControl}${groups}</div></section><aside class="bpImpact">${unmanagedPanel || `<span>CHANGESET</span><h2>${draft.name}</h2>${active?.id === selected && diffs.length > 0 ? `<section class="bpDrift"><h3>${t('drift')}</h3>${diffs.map((diff, index) => `<label><input type="checkbox" data-merge="${index}" checked><span>${esc(diff.label)}</span></label>`).join('')}<button class="bpMerge blueprintWrite">${t('merge')}</button></section>` : ''}<div class="bpMetric"><b>+${c.on}</b><span>${t('enabled')}</span></div><div class="bpMetric"><b>−${c.off}</b><span>${t('disabled')}</span></div><div class="bpMetric"><b>~${c.config}</b><span>${t('config')}</span></div><div class="bpImpactActions">${!writable() ? `<p>${t('readonly')}</p>` : ''}<button class="bpSave blueprintWrite">${t('save')}</button><button class="primaryAction bpSwitch blueprintWrite">${t('switch')}</button><button class="bpDiscard">${t('discard')}</button></div>`}</aside>`)+
      (createOpen ? `<div class="bpCreateOverlay"><section><span>BLUEPRINT / NEW</span><h2>${t('create')}</h2><label><span>${t('name')}</span><input class="bpCreateName" maxlength="80" autofocus></label><label class="bpCreateSch"><input type="checkbox" checked><span><b>${t('schematic')}</b><small>${t('schematicD')}</small></span></label><div class="bpStart"><button data-start="current"><b>${t('fromCurrent')}</b><small>${t('fromCurrentD')}</small></button><button data-start="copy" ${selected === '' ? 'disabled' : ''}><b>${t('fromExisting')}</b><small>${t('fromExistingD')}</small></button><button data-start="blank"><b>${t('blank')}</b><small>${t('blankD')}</small></button></div><button class="bpCreateCancel">${t('cancel')}</button></section></div>` : '')
    bind()
  }
  const bind = (): void => {
    if (!writable()) root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('.blueprintWrite,[data-member],[data-config],[data-yaml]').forEach((control) => { control.disabled = true })
    root.querySelectorAll<HTMLElement>('.bpNew').forEach((button) => { button.onclick = () => { createOpen = true; render() } })
    root.querySelectorAll<HTMLButtonElement>('[data-select]').forEach((button) => { button.onclick = () => { void loadDetail(button.dataset.select!) } })
    root.querySelector('.bpCreateCancel')?.addEventListener('click', () => { createOpen = false; render() })
    root.querySelectorAll<HTMLButtonElement>('[data-start]').forEach((button) => { button.onclick = async () => {
      const name = (root.querySelector('.bpCreateName') as HTMLInputElement).value.trim(); if (name === '') return options.notify(t('name'))
      const includeSchematic = (root.querySelector('.bpCreateSch input') as HTMLInputElement | null)?.checked ?? true
      try {
        if (button.dataset.start === 'copy') await post('duplicate', { id: selected, name, includeSchematic })
        else await post('save', { name, includeSchematic, memberIds: button.dataset.start === 'blank' ? [] : undefined })
        createOpen = false; options.onCreated?.(); await refresh(); options.onChanged()
      } catch (error) { options.notify(String(error instanceof Error ? error.message : error)) }
    } })
    root.querySelectorAll<HTMLInputElement>('[data-member]').forEach((input) => { input.onchange = () => {
      if (draft === null) return
      const scrollTop = root.querySelector<HTMLElement>('.bpGroups')?.scrollTop ?? 0
      const restoreFocus = document.activeElement === input; const memberId = input.dataset.member!
      const ids = new Set(draft.memberIds); input.checked ? ids.add(memberId) : ids.delete(memberId); draft.memberIds = [...ids]; persist(); render()
      const groups = root.querySelector<HTMLElement>('.bpGroups'); if (groups) groups.scrollTop = scrollTop
      if (restoreFocus) {
        const next = [...root.querySelectorAll<HTMLInputElement>('[data-member]')].find((candidate) => candidate.dataset.member === memberId)
        next?.focus({ preventScroll: true }); if (groups) groups.scrollTop = scrollTop
      }
    } })
    root.querySelectorAll<HTMLButtonElement>('[data-info]').forEach((button) => { button.onclick = (event) => {
      event.stopPropagation(); infoOpenId = infoOpenId === button.dataset.info ? null : button.dataset.info!
      root.querySelectorAll<HTMLElement>('.bpEntry').forEach((row) => row.classList.toggle('infoOpen', row.querySelector('[data-info]')?.getAttribute('data-info') === infoOpenId))
      root.querySelectorAll<HTMLButtonElement>('[data-info]').forEach((control) => control.setAttribute('aria-expanded', String(control.dataset.info === infoOpenId)))
    }; button.onkeydown = (event) => { if (event.key === 'Escape') { infoOpenId = null; button.setAttribute('aria-expanded', 'false'); button.closest('.bpEntry')?.classList.remove('infoOpen') } } })
    const name = root.querySelector<HTMLInputElement>('.bpName'); if (name) name.oninput = () => { if (draft) { draft.name = name.value; persist() } }
    const desc = root.querySelector<HTMLTextAreaElement>('.bpDesc'); if (desc) desc.oninput = () => { if (draft) { draft.desc = desc.value; persist() } }
    const schematic = root.querySelector<HTMLInputElement>('[data-schematic]'); if (schematic) schematic.onchange = () => {
      if (!draft) return
      draft.includeSchematic = schematic.checked
      persist()
      render()
      root.querySelector<HTMLInputElement>('[data-schematic]')?.focus({ preventScroll: true })
    }
    root.querySelectorAll<HTMLInputElement>('[data-config]').forEach((input) => { input.oninput = () => {
      if (draft === null) return; const id = input.dataset.config!; const object = clone((draft.configs[id] ?? {}) as Record<string, unknown>); const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value; setPath(object, input.dataset.path!, value); draft.configs[id] = object; delete draft.yaml[id]; persist()
    } })
    root.querySelectorAll<HTMLTextAreaElement>('[data-yaml]').forEach((area) => { area.oninput = () => { if (draft) { draft.yaml[area.dataset.yaml!] = area.value; persist() } } })
    root.querySelector('.bpSave')?.addEventListener('click', async () => { if (!draft || !detail) return; try { await post('save', { id: selected, name: draft.name, desc: draft.desc, includeSchematic: draft.includeSchematic, memberIds: draft.memberIds, memberConfigs: draft.configs, memberConfigYaml: draft.yaml }); localStorage.removeItem(draftKey()); options.notify(t('saved')); await refresh(); options.onChanged() } catch (error) { options.notify(t('invalid') + (error instanceof Error ? error.message : String(error))) } })
    root.querySelector('.bpSwitch')?.addEventListener('click', () => { void beginSwitch() })
    root.querySelector('.bpDiscard')?.addEventListener('click', () => { localStorage.removeItem(draftKey()); if (selected) void loadDetail(selected) })
    root.querySelector('.bpMerge')?.addEventListener('click', () => {
      if (!draft) return
      const ids = new Set(draft.memberIds)
      root.querySelectorAll<HTMLInputElement>('[data-merge]:checked').forEach((input) => {
        const diff = renderedDiffs[Number(input.dataset.merge)]; if (!diff) return
        if (diff.kind === 'schematic') draft!.includeSchematic = detail!.entries.some((entry) => entry.id === 'schematic' && !entry.disabled)
        else if (diff.kind === 'membership' && diff.entry) diff.entry.disabled ? ids.delete(diff.id) : ids.add(diff.id)
        else if (diff.entry) { draft!.configs[diff.id] = clone(diff.entry.config?.value ?? null); draft!.yaml[diff.id] = diff.entry.config?.raw ?? '' }
      })
      draft.memberIds = [...ids]; persist(); render()
    })
    root.querySelectorAll<HTMLSelectElement>('[data-decision]').forEach((select) => { select.onchange = () => { decisions[select.dataset.decision!] = select.value as typeof decisions[string] } })
    root.querySelector('.bpContinue')?.addEventListener('click', () => { void continueSwitch() })
    root.querySelector('.bpImport')?.addEventListener('click', () => (root.querySelector('.bpImportFile') as HTMLInputElement).click())
    const file = root.querySelector<HTMLInputElement>('.bpImportFile'); if (file) file.onchange = async () => { const picked = file.files?.[0]; if (picked) await importFile(picked) }
    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => { button.onclick = () => { void action(button.dataset.action!) } })
  }
  const beginSwitch = async (): Promise<void> => {
    try {
      if (localStorage.getItem(draftKey()) !== null) return options.notify(t('saveFirst'))
      const result = await post('materialize', { id: selected }); if (result.report?.newEntries?.length) { unmanaged = result.report.newEntries.map((row: any) => detail!.unmanaged.find((entry) => entry.id === row.id) ?? row); decisions = Object.fromEntries(unmanaged.map((entry) => [entry.id, 'keep'])); render(); return } dispatchSwitch(result)
    } catch (error) { options.notify(String(error instanceof Error ? error.message : error)) }
  }
  const continueSwitch = async (): Promise<void> => { try { dispatchSwitch(await post('materialize', { id: selected, decisions })) } catch (error) { options.notify(String(error instanceof Error ? error.message : error)) } }
  const dispatchSwitch = (result: any): void => {
    if (result.ops.length === 0 && !(result.adopted?.length > 0)) {
      void post('current', { id: result.id })
        .then(() => { options.notify(t('noChanges')); options.onChanged() })
        .catch((error) => options.notify(String(error)))
      return
    }
    unmanaged = []
    options.onSwitch(result.id, result.name, result.ops, result.report, result.adopted ?? [])
  }
  const action = async (name: string): Promise<void> => {
    try {
      if (name === 'export') { const response = await fetch(`/schematic/blueprints/export?id=${encodeURIComponent(selected)}`); const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${detail?.document.name ?? 'blueprint'}.yaml`; a.click(); URL.revokeObjectURL(url); return }
      if (name === 'duplicate') { createOpen = true; render(); return }
      if (name === 'delete' && window.confirm(`${t('remove')} “${detail?.document.name}”?`)) { await post('delete', { id: selected }); selected = ''; detail = null; draft = null; await refresh(); options.onChanged() }
    } catch (error) { options.notify(String(error instanceof Error ? error.message : error)) }
  }
  const importFile = async (file: File): Promise<void> => {
    if (!writable()) return options.notify(t('readonly'))
    try {
      await post('import', { yaml: await file.text() })
      options.notify(t('imported'))
      await refresh()
      options.onChanged()
    } catch (error) { options.notify(String(error instanceof Error ? error.message : error)) }
  }
  const refresh = async (): Promise<void> => { try { const [model, list] = await Promise.all([request('compose.json'), request('blueprints')]); compose = model; metas = list.blueprints ?? []; const next = selected && metas.some((item) => item.id === selected) ? selected : model.blueprint?.id ?? metas[0]?.id ?? ''; if (next) await loadDetail(next); else { selected = ''; detail = null; draft = null; render() } } catch (error) { root.innerHTML = `<div class="bpEmpty"><h2>${esc(error instanceof Error ? error.message : error)}</h2></div>` } }
  root.ondragover = (event) => { if (!writable() || !event.dataTransfer?.types.includes('Files')) return; event.preventDefault(); root.classList.add('dragging') }
  root.ondragleave = () => root.classList.remove('dragging')
  root.ondrop = (event) => { root.classList.remove('dragging'); const file = event.dataTransfer?.files[0]; if (!file) return; event.preventDefault(); if (!writable()) return options.notify(t('readonly')); void importFile(file) }
  root.onclick = (event) => { if (!(event.target as Element).closest?.('[data-info]')) { infoOpenId = null; root.querySelectorAll('.bpEntry.infoOpen').forEach((row) => row.classList.remove('infoOpen')); root.querySelectorAll('[data-info][aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false')) } }
  const controller: BlueprintWorkspaceController = { refresh, relocalize: render, openCreate: () => { createOpen = true; render() }, dispose: () => { root.onclick = null; root.innerHTML = '' } }
  return controller
}

export const BLUEPRINT_CSS = `
.sch .blueprintWorkspace{grid-template-columns:260px minmax(380px,1fr) 290px;grid-template-rows:minmax(0,1fr);overflow:hidden;background:var(--page)}.sch .blueprintWorkspace.dragging::after{content:"DROP YAML TO IMPORT";position:absolute;inset:14px;z-index:20;display:grid;place-items:center;border:2px dashed var(--change);background:color-mix(in srgb,var(--surface-1) 90%,transparent);color:var(--change);font:700 12px ui-monospace,monospace;letter-spacing:.12em;pointer-events:none}.sch .bpRail,.sch .bpImpact{width:auto;background:var(--surface-1);min-width:0;min-height:0}.sch .bpRail{padding:0;overflow:hidden;border-left:0;border-right:1px solid var(--border);display:flex;flex-direction:column}.sch .bpRail>header{display:flex;align-items:center;justify-content:space-between;padding:22px 18px 14px}.sch .bpRail>header span{display:flex;flex-direction:column}.sch .bpRail>header b{font-size:16px}.sch .bpRail>header small{color:var(--ink-3);font-size:10px;margin-top:3px}.sch .bpRail>header button{width:30px;height:30px;padding:0}.sch .bpList{flex:1;min-height:0;overflow:auto;padding:4px 9px}.sch .bpCard{display:block;width:100%;text-align:left;border:1px solid transparent;background:transparent;padding:11px 10px;margin:2px 0}.sch .bpCard:hover{background:var(--surface-2)}.sch .bpCard.selected{background:var(--live-soft);border-color:color-mix(in srgb,var(--live) 34%,var(--border))}.sch .bpCard>span{display:flex;align-items:center;justify-content:space-between;gap:6px}.sch .bpCard b{font-size:12px}.sch .bpCard em{font:700 8px ui-monospace,monospace;color:var(--live);font-style:normal}.sch .bpCard small,.sch .bpCard p{display:block;color:var(--ink-3);font-size:10px}.sch .bpCard p{margin:4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sch .bpRailFoot{padding:12px 18px;border-top:1px solid var(--border)}.sch .bpRailFoot button{width:100%;background:transparent}
.sch .bpEditor{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}.sch .bpEditorHead{padding:24px 28px 16px;border-bottom:1px solid var(--border);display:flex;gap:16px;justify-content:space-between;background:color-mix(in srgb,var(--surface-1) 74%,transparent)}.sch .bpEditorHead>div{display:flex;flex-direction:column;flex:1}.sch .bpEditorHead>div>span,.sch .bpImpact>span,.sch .bpEmpty>span,.sch .bpCreateOverlay section>span{font:700 9px ui-monospace,monospace;letter-spacing:.14em;color:var(--live)}.sch .bpName{border:0;background:transparent;padding:5px 0;font:700 25px/1.1 "Avenir Next Condensed",sans-serif}.sch .bpDesc{border:0;background:transparent;resize:none;padding:2px 0;height:34px;color:var(--ink-2)}.sch .bpMenu{position:relative}.sch .bpMenu summary{list-style:none;cursor:pointer;padding:5px 9px;border:1px solid var(--border)}.sch .bpMenu[open]{display:flex;flex-direction:column;gap:3px}.sch .bpMenu button{white-space:nowrap;text-align:left}.sch .bpGroups{flex:1;min-height:0;overflow:auto;overflow-anchor:none;padding:17px 28px 40px}.sch .bpRuntime{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 18px;align-items:center;margin:0 0 24px;padding:14px 15px;border:1px solid color-mix(in srgb,var(--live) 34%,var(--border));border-left:3px solid var(--live);background:color-mix(in srgb,var(--live) 5%,var(--surface-1))}.sch .bpRuntime.off{border-color:color-mix(in srgb,var(--warn) 42%,var(--border));border-left-color:var(--warn);background:color-mix(in srgb,var(--warn) 6%,var(--surface-1))}.sch .bpRuntime>div{display:flex;align-items:center;gap:11px;min-width:0}.sch .bpRuntimeMark{display:grid;place-items:center;width:36px;height:36px;border:1px solid currentColor;color:var(--live);font:800 9px ui-monospace,monospace;letter-spacing:.1em}.sch .bpRuntime.off .bpRuntimeMark{color:var(--warn)}.sch .bpRuntime>div>span:last-child{display:flex;flex-direction:column;gap:3px}.sch .bpRuntime small{color:var(--ink-3);font-size:10px;line-height:1.35}.sch .bpRuntime>p{grid-column:1/-1;margin:0;padding-top:9px;border-top:1px solid color-mix(in srgb,var(--warn) 28%,transparent);color:var(--warn);font-size:10px;line-height:1.45}.sch .bpSchToggle{display:grid;grid-template-columns:32px auto;align-items:center;gap:7px;cursor:pointer}.sch .bpSchToggle input{position:absolute;opacity:0;pointer-events:none}.sch .bpSchToggle>span{position:relative;width:30px;height:16px;border:1px solid var(--border);border-radius:99px;background:var(--surface-2);transition:background .18s ease,border-color .18s ease}.sch .bpSchToggle>span::after{content:"";position:absolute;left:2px;top:2px;width:10px;height:10px;border-radius:50%;background:var(--ink-3);transition:transform .18s ease,background .18s ease}.sch .bpSchToggle input:checked+span{border-color:var(--live);background:color-mix(in srgb,var(--live) 18%,var(--surface-2))}.sch .bpSchToggle input:checked+span::after{transform:translateX(14px);background:var(--live)}.sch .bpSchToggle input:focus-visible+span{outline:2px solid var(--change);outline-offset:3px}.sch .bpSchToggle em{grid-column:1/-1;text-align:center;font:700 8px ui-monospace,monospace;color:var(--ink-3);font-style:normal;text-transform:uppercase}.sch .bpGroup{margin-bottom:22px}.sch .bpGroup>header{display:flex;justify-content:space-between;padding:0 2px 7px;color:var(--ink-3);font:700 10px ui-monospace,monospace;letter-spacing:.08em;border-bottom:1px solid var(--border)}.sch .bpEntry{position:relative;border-bottom:1px solid var(--grid)}.sch .bpEntry:hover,.sch .bpEntry.infoOpen{z-index:7}.sch .bpEntryMain{min-height:52px;display:grid;grid-template-columns:18px 9px minmax(0,1fr) auto;align-items:center;gap:10px;padding:0 4px}.sch .bpCheckWrap{position:relative;width:18px;height:24px;display:grid;place-items:center}.sch .bpCheckWrap.locked{cursor:help}.sch .bpLockTip{position:absolute;left:-7px;top:30px;z-index:10;width:min(310px,55vw);padding:11px 12px;border:1px solid color-mix(in srgb,var(--warn) 45%,var(--border));border-left:3px solid var(--warn);background:var(--surface-1);box-shadow:0 14px 36px #0004;color:var(--ink-2);font:11px/1.5 "Avenir Next","Noto Sans SC",sans-serif;opacity:0;visibility:hidden;transform:translateY(-4px);transition:opacity .14s ease,transform .14s ease,visibility .14s}.sch .bpLockTip b{display:block;margin-bottom:3px;color:var(--warn);font-size:11px}.sch .bpCheckWrap.locked:hover .bpLockTip,.sch .bpCheckWrap.locked:focus .bpLockTip,.sch .bpCheckWrap.locked:focus-within .bpLockTip{opacity:1;visibility:visible;transform:translateY(0)}.sch .bpIdentity{position:relative;min-width:0;display:flex;flex-direction:column}.sch .bpIdentity label{width:max-content;max-width:100%;cursor:pointer}.sch .bpIdentity b{font-size:12px}.sch .bpPluginName{display:block;width:max-content;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0!important;background:transparent!important;border-radius:0!important;padding:1px 0!important;color:var(--ink-3)!important;text-align:left;font:10px ui-monospace,monospace!important;text-decoration:underline dotted transparent;text-underline-offset:3px;transition:color .14s ease,text-decoration-color .14s ease}.sch .bpPluginName:hover,.sch .bpPluginName:focus-visible,.sch .bpPluginName[aria-expanded="true"]{color:var(--live)!important;text-decoration-color:currentColor}.sch .bpEntryInfo{position:absolute;left:0;top:calc(100% + 7px);z-index:9;display:block;width:min(420px,60vw);padding:14px 15px;border:1px solid var(--border);border-top:3px solid var(--live);background:var(--surface-1);box-shadow:0 16px 42px #0005;opacity:0;visibility:hidden;transform:translateY(-5px);pointer-events:none;transition:opacity .14s ease,transform .14s ease,visibility .14s}.sch .bpIdentity:hover .bpEntryInfo,.sch .bpIdentity:focus-within .bpEntryInfo,.sch .bpEntry.infoOpen .bpEntryInfo{opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto}.sch .bpEntryInfo>span{color:var(--live);font:700 9px ui-monospace,monospace;letter-spacing:.12em}.sch .bpEntryInfo p{margin:7px 0 10px;color:var(--ink-2);font-size:11px;line-height:1.55}.sch .bpEntryInfo dl{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 10px;font:10px/1.45 ui-monospace,monospace}.sch .bpEntryInfo dt{color:var(--ink-3)}.sch .bpEntryInfo dd{margin:0;overflow-wrap:anywhere}.sch .bpEntryMain em{font-style:normal;font-size:10px;color:var(--ink-3)}.sch .bpSignal{width:7px;height:7px;background:var(--live);box-shadow:0 0 0 3px color-mix(in srgb,var(--live) 12%,transparent)}.sch .bpSignal.off{background:var(--ink-3);box-shadow:none}.sch .bpConfig{margin:0 4px 10px 37px;padding:8px 11px;border-left:2px solid var(--change);background:color-mix(in srgb,var(--change) 5%,transparent)}.sch .bpConfig summary{cursor:pointer;color:var(--change);font-size:10px;font-weight:700}.sch .bpForm{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.sch .bpField{display:flex;flex-direction:column;gap:3px;color:var(--ink-3);font-size:10px}.sch .bpField input{width:100%;box-sizing:border-box}.sch .bpBool{flex-direction:row;align-items:center}.sch .bpYaml{display:flex;flex-direction:column;gap:4px;margin-top:10px;color:var(--ink-3);font-size:10px}.sch .bpYaml textarea{min-height:110px;resize:vertical;font:11px/1.55 ui-monospace,monospace;color:var(--ink-1);background:var(--page);border:1px solid var(--border);padding:8px}
.sch .bpImpact{position:relative;border-left:1px solid var(--border);padding:24px 20px;overflow:auto;display:flex;min-height:0;flex-direction:column}.sch .bpImpact h2{font:700 19px "Avenir Next Condensed",sans-serif;margin:8px 0 22px}.sch .bpMetric{display:grid;grid-template-columns:46px 1fr;align-items:baseline;border-top:1px solid var(--border);padding:13px 0}.sch .bpMetric b{font:700 21px ui-monospace,monospace}.sch .bpMetric span{color:var(--ink-2);font-size:11px}.sch .bpImpactActions{position:sticky;bottom:0;margin:auto -20px -24px;padding:16px 20px 20px;display:flex;flex-direction:column;gap:7px;background:linear-gradient(to bottom,color-mix(in srgb,var(--surface-1) 0%,transparent),var(--surface-1) 18px);z-index:2}.sch .bpImpactActions p{font-size:10px;color:var(--warn)}.sch .bpImpactActions button{min-height:38px}.sch .bpUnmanaged h3{margin:8px 0}.sch .bpUnmanaged>p{color:var(--ink-2);font-size:11px;line-height:1.5}.sch .bpUnmanaged label{display:flex;flex-direction:column;gap:5px;border-top:1px solid var(--border);padding:11px 0}.sch .bpUnmanaged label span{display:flex;flex-direction:column}.sch .bpUnmanaged label small{color:var(--ink-3)}.sch .bpUnmanaged>button{width:100%;margin-top:12px;min-height:38px}
.sch .bpDrift{margin:0 0 16px;padding:11px;background:color-mix(in srgb,var(--warn) 8%,transparent);border-left:2px solid var(--warn)}.sch .bpDrift h3{margin:0 0 7px;font-size:11px;color:var(--warn)}.sch .bpDrift label{display:flex;align-items:center;gap:6px;padding:3px 0;font:10px ui-monospace,monospace}.sch .bpDrift button{width:100%;margin-top:8px;font-size:10px}
.sch .bpEmpty{grid-column:2/-1;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:70px;max-width:540px}.sch .bpEmpty h2{font:700 34px "Avenir Next Condensed",sans-serif;margin:10px 0}.sch .bpEmpty p{color:var(--ink-2);line-height:1.6}.sch .bpEmpty button{padding:10px 16px}.sch .bpCreateOverlay{position:absolute;inset:0;z-index:12;background:#07110cbf;backdrop-filter:blur(6px);display:grid;place-items:center}.sch .bpCreateOverlay>section{width:min(640px,calc(100vw - 30px));background:var(--surface-1);border:1px solid var(--border);padding:28px;box-shadow:0 25px 75px #0006}.sch .bpCreateOverlay h2{font:700 28px "Avenir Next Condensed",sans-serif}.sch .bpCreateOverlay label{display:flex;flex-direction:column;gap:5px}.sch .bpCreateOverlay input{font-size:16px;padding:8px}.sch .bpCreateSch{flex-direction:row!important;align-items:flex-start;margin-top:13px;padding:11px 12px;border:1px solid var(--border);background:var(--page)}.sch .bpCreateSch input{margin-top:2px}.sch .bpCreateSch span{display:flex;flex-direction:column;gap:3px}.sch .bpCreateSch small{color:var(--ink-3);font-size:10px}.sch .bpStart{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0}.sch .bpStart button{text-align:left;padding:16px;min-height:105px;background:var(--page)}.sch .bpStart b,.sch .bpStart small{display:block}.sch .bpStart small{margin-top:6px;color:var(--ink-3);line-height:1.4}.sch .bpEmptySmall{padding:15px;color:var(--ink-3);font-size:11px}
@media(max-width:980px){.sch .blueprintWorkspace{grid-template-columns:210px minmax(340px,1fr) 240px}.sch .bpGroups{padding-left:18px;padding-right:18px}.sch .bpEditorHead{padding-left:18px;padding-right:18px}}
@media(max-width:767px){.sch .blueprintWorkspace{display:block!important;overflow:auto}.sch .bpRail{border:0}.sch .bpEditor{overflow:visible}.sch .bpEditor,.sch .bpImpact{border:0}.sch .bpImpact{min-height:260px}.sch .bpImpactActions{position:static;margin:20px 0 0;padding:0;background:none}.sch .bpStart{grid-template-columns:1fr}.sch .bpMenu,.sch .bpConfig,.sch .bpEditorHead input,.sch .bpEditorHead textarea{pointer-events:none}.sch .bpRail>header button,.sch .bpRailFoot{display:none}}
`
