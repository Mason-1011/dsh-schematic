/**
 * Browser half of dsh-schematic: one settings section in the dsh web SPA
 * whose single action opens the standalone /schematic page (served by the
 * host half) in a new tab, plus the ask-in-chat hand-off. The viewer page's
 * ask button opens the SPA with ?sch-ask=…; this half creates an Ungrouped
 * session and sends the starter question through the RPC gateway — the send
 * itself unlocks the composer (a workspace-less blank stays inert by
 * design). The question's language follows the SPA's active locale
 * (browser/system-derived until the user overrides it in settings).
 *
 * Bundle: scripts/build-client.mjs emits dist/client.js as a lazy-CJS
 * factory artifact — the format packages/client/tsdown.client.ts produces
 * in-repo (window.__ModuleLoader__.load({ id, factory })).
 */

import { SchematicSettingsSection, SETTINGS_SECTION_CSS } from './SettingsSection.tsx'

/** Locale dictionary namespace owned by this plugin. */
const NS = 'settings.schematic'

const zh = {
  section: '插件拓扑',
  rowTitle: '插件拓扑',
  rowDesc: '在新的浏览器标签页中打开实时插件拓扑查看器',
  open: '打开',
}
const en = {
  section: 'Plugin topology',
  rowTitle: 'Plugin topology',
  rowDesc: 'Open the live plugin-topology viewer in a new browser tab',
  open: 'Open',
}

export const inject = ['slots', 'locale', 'sessions']

/** Structural slice of the sessions service (out-of-tree: no type import). */
interface SessionsSlice {
  /** Create a session; no workspaceId and no cwd lands it under Ungrouped. */
  create(opts: {}): Promise<string>
  /** Session-scope context, or undefined before the session is staged. */
  scope(id: string): { get(name: 'conversation'): ConversationSlice | undefined } | undefined
  /** Make a listed session current. */
  open(id: string): void
  list: {
    getSnapshot(): { current?: string; byId: Record<string, { blank?: boolean } | undefined> }
    subscribe(fn: () => void): () => void
  }
}

/** Structural slice of the scoped conversation face. */
interface ConversationSlice {
  input: { for(actx: unknown): { setDraft(text: string): void } }
}

/** Structural slice of the locale runtime. */
interface LocaleSlice {
  register(ns: string, dicts: Record<string, Record<string, string>>): unknown
  bind(ns: string): (key: string) => string
  getSnapshot(): { active: string }
}

/** Structural slice of the slot registry (register options kept loose). */
interface SlotsSlice {
  inject(key: string, register: () => () => void): unknown
  register(opts: Record<string, unknown>, component: unknown): () => void
}

type SchematicCtx = {
  slots: SlotsSlice
  locale: LocaleSlice
  sessions: SessionsSlice
  effect(dispose: () => unknown, label?: string): unknown
}

/** Starter question for the ask-in-chat hand-off, in the SPA's active locale. */
function questionOf(active: string, name: string, id: string): string {
  return active === 'zh'
    ? `请介绍 dsh 里的插件「${name}」(${id}):它是做什么的、注入和提供了哪些服务、和其他插件是什么关系?`
    : `Explain the dsh plugin "${name}" (${id}): what it does, which services it injects/provides, and how it relates to other plugins.`
}

/** URL parameters the viewer page's ask button sends; consumed once at boot. */
const ASK_PARAM = 'sch-ask'
const NAME_PARAM = 'sch-name'

/**
 * Consume the hand-off params from the address bar so a reload or share of
 * the landing URL does not re-trigger the hand-off.
 * @returns the target plugin's display name and id, or null when absent.
 */
function consumeAskParams(): { name: string; id: string } | null {
  const search = new URLSearchParams(window.location.search)
  const id = search.get(ASK_PARAM)
  if (id === null) return null
  const name = search.get(NAME_PARAM) ?? id
  search.delete(ASK_PARAM)
  search.delete(NAME_PARAM)
  const qs = search.toString()
  window.history.replaceState(null, '', window.location.pathname + (qs === '' ? '' : `?${qs}`) + window.location.hash)
  return { name, id }
}

/**
 * How long the hand-off keeps its session current against the SPA's own
 * startup selection (which may still connect the recent workspace late).
 */
const HANDOFF_GUARD_MS = 5000

