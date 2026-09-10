/**
 * User-owned arrangement of the Activity workspace's live-signal groups.
 * The built-in eight-stage journey is the default template; once saved, the
 * document is profile-scoped and shared by the browser and model tools.
 *
 * @module dsh-schematic/activity/layout
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { HttpError } from '../llm.ts'
import { readJsonBody, sendJson } from '../http.ts'
import { resolveComposition } from '../compose/layers.ts'
import { writePatchAtomic } from '../compose/block.ts'

export type ActivityLane = 'flow' | 'side'
export type ActivityColor = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7' | 's8'

export interface LocalizedActivityText {
  en: string
  zh: string
}

export interface ActivityLayoutGroup {
  id: string
  label: LocalizedActivityText
  description: LocalizedActivityText
  lane: ActivityLane
  color: ActivityColor
  /** Explicit graph node ids. A node may belong to at most one group. */
  memberIds: string[]
}

export interface ActivityLayoutDoc {
  schema: 1
  name: string
  updatedAt: string | null
  groups: ActivityLayoutGroup[]
}

const GROUP_ID_RE = /^[a-z][a-z0-9-]{0,31}$/
const COLORS = new Set<ActivityColor>(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'])
const MAX_GROUPS = 20
const MAX_MEMBERS = 2_000

/** The original eight-stage journey, retained as a resettable starting point. */
export function defaultActivityLayout(): ActivityLayoutDoc {
  const group = (
    id: string, en: string, zh: string, enDescription: string, zhDescription: string,
    lane: ActivityLane, color: ActivityColor,
  ): ActivityLayoutGroup => ({
    id,
    label: { en, zh },
    description: { en: enDescription, zh: zhDescription },
    lane,
    color,
    memberIds: [],
  })
  return {
    schema: 1,
    name: 'Message journey',
    updatedAt: null,
    groups: [
      group('ui', 'Browser UI', '网页界面', 'Conversations, sidebar, settings — turns clicks into RPCs.', '对话、侧栏、设置——把点击变成 RPC 请求。', 'flow', 's8'),
      group('gw', 'Connection & gateway', '连接与网关', 'The wire between browser and process: fetch/RPC gateway.', '浏览器与 dsh 进程之间的通道：fetch/RPC 网关。', 'flow', 's1'),
      group('sess', 'Sessions & agent loop', '会话与代理循环', 'Sessions, agents, the loop itself, approvals, blueprints.', '会话、代理、主循环本体、审批与蓝图。', 'flow', 's7'),
      group('ctx', 'Context assembly', '上下文组装', 'System prompt, skills, compaction, request context.', '系统提示、技能、压缩与请求上下文。', 'flow', 's4'),
      group('model', 'Model call', '模型调用', 'LLM service definition and model providers.', 'LLM 服务定义与模型提供方。', 'flow', 's2'),
      group('tools', 'Tool execution', '工具执行', 'Tool registry plus shell, fs, web, workflows, and more.', '工具注册表与 shell、fs、web、工作流等执行器。', 'flow', 's3'),
      group('persist', 'Logging & telemetry', '记录与遥测', 'Session logs, projections, titles, and telemetry.', '会话日志、投影、标题与遥测。', 'side', 's5'),
      group('support', 'Supporting services', '支撑服务', 'Settings, locale, identity, credentials, and boot glue.', '设置、语言、身份、凭据与启动粘合。', 'side', 's6'),
    ],
  }
}

/** Parse an untrusted layout document and return its normalized form. */
export function parseActivityLayout(input: unknown): ActivityLayoutDoc {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new HttpError(400, '活动编排必须是对象')
  const raw = input as Record<string, unknown>
  if (raw.schema !== 1) throw new HttpError(400, '活动编排 schema 必须为 1')
  const name = text(raw.name, 'name', 1, 80)
  if (!Array.isArray(raw.groups) || raw.groups.length === 0 || raw.groups.length > MAX_GROUPS) {
    throw new HttpError(400, `groups 必须包含 1–${MAX_GROUPS} 个分组`)
  }
  const groupIds = new Set<string>()
  const claimed = new Set<string>()
  const groups = raw.groups.map((value, index): ActivityLayoutGroup => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, `groups[${index}] 必须是对象`)
    const item = value as Record<string, unknown>
    const id = text(item.id, `groups[${index}].id`, 1, 32)
    if (!GROUP_ID_RE.test(id)) throw new HttpError(400, `groups[${index}].id 只能使用小写字母、数字和连字符`)
    if (groupIds.has(id)) throw new HttpError(400, `分组 id 重复:${id}`)
    groupIds.add(id)
    const lane = item.lane
    if (lane !== 'flow' && lane !== 'side') throw new HttpError(400, `groups[${index}].lane 必须是 flow|side`)
    const color = item.color
    if (typeof color !== 'string' || !COLORS.has(color as ActivityColor)) throw new HttpError(400, `groups[${index}].color 必须是 s1–s8`)
    if (!Array.isArray(item.memberIds) || item.memberIds.length > MAX_MEMBERS) {
      throw new HttpError(400, `groups[${index}].memberIds 必须是至多 ${MAX_MEMBERS} 项的数组`)
    }
    const memberIds = item.memberIds.map((member, memberIndex) => text(member, `groups[${index}].memberIds[${memberIndex}]`, 1, 240))
    for (const member of memberIds) {
      if (claimed.has(member)) throw new HttpError(400, `节点不能属于多个分组:${member}`)
      claimed.add(member)
    }
    return {
      id,
      label: localized(item.label, `groups[${index}].label`, 40),
      description: localized(item.description, `groups[${index}].description`, 180, true),
      lane,
      color: color as ActivityColor,
      memberIds,
    }
  })
  const updatedAt = raw.updatedAt === null || raw.updatedAt === undefined
    ? null
    : text(raw.updatedAt, 'updatedAt', 1, 64)
  return { schema: 1, name, updatedAt, groups }
}

