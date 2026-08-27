/**
 * Event → plugin attribution. The tools registry records no registrant
 * (ToolDefinition has no origin), so tool calls resolve through a
 * name-convention table; session-event types resolve through a static owner
 * table. The attribution currency is the module specifier — the same string
 * LiveNode.module carries in the topology graph — so the page can index
 * pills by module without knowing loader config ids.
 *
 * Values list candidate modules in preference order (bash exists in both the
 * plain and the persistent package); the first candidate mounted in the
 * current graph wins. Unattributed (null) is a normal outcome — the page
 * greys it — for unmounted owners, renamed configurable tools, and event
 * types outside the table.
 */

import type { TimelineEntry } from './protocol.ts'

const DSH = '@deepseek-ai'

/** Tool name → candidate owning modules, first mounted one wins. */
const TOOL_OWNER: Record<string, string[]> = {
  // fs
  read: [`${DSH}/dsh-tool-fs`],
  write: [`${DSH}/dsh-tool-fs`],
  edit: [`${DSH}/dsh-tool-fs`],
  read_image: [`${DSH}/dsh-tool-fs`],
  grep: [`${DSH}/dsh-tool-fs-search`],
  glob: [`${DSH}/dsh-tool-fs-search`],
  str_replace_editor: [`${DSH}/dsh-tool-str-replace-editor`],
  // shell
  bash: [`${DSH}/dsh-tool-bash`, `${DSH}/dsh-tool-bash-persistent`],
  pwsh: [`${DSH}/dsh-tool-pwsh`, `${DSH}/dsh-tool-pwsh-persistent`],
  // terminal
  terminal_open: [`${DSH}/dsh-tool-terminal`],
  terminal_send: [`${DSH}/dsh-tool-terminal`],
  terminal_read: [`${DSH}/dsh-tool-terminal`],
  terminal_signal: [`${DSH}/dsh-tool-terminal`],
  terminal_close: [`${DSH}/dsh-tool-terminal`],
  terminal_list: [`${DSH}/dsh-tool-terminal`],
  // web
  web_fetch: [`${DSH}/dsh-tool-web`],
  web_search: [`${DSH}/dsh-tool-web`],
  // lsp / skill / todo
  lsp: [`${DSH}/dsh-tool-lsp`],
  skill: [`${DSH}/dsh-tool-skill`],
  todo_write: [`${DSH}/dsh-tool-todo`],
  // subagents
  subagent: [`${DSH}/dsh-tool-subagent`],
  send_message: [`${DSH}/dsh-tool-subagent-control`],
  interrupt_agent: [`${DSH}/dsh-tool-subagent-control`],
  list_agents: [`${DSH}/dsh-tool-subagent-control/list-agents`],
  report: [`${DSH}/dsh-tool-subagent-report`],
  // interaction
  ask_user_question: [`${DSH}/dsh-tool-ask-user`],
  // jobs / goal / session query
  job_output: [`${DSH}/dsh-tool-jobs`],
  job_list: [`${DSH}/dsh-tool-jobs`],
  job_kill: [`${DSH}/dsh-tool-jobs`],
  get_goal: [`${DSH}/dsh-tool-goal`],
  create_goal: [`${DSH}/dsh-tool-goal`],
  update_goal: [`${DSH}/dsh-tool-goal`],
  session_search: [`${DSH}/dsh-tool-session-query`],
  session_event_search: [`${DSH}/dsh-tool-session-query`],
  session_trace: [`${DSH}/dsh-tool-session-query`],
  session_event_trace: [`${DSH}/dsh-tool-session-query`],
  session_event_read: [`${DSH}/dsh-tool-session-query`],
  // workflow (both tool names are config-derived defaults)
  workflow: [`${DSH}/dsh-tool-workflow`],
  ralph: [`${DSH}/dsh-tool-ralph`],
  ralph_loop: [`${DSH}/dsh-tool-ralph`],
}

/** Session-event type → owning module (exact matches; prefixes handled separately). */
const EVENT_OWNER: Record<string, string> = {
  'turn/start': `${DSH}/dsh-agent-loop`,
  'turn/end': `${DSH}/dsh-agent-loop`,
  'step/start': `${DSH}/dsh-agent-loop`,
  'step/end': `${DSH}/dsh-agent-loop`,
  'request/header': `${DSH}/dsh-agent-loop`,
  'request/context': `${DSH}/dsh-agent-loop`,
  'approval/asked': `${DSH}/dsh-user-approval`,
  'approval/decided': `${DSH}/dsh-user-approval`,
  'approval/policy': `${DSH}/dsh-user-approval`,
  'todo/write': `${DSH}/dsh-tool-todo`,
  'subagent/descriptor': `${DSH}/dsh-subagent`,
  'llm/retry': `${DSH}/dsh-llm-retry`,
  'llm/retry-started': `${DSH}/dsh-llm-retry`,
  'session/title': `${DSH}/dsh-session-title`,
  'session/title-llm-request': `${DSH}/dsh-session-title`,
  'plan/mode': `${DSH}/dsh-plan-mode`,
  'permission/preset': `${DSH}/dsh-permission-presets`,
  'sandbox/mode': `${DSH}/dsh-sandbox-policy`,
  'goal/change': `${DSH}/dsh-goal`,
  'command/run': `${DSH}/dsh-commands`,
  'command/done': `${DSH}/dsh-commands`,
  'feedback/record': `${DSH}/dsh-message-feedback`,
  'agent-preset/selected': `${DSH}/dsh-agent-presets`,
  'agent/inbox/spliced': `${DSH}/dsh-agent`,
  'session/end-seed': `${DSH}/dsh-session`,
  'web/deepseek-search-llm-request': `${DSH}/dsh-web-search-deepseek`,
  'hook/invoked': `${DSH}/dsh-hooks`,
  'hook/result': `${DSH}/dsh-hooks`,
}