/**
 * Fire the question through the SPA's RPC gateway — the same session.prompt
 * call the composer itself makes. The host queues it as the session's first
 * user message; that one write flips the session non-blank, which is what
 * unlocks an Ungrouped composer (a workspace-less blank stays inert until a
 * workspace is picked — by design, so the create itself can never host the
 * first message).
 * @returns true when the gateway accepted the prompt.
 */
async function promptRpc(sessionId: string, text: string): Promise<boolean> {
  const res = await fetch('/api/session.prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `sch-ask-${sessionId.slice(0, 8)}`,
      method: 'session.prompt',
      payload: { sessionId, mode: 'queue', content: [{ type: 'text', text }] },
    }),
  })
  return res.ok
}

/**
 * The ask-in-chat hand-off: create a fresh Ungrouped session, make it
 * current immediately (nothing after the create may block the open), then
 * send the question through the RPC gateway — the one write that flips the
 * session non-blank and unlocks its composer. If that send fails (backend
 * slow or down at hand-off time), prefill the composer draft instead so the
 * user still has the text; a workspace pick migrates the draft. While the
 * session stays blank, any navigation steal inside the guard window is
 * taken back — the SPA restores the persisted selection
 * (dsh.sessions.current, shared across tabs) and connects its startup
 * workspace when its baselines land, which can race this hand-off at boot.
 * Progress lands on console.info prefixed "[dsh-schematic]" for field
 * diagnosis.
 */
function askInChat(ctx: SchematicCtx, name: string, id: string): void {
  const sessions = ctx.sessions
  const log = (...args: unknown[]): void => console.info('[dsh-schematic]', ...args)
  void (async () => {
    log('ask hand-off: boot current =', sessions.list.getSnapshot().current ?? 'none')
    const question = questionOf(ctx.locale.getSnapshot().active, name, id)
    let sessionId: string
    try {
      sessionId = await sessions.create({})
    } catch (err) {
      console.warn('[dsh-schematic] ask hand-off: session create failed:', err)
      return
    }
    sessions.open(sessionId)
    log('ask hand-off: opened', sessionId)
    let sent = false
    try {
      sent = await promptRpc(sessionId, question)
    } catch (err) {
      console.warn('[dsh-schematic] ask hand-off: prompt send failed:', err)
    }
    if (sent) {
      log('ask hand-off: question sent')
    } else {
      try {
        const actx = sessions.scope(sessionId)
        const conversation = actx?.get('conversation')
        if (actx !== undefined && conversation !== undefined) {
          conversation.input.for(actx).setDraft(question)
          log('ask hand-off: draft prefilled (send failed)')
        } else {
          log('ask hand-off: draft skipped (send failed, no conversation scope)')
        }
      } catch (err) {
        // The draft is best-effort: a failed write must not unseat the open.
        console.warn('[dsh-schematic] ask hand-off: draft write failed:', err)
      }
    }
    let lastSeen: string | undefined
    const stop = sessions.list.subscribe(() => {
      const snap = sessions.list.getSnapshot()
      if (snap.current === sessionId) {
        lastSeen = snap.current
        return
      }
      if (lastSeen === snap.current) return
      lastSeen = snap.current
      if (snap.byId[sessionId]?.blank === true) {
        log('ask hand-off: steal ->', snap.current ?? 'none', '(taking back)')
        sessions.open(sessionId)
      } else {
        log('ask hand-off: moved on ->', snap.current ?? 'none')
      }
    })
    window.setTimeout(() => {
      stop()
      const final = sessions.list.getSnapshot().current
      log('ask hand-off: settled current =', final ?? 'none', final === sessionId ? '(ours)' : '(LOST)')
    }, HANDOFF_GUARD_MS)
  })()
}

/** Contribute the settings section, then run the ask hand-off if requested. */
export function apply(ctx: SchematicCtx): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-schematic: dictionaries')
  const t = ctx.locale.bind(NS)
  if (document.querySelector('style[data-schematic-settings-css]') === null) {
    const tag = document.createElement('style')
    tag.dataset.schematicSettingsCss = ''
    tag.textContent = SETTINGS_SECTION_CSS
    document.head.appendChild(tag)
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'schematic',
    order: 90,
    label: () => t('section'),
    locale: NS,
    inject: () => ({}),
  }, SchematicSettingsSection))
  const ask = consumeAskParams()
  if (ask !== null) askInChat(ctx, ask.name, ask.id)
}
