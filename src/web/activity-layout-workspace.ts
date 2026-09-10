/** Activity journey arranger. The browser and the model tool persist the same document. */

export type ActivityLane = 'flow' | 'side'
export type ActivityColor = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's8'
export interface ActivityLayoutGroup {
  id: string
  label: { en: string, zh: string }
  description: { en: string, zh: string }
  lane: ActivityLane
  color: ActivityColor
  memberIds: string[]
}
export interface ActivityLayoutDoc {
  schema: 1
  name: string
  updatedAt: string | null
  groups: ActivityLayoutGroup[]
}
export interface JourneyGroupView {
  id: string
  title: string
  description: string
  lane: ActivityLane
  css: string
}

interface Options {
  layer: HTMLElement
  button: HTMLButtonElement
  lang: () => 'en' | 'zh'
  nodes: () => any[]
  builtinStageOf: (node: any) => string
  onChange: () => void
  toast: (message: string) => void
}

const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c] ?? c))

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function mountActivityLayoutWorkspace(options: Options): {
  load: () => Promise<void>
  relocalize: () => void
  journey: () => { groups: JourneyGroupView[], stageOf: (node: any) => string, customized: boolean }
} {
  let layout: ActivityLayoutDoc | null = null
  let customized = false
  let draft: ActivityLayoutDoc | null = null
  let resetArmed = false
  let lastFocus: HTMLElement | null = null

  const tx = (en: string, zh: string): string => options.lang() === 'zh' ? zh : en
  const request = async (path: string, init?: RequestInit): Promise<any> => {
    const response = await fetch(`/schematic/${path}`, { cache: 'no-store', ...init })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `${response.status}`)
    return body
  }

  const load = async (): Promise<void> => {
    const data = await request('activity-layout')
    layout = data.layout
    customized = data.customized === true
    options.onChange()
  }

  const journey = (): { groups: JourneyGroupView[], stageOf: (node: any) => string, customized: boolean } => {
    const groups = (layout?.groups ?? []).map((group) => ({
      id: group.id,
      title: group.label[options.lang()],
      description: group.description[options.lang()],
      lane: group.lane,
      css: `--${group.color}`,
    }))
    const claimed = new Map<string, string>()
    if (customized && layout !== null) {
      for (const group of layout.groups) for (const id of group.memberIds) claimed.set(id, group.id)
    }
    return {
      groups,
      customized,
      stageOf: customized ? (node) => claimed.get(node.id) ?? 'unassigned' : options.builtinStageOf,
    }
  }

  const close = (): void => {
    options.layer.hidden = true
    options.layer.innerHTML = ''
    draft = null
    resetArmed = false
    lastFocus?.focus()
  }

  const materialized = (): ActivityLayoutDoc => {
    const next = clone(layout!)
    if (!customized) {
      for (const group of next.groups) group.memberIds = []
      for (const node of options.nodes()) {
        const group = next.groups.find((item) => item.id === options.builtinStageOf(node))
        group?.memberIds.push(node.id)
      }
    }
    return next
  }

  const freshId = (): string => {
    const used = new Set(draft!.groups.map((group) => group.id))
    for (let i = 1; i <= 99; i++) if (!used.has(`group-${i}`)) return `group-${i}`
    return `group-${Date.now().toString(36)}`
  }

  const render = (): void => {
    if (draft === null) return
    const doc = draft
    const assigned = new Map<string, string>()
    for (const group of doc.groups) for (const id of group.memberIds) assigned.set(id, group.id)
    const rows = options.nodes().slice().sort((a, b) => String(a.label ?? a.id).localeCompare(String(b.label ?? b.id)))
    options.layer.innerHTML = `<section class="signalLayoutDialog" role="dialog" aria-modal="true" aria-labelledby="signalLayoutTitle">
      <header><div><span>${tx('ACTIVITY ARRANGEMENT', '活动编排')}</span><h2 id="signalLayoutTitle">${tx('Arrange live signals', '编排实时信号')}</h2><p>${tx('Order is the journey. Main and supporting lanes explain how you understand the system.', '顺序就是旅程；主流程与旁路表达你对系统的理解。')}</p></div><div class="slHeaderActions"><button class="slChat">${tx('Arrange with dsh chat ↗', '用 dsh 对话编排 ↗')}</button><button class="slClose" aria-label="${tx('Close', '关闭')}">×</button></div></header>
      <div class="slBody"><div class="slGroups"><div class="slSectionHead"><b>${tx('Groups', '分组')}</b><button class="slAdd">＋ ${tx('Add group', '添加分组')}</button></div>
        ${doc.groups.map((group, index) => `<article class="slGroup" data-index="${index}" draggable="true" style="--gc:var(--${group.color})">
          <div class="slGroupTop"><span class="slDrag" title="${tx('Drag to reorder', '拖动排序')}">⠿</span><code>${esc(group.id)}</code><span data-count="${esc(group.id)}">${group.memberIds.length}</span><button class="slUp" title="${tx('Move up', '上移')}" ${index === 0 ? 'disabled' : ''}>↑</button><button class="slDown" title="${tx('Move down', '下移')}" ${index === doc.groups.length - 1 ? 'disabled' : ''}>↓</button><button class="slDelete" title="${tx('Delete group; members become unassigned', '删除分组；成员将变为未分配')}" ${doc.groups.length === 1 ? 'disabled' : ''}>×</button></div>
          <div class="slFields"><label>${tx('Chinese name', '中文名称')}<input data-field="label.zh" maxlength="40" value="${esc(group.label.zh)}"></label><label>${tx('English name', '英文名称')}<input data-field="label.en" maxlength="40" value="${esc(group.label.en)}"></label></div>
          <div class="slFields compact"><label>${tx('Lane', '位置')}<select data-field="lane"><option value="flow" ${group.lane === 'flow' ? 'selected' : ''}>${tx('Main flow', '主流程')}</option><option value="side" ${group.lane === 'side' ? 'selected' : ''}>${tx('Supporting lane', '旁路')}</option></select></label><label>${tx('Color', '颜色')}<select data-field="color">${['s1','s2','s3','s4','s5','s6','s7','s8'].map((color) => `<option value="${color}" ${group.color === color ? 'selected' : ''}>${color}</option>`).join('')}</select></label></div>
          <label>${tx('Chinese explanation', '中文说明')}<textarea data-field="description.zh" maxlength="180">${esc(group.description.zh)}</textarea></label><label>${tx('English explanation', '英文说明')}<textarea data-field="description.en" maxlength="180">${esc(group.description.en)}</textarea></label>
        </article>`).join('')}
      </div><div class="slMembers"><div class="slSectionHead"><div><b>${tx('Plugin assignment', '插件归属')}</b><small>${tx('New plugins stay visible as Unassigned until you decide.', '新插件会保持“未分配”，直到你明确决定。')}</small></div><input class="slSearch" type="search" placeholder="${tx('Find plugin…', '查找插件…')}" aria-label="${tx('Find plugin', '查找插件')}"></div>
        <div class="slMemberRows">${rows.map((node) => `<label class="slMember" data-search="${esc(`${node.label ?? node.id} ${node.id}`.toLowerCase())}"><span><b>${esc(node.label ?? node.id)}</b><code>${esc(node.id)}</code></span><select data-member="${esc(node.id)}"><option value="">${tx('Unassigned', '未分配')}</option>${draft!.groups.map((group) => `<option value="${esc(group.id)}" ${assigned.get(node.id) === group.id ? 'selected' : ''}>${esc(group.label[options.lang()])}</option>`).join('')}</select></label>`).join('')}</div>
      </div></div>
      <footer><button class="slReset">${resetArmed ? tx('Click again to restore the eight defaults', '再次点击，恢复默认八组') : tx('Restore defaults', '恢复默认')}</button><span></span><button class="slCancel">${tx('Cancel', '取消')}</button><button class="slSave primaryAction">${tx('Save arrangement', '保存编排')}</button></footer>
    </section>`

    const groups = [...options.layer.querySelectorAll<HTMLElement>('.slGroup')]
    const updateField = (article: HTMLElement, target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void => {
      const group = draft!.groups[Number(article.dataset.index)]
      const field = target.dataset.field
      if (field === 'label.zh') group.label.zh = target.value
      else if (field === 'label.en') group.label.en = target.value
      else if (field === 'description.zh') group.description.zh = target.value
      else if (field === 'description.en') group.description.en = target.value
      else if (field === 'lane') group.lane = target.value as ActivityLane
      else if (field === 'color') group.color = target.value as ActivityColor
    }
    for (const article of groups) {
      article.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-field]').forEach((input) => input.addEventListener('input', () => updateField(article, input)))
      const move = (delta: number): void => { const i = Number(article.dataset.index); const [item] = draft!.groups.splice(i, 1); draft!.groups.splice(i + delta, 0, item); render() }
      article.querySelector<HTMLButtonElement>('.slUp')!.onclick = () => move(-1)
      article.querySelector<HTMLButtonElement>('.slDown')!.onclick = () => move(1)
      article.querySelector<HTMLButtonElement>('.slDelete')!.onclick = () => { draft!.groups.splice(Number(article.dataset.index), 1); render() }
      article.ondragstart = (event) => event.dataTransfer?.setData('text/plain', article.dataset.index ?? '')
      article.ondragover = (event) => event.preventDefault()
      article.ondrop = (event) => { event.preventDefault(); const from = Number(event.dataTransfer?.getData('text/plain')); const to = Number(article.dataset.index); if (!Number.isInteger(from) || from === to) return; const [item] = draft!.groups.splice(from, 1); draft!.groups.splice(to, 0, item); render() }
    }
    options.layer.querySelectorAll<HTMLSelectElement>('[data-member]').forEach((select) => select.onchange = () => {
      const id = select.dataset.member!
      for (const group of draft!.groups) group.memberIds = group.memberIds.filter((member) => member !== id)
      draft!.groups.find((group) => group.id === select.value)?.memberIds.push(id)
      // Keep both independent scroll panes exactly where the user left them.
      // Rebuilding the dialog here would jump a long plugin list back to top.
      for (const group of draft!.groups) {
        const count = options.layer.querySelector<HTMLElement>(`[data-count="${CSS.escape(group.id)}"]`)
        if (count !== null) count.textContent = String(group.memberIds.length)
      }
    })
    options.layer.querySelector<HTMLInputElement>('.slSearch')!.oninput = (event) => {
      const query = (event.target as HTMLInputElement).value.trim().toLowerCase()
      options.layer.querySelectorAll<HTMLElement>('.slMember').forEach((row) => { row.hidden = query !== '' && !(row.dataset.search ?? '').includes(query) })
    }
    options.layer.querySelector<HTMLButtonElement>('.slAdd')!.onclick = () => {
      const id = freshId()
      draft!.groups.push({ id, label: { en: `Group ${draft!.groups.length + 1}`, zh: `分组 ${draft!.groups.length + 1}` }, description: { en: '', zh: '' }, lane: 'side', color: 's6', memberIds: [] })
      render()
      options.layer.querySelectorAll<HTMLInputElement>('[data-field="label.zh"]')[draft!.groups.length - 1]?.focus()
    }
    options.layer.querySelector<HTMLButtonElement>('.slClose')!.onclick = close
    options.layer.querySelector<HTMLButtonElement>('.slChat')!.onclick = () => {
      const params = new URLSearchParams({ 'sch-ask': 'schematic:activity-layout', 'sch-name': 'Activity signal arrangement' })
      window.open(`/?${params.toString()}`, '_blank', 'noopener')
    }
    options.layer.querySelector<HTMLButtonElement>('.slCancel')!.onclick = close
    options.layer.querySelector<HTMLButtonElement>('.slSave')!.onclick = async () => {
      try {
        const data = await request('activity-layout/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: draft }) })
        layout = data.layout; customized = true; close(); options.onChange(); options.toast(tx('Activity arrangement saved', '活动编排已保存'))
      } catch (error) { options.toast(error instanceof Error ? error.message : String(error)) }
    }
    options.layer.querySelector<HTMLButtonElement>('.slReset')!.onclick = async () => {
      if (!resetArmed) { resetArmed = true; render(); return }
      try {
        const data = await request('activity-layout/reset', { method: 'POST' })
        layout = data.layout; customized = false; close(); options.onChange(); options.toast(tx('Default arrangement restored', '已恢复默认编排'))
      } catch (error) { options.toast(error instanceof Error ? error.message : String(error)) }
    }
  }

  const open = (): void => {
    if (layout === null || window.matchMedia('(max-width: 767px)').matches) return
    lastFocus = document.activeElement as HTMLElement
    draft = materialized()
    options.layer.hidden = false
    render()
    options.layer.querySelector<HTMLInputElement>('input')?.focus()
  }
  options.button.addEventListener('click', open)
  options.layer.addEventListener('pointerdown', (event) => { if (event.target === options.layer) close() })
  options.layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const focusable = [...options.layer.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
    if (focusable.length === 0) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })

  const relocalize = (): void => {
    options.button.textContent = tx('Arrange signals', '编排信号')
    options.button.title = window.matchMedia('(max-width: 767px)').matches ? tx('Editing requires a desktop viewport', '编辑需要桌面宽度') : ''
    if (!options.layer.hidden && draft !== null) render()
  }
  relocalize()
  return { load, relocalize, journey }
}