/** Event-type prefixes → owning module for families that grow suffixes. */
const EVENT_OWNER_PREFIX: [prefix: string, module: string][] = [
  ['compaction/', `${DSH}/dsh-compaction-basic`],
  ['tool-workflow/', `${DSH}/dsh-tool-workflow`],
]

/** Provider route key fragments → the adapter package behind them. */
function providerModule(provider: string): string {
  if (provider.includes('pi-ai')) return `${DSH}/dsh-llm-pi-ai`
  if (provider.includes('deepseek')) return `${DSH}/dsh-llm-deepseek`
  return `${DSH}/dsh-llm`
}

/**
 * Attribute one session event to a module. Returns the owner module for
 * highlight purposes, or null when the type is unknown — never throws.
 */
export function ownerOfEvent(type: string): string | null {
  if (Object.prototype.hasOwnProperty.call(EVENT_OWNER, type)) return EVENT_OWNER[type]
  for (const [prefix, module] of EVENT_OWNER_PREFIX) {
    if (type.startsWith(prefix)) return module
  }
  return null
}

/**
 * Resolve a tool name to its owning module among the mounted candidates.
 * @param mounted module specifiers currently present in the graph; the first
 *        TOOL_OWNER candidate found there wins. Empty set skips the check and
 *        returns the first candidate (graph-unknown is the page's grey case).
 */
export function ownerOfTool(name: string, mounted: ReadonlySet<string>): string | null {
  const candidates = TOOL_OWNER[name]
  if (candidates === undefined) return null
  if (mounted.size === 0) return candidates[0]
  return candidates.find((module) => mounted.has(module)) ?? null
}

/** All tool names the table knows — for the boot drift log. */
export function knownToolNames(): string[] {
  return Object.keys(TOOL_OWNER)
}

/** Pull the first text out of a user/message content block list. */
function textSnippet(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  return joined.length > 80 ? `${joined.slice(0, 80)}…` : joined
}

export interface AttributedEvent {
  kind: TimelineEntry['kind']
  module: string | null
  name?: string
  snippet?: string
  isError?: boolean
  provider?: string
  model?: string
}

/**
 * Decide whether a session event earns a timeline entry and attribute it.
 * Returns null for the noise floor (chunks, request plumbing, and every type
 * with no interesting story at plugin granularity) — those still refresh the
 * collector's state clocks, they just never reach the wire.
 */
export function attributeEvent(type: string, data: unknown): AttributedEvent | null {
  const d = (data ?? {}) as Record<string, unknown>
  switch (type) {
    case 'user/message': {
      // One prompt logs several user/message events: the real user text plus
      // injected context (system-prompt snapshot, instructions, skill
      // catalog). The user row stays unattributed; injected rows credit the
      // injecting plugin and carry its form label instead of the bulk text.
      const source = d.source as { kind?: unknown; plugin?: unknown; form?: unknown } | undefined
      if (source !== null && typeof source === 'object' && source.kind !== undefined && source.kind !== 'user') {
        const kindStr = String(source.kind)
        const module = typeof source.plugin === 'string'
          ? source.plugin
          : kindStr === 'agent-instructions' ? `${DSH}/dsh-agent-instructions`
            : kindStr === 'skill-catalog' ? `${DSH}/dsh-skill`
              : null
        return { kind: 'user', module, name: typeof source.form === 'string' ? source.form : kindStr }
      }
      return { kind: 'user', module: null, snippet: textSnippet(d.content) }
    }
    case 'assistant/message': {
      const source = d.message !== null && typeof d.message === 'object'
        ? (d.message as { source?: unknown }).source
        : undefined
      if (source !== null && typeof source === 'object'
        && (source as { kind?: unknown }).kind === 'model') {
        const { provider, model } = source as { provider?: unknown; model?: unknown }
        const providerId = typeof provider === 'string' ? provider : ''
        const modelId = typeof model === 'string' ? model : undefined
        return { kind: 'llm', module: providerModule(providerId), name: providerId, provider: providerId, model: modelId }
      }
      return { kind: 'llm', module: `${DSH}/dsh-llm` }
    }
    case 'tool/call':
      return { kind: 'tool', module: null, name: typeof d.name === 'string' ? d.name : undefined }
    case 'tool/result':
      return { kind: 'tool-end', module: null, isError: d.error !== undefined }
    case 'turn/start':
    case 'turn/end':
      return { kind: 'turn', module: ownerOfEvent(type), name: typeof d.turn === 'number' ? String(d.turn) : undefined }
    case 'approval/asked':
    case 'approval/decided':
      return { kind: 'approval', module: ownerOfEvent(type) }
    case 'todo/write':
      return { kind: 'todo', module: ownerOfEvent(type) }
    case 'llm/retry':
    case 'llm/retry-started':
      return { kind: 'retry', module: ownerOfEvent(type) }
    case 'subagent/descriptor':
      return { kind: 'subagent', module: ownerOfEvent(type) }
    case 'session/title':
      return { kind: 'title', module: ownerOfEvent(type) }
    default:
      if (type.startsWith('compaction/')) return { kind: 'compaction', module: ownerOfEvent(type) }
      return null
  }
}