function text(value: unknown, path: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new HttpError(400, `${path} 必须是 ${min}–${max} 字符的字符串`)
  }
  return value.trim()
}

function localized(value: unknown, path: string, max: number, empty = false): LocalizedActivityText {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new HttpError(400, `${path} 必须是 {en,zh}`)
  const raw = value as Record<string, unknown>
  const min = empty ? 0 : 1
  const en = empty && raw.en === '' ? '' : text(raw.en, `${path}.en`, min, max)
  const zh = empty && raw.zh === '' ? '' : text(raw.zh, `${path}.zh`, min, max)
  return { en, zh }
}

/** One profile's current layout. The filename is path-safe and collision resistant. */
export function defaultActivityLayoutFile(profile: string): string {
  const slug = profile.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profile'
  const hash = createHash('sha256').update(profile).digest('hex').slice(0, 8)
  return join(homedir(), '.dsh', 'schematic', 'activity-layouts', `${slug}-${hash}.json`)
}

export class ActivityLayoutStore {
  readonly file: string

  constructor(file: string) { this.file = file }

  read(): { layout: ActivityLayoutDoc, customized: boolean } {
    if (!existsSync(this.file)) return { layout: defaultActivityLayout(), customized: false }
    try {
      return { layout: parseActivityLayout(JSON.parse(readFileSync(this.file, 'utf8'))), customized: true }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(422, `活动编排文件不合法:${error instanceof Error ? error.message : String(error)}`)
    }
  }

  save(input: unknown): ActivityLayoutDoc {
    const layout = parseActivityLayout(input)
    const saved = { ...layout, updatedAt: new Date().toISOString() }
    mkdirSync(dirname(this.file), { recursive: true })
    writePatchAtomic(this.file, `${JSON.stringify(saved, null, 2)}\n`)
    return saved
  }

  reset(): ActivityLayoutDoc {
    try { rmSync(this.file) } catch { /* absent already means default */ }
    return defaultActivityLayout()
  }
}

async function storeFor(ctx: Context): Promise<ActivityLayoutStore> {
  const comp = await resolveComposition(ctx)
  return new ActivityLayoutStore(defaultActivityLayoutFile(comp.profile.name))
}

export async function handleActivityLayoutGet(ctx: Context, res: ServerResponse): Promise<void> {
  sendJson(res, 200, (await storeFor(ctx)).read())
}

export async function handleActivityLayoutPost(
  ctx: Context, req: IncomingMessage, sub: string, res: ServerResponse,
): Promise<void> {
  const store = await storeFor(ctx)
  if (sub === '/activity-layout/save') {
    const body = await readJsonBody(req) as { layout?: unknown } | null
    return sendJson(res, 200, { layout: store.save(body?.layout), customized: true })
  }
  if (sub === '/activity-layout/reset') {
    return sendJson(res, 200, { layout: store.reset(), customized: false })
  }
  sendJson(res, 404, { error: `unknown activity layout endpoint: ${sub}` })
}
