#!/usr/bin/env node
/**
 * dsh-schematic v0.1.1 — static topology scanner with seam clustering.
 *
 * Scans a DeepSeek Harness checkout (packages/<group>/<pkg>) and emits
 * out/graph.json + out/index.html.
 *
 * Model: one node per package; edges from each package's `inject` ctx-key
 * declarations to the package occupying that key (`super(ctx, 'key')`).
 * Packages that together form one capability seam are grouped into a
 * cluster: the seam definition, packages injecting its (non-universal) key,
 * and same-directory siblings. `core` is exempt so the spine stays visible.
 * Bundle origin is read from each bundle's cordis.patch.yml under packages/bundle/.
 *
 * Usage: node tools/scan.mjs <path-to-harness> [-o outdir]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const root = args.find(a => !a.startsWith('-'))
const outDirIdx = args.indexOf('-o')
const outDir = outDirIdx >= 0 ? args[outDirIdx + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', 'out')
if (!root) {
  console.error('usage: node tools/scan.mjs <path-to-harness> [-o outdir]')
  process.exit(1)
}

/** Directory group → display category (fixed assignment, unmatched → "other"). */
const CATEGORY = {
  core: 'core-spine',
  llm: 'model-layer',
  shell: 'execution-seams', subprocess: 'execution-seams', terminal: 'execution-seams',
  fs: 'execution-seams', lsp: 'execution-seams', e2b: 'execution-seams', sandbox: 'execution-seams',
  'code-runtime': 'execution-seams',
  web: 'extension-seams', skill: 'extension-seams', subagent: 'extension-seams',
  workflow: 'extension-seams', compaction: 'extension-seams', context: 'extension-seams',
  jobs: 'extension-seams', mcp: 'extension-seams',
  session: 'session-data', 'session-query': 'session-data', todo: 'session-data',
  plan: 'session-data', goal: 'session-data', feedback: 'session-data', spill: 'session-data',
  storage: 'session-data', attachment: 'session-data',
  interaction: 'interaction-policy', guard: 'interaction-policy', identity: 'interaction-policy',
  settings: 'interaction-policy', credentials: 'interaction-policy', preset: 'interaction-policy',
  boot: 'host-protocol', api: 'host-protocol', sdk: 'host-protocol', acp: 'host-protocol',
  typert: 'host-protocol', hooks: 'host-protocol', bundle: 'host-protocol', host: 'host-protocol',
  client: 'web-client',
}

const RE = {
  fnInject: /export\s+const\s+inject\s*(?::[^=]*)?=\s*\[([^\]]*)\]/g,
  staticInject: /static\s+inject\s*(?::[^=]*)?=\s*\[([^\]]*)\]/g,
  softInject: /\bctx\.inject\s*\(\s*\[([^\]]*)\]/g,
  provides: /super\s*\(\s*(?:this\.)?ctx\s*,\s*['"]([^'"]+)['"]/g,
  applyFn: /export\s+function\s+apply\s*\(/,
  pluginName: /export\s+const\s+name\s*=\s*['"]([^'"]+)['"]/,
}
const listRe = /['"]([^'"]+)['"]/g
const parseList = (s) => [...s.matchAll(listRe)].map((m) => m[1])

function walkTs(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walkTs(p, acc)
    } else if (e.name.endsWith('.ts')) acc.push(p)
  }
  return acc
}

// ---------- package scan ----------
const groupsDir = join(root, 'packages')
const nodes = []
for (const g of readdirSync(groupsDir, { withFileTypes: true })) {
  if (!g.isDirectory()) continue
  const group = g.name
  for (const p of readdirSync(join(groupsDir, group), { withFileTypes: true })) {
    if (!p.isDirectory()) continue
    const pkgDir = join(groupsDir, group, p.name)
    const pjPath = join(pkgDir, 'package.json')
    const srcDir = join(pkgDir, 'src')
    if (!existsSync(pjPath) || !existsSync(srcDir)) continue
    const pj = JSON.parse(readFileSync(pjPath, 'utf8'))
    const src = walkTs(srcDir).map((f) => readFileSync(f, 'utf8')).join('\n')

    const inject = new Set()
    const softInject = new Set()
    const provides = new Set()
    let form = 'library'
    for (const [m] of src.matchAll(RE.fnInject)) parseList(m).forEach((k) => inject.add(k))
    for (const [m] of src.matchAll(RE.staticInject)) parseList(m).forEach((k) => inject.add(k))
    for (const [m] of src.matchAll(RE.softInject)) parseList(m).forEach((k) => softInject.add(k))
    for (const [, k] of src.matchAll(RE.provides)) { provides.add(k); form = 'service' }
    if (form !== 'service' && RE.applyFn.test(src)) form = 'function'
    const nm = src.match(RE.pluginName)

    nodes.push({
      id: pj.name,
      dir: `${group}/${p.name}`,
      category: CATEGORY[group] ?? 'other',
      group,
      form,
      desc: pj.description ?? null,
      pluginName: nm ? nm[1] : null,
      provides: [...provides].sort(),
      inject: [...inject].sort(),
      softInject: [...softInject].sort(),
    })
  }
}

// ---------- bundle origin ----------
const bundleOf = new Map()
const bundleDir = join(groupsDir, 'bundle')
if (existsSync(bundleDir)) {
  for (const b of readdirSync(bundleDir, { withFileTypes: true })) {
    if (!b.isDirectory()) continue
    const f = join(bundleDir, b.name, 'cordis.patch.yml')
    if (!existsSync(f)) continue
    for (const [, name] of readFileSync(f, 'utf8').matchAll(/name:\s*['"]?(@[\w@/.-]+)['"]?/g)) {
      if (!bundleOf.has(name)) bundleOf.set(name, new Set())
      bundleOf.get(name).add(b.name)
    }
  }
}
// base is the layer every profile mounts; its membership dominates. The
// remaining bundles only own packages their patch inserts (rows with a
// package `name:`); `id:`-only rows override base rows and add nothing.
for (const n of nodes) {
  const b = bundleOf.get(n.id)
  n.bundle = !b || b.size === 0 ? null
    : b.has('base') ? 'base'
    : b.size === 1 ? [...b][0] : 'multi'
}

// ---------- edges ----------
const keyOwners = new Map()
for (const n of nodes) for (const k of n.provides) {
  if (!keyOwners.has(k)) keyOwners.set(k, [])
  keyOwners.get(k).push(n.id)
}
const pairKeys = new Map()
const externalKeys = new Set()
for (const n of nodes) for (const k of n.inject) {
  const owners = keyOwners.get(k)
  if (!owners) { externalKeys.add(k); continue }
  for (const to of owners) {
    if (to === n.id) continue
    const pair = `${n.id}\u0000${to}`
    if (!pairKeys.has(pair)) pairKeys.set(pair, new Set())
    pairKeys.get(pair).add(k)
  }
}
const edges = [...pairKeys].map(([pair, keys]) => {
  const [from, to] = pair.split('\u0000')
  return { from, to, keys: [...keys].sort() }
})

// ---------- seam clustering ----------
// A key injected by >= UNIVERSAL_MIN packages is infrastructure (tools,
// sessions, agents…): it must not drive clustering, or half the repo lands
// in one "tools" cluster. Feature keys cluster the seam definition with its
// injectors; unclustered same-directory siblings join their group's first
// provider (this catches inheritance providers like fs-local, whose own
// source never names the key). `core` is exempt: the spine stays singleton.
const UNIVERSAL_MIN = 9
const injectCount = new Map()
for (const n of nodes) for (const k of n.inject) injectCount.set(k, (injectCount.get(k) ?? 0) + 1)
const isUniversal = (k) => (injectCount.get(k) ?? 0) >= UNIVERSAL_MIN

const parent = new Map(nodes.map((n) => [n.id, n.id]))
const find = (x) => {
  while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) }
  return x
}
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }

for (const n of nodes) for (const k of n.inject) {
  if (isUniversal(k)) continue
  for (const owner of keyOwners.get(k) ?? []) if (owner !== n.id) union(n.id, owner)
}
const groupRoot = new Map()
for (const n of nodes) {
  if (!n.provides.length || n.group === 'core') continue
  if (!groupRoot.has(n.group)) groupRoot.set(n.group, find(n.id))
}
for (const n of nodes) {
  if (n.provides.length || n.group === 'core') continue
  const root = groupRoot.get(n.group)
  if (root && find(n.id) === n.id) union(n.id, root)
}

const memberLists = new Map()
for (const n of nodes) {
  const r = find(n.id)
  if (!memberLists.has(r)) memberLists.set(r, [])
  memberLists.get(r).push(n)
}
const shortName = (id) => id.replace(/^@deepseek-ai\//, '').replace(/^dsh-/, '')
const clusters = []
const usedLabels = new Map()
for (const [root, members] of memberLists) {
  if (members.length < 2) continue
  // label by the members' dominant directory group; a repeated label gets
  // the cluster root's short name appended so pills stay distinguishable
  const groupCount = new Map()
  for (const m of members) groupCount.set(m.group, (groupCount.get(m.group) ?? 0) + 1)
  const mode = [...groupCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
  let label = usedLabels.has(mode) ? `${mode}·${shortName(root)}` : mode
  usedLabels.set(label, (usedLabels.get(label) ?? 0) + 1)
  const id = `cluster:${label}`
  const catCount = new Map()
  for (const m of members) catCount.set(m.category, (catCount.get(m.category) ?? 0) + 1)
  // seam keys: the non-universal ctx keys this group provides, most-injected
  // first. The intro line comes from a "definer", picked in priority order:
  // the modal directory group's namesake package (repo convention:
  // <group>/<group> is the seam definition — fs/fs, subagent/subagent), then
  // the modal-group provider of the most-injected key, then any member — so
  // the intro agrees with the label even when the top key is universal
  // (subagents, llm) or owned by a satellite package (settings in client/).
  const seamKeys = [...new Set(members.flatMap((m) => m.provides))]
    .filter((k) => !isUniversal(k))
    .sort((a, b) => (injectCount.get(b) ?? 0) - (injectCount.get(a) ?? 0))
  const keyRank = (k) => injectCount.get(k) ?? 0
  const inGroup = members.filter((m) => m.group === mode)
  const bestProvider = (pool, keys) => pool
    .map((m) => ({ m, k: keys(m).sort((a, b) => keyRank(b) - keyRank(a))[0] }))
    .filter((x) => x.k)
    .sort((a, b) => keyRank(b.k) - keyRank(a.k))[0]
  const nonUniversal = (m) => m.provides.filter((k) => !isUniversal(k))
  const any = (m) => m.provides
  const definer =
    inGroup.find((m) => m.dir === `${mode}/${mode}`) ??
    (bestProvider(inGroup, nonUniversal) ?? bestProvider(inGroup, any) ?? bestProvider(members, nonUniversal) ?? {}).m ?? null
  clusters.push({
    id, label,
    category: [...catCount.entries()].sort((a, b) => b[1] - a[1])[0][0],
    desc: definer ? definer.desc : null,
    seamKeys,
    members: members.map((m) => m.id).sort(),
  })
  for (const m of members) m.cluster = id
}

// ---------- rank ----------
const rank = new Map(nodes.map((n) => [n.id, 0]))
const incomers = new Map(nodes.map((n) => [n.id, []]))
for (const e of edges) incomers.get(e.to).push(e.from)
for (let pass = 0; pass < nodes.length; pass++) {
  let changed = false
  for (const n of nodes) {
    const deps = incomers.get(n.id)
    const r = deps.length ? Math.max(...deps.map((d) => rank.get(d) + 1)) : 0
    if (r !== rank.get(n.id)) { rank.set(n.id, Math.min(r, 12)); changed = true }
  }
  if (!changed) break
}
for (const n of nodes) n.rank = rank.get(n.id)

let commit = null
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim()
} catch { /* not a git checkout; commit stays null */ }

const graph = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    source: root, commit,
    universalKeys: [...injectCount.entries()].filter(([, v]) => v >= UNIVERSAL_MIN).map(([k]) => k).sort(),
  },
  nodes,
  edges,
  clusters,
  externalKeys: [...externalKeys].sort(),
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'graph.json'), JSON.stringify(graph, null, 2))
const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'template.html'), 'utf8')
writeFileSync(join(outDir, 'index.html'), template.replace('__GRAPH__', JSON.stringify(graph)))

const clustered = nodes.filter((n) => n.cluster).length
const byBundle = nodes.reduce((acc, n) => { const b = n.bundle ?? '—'; acc[b] = (acc[b] ?? 0) + 1; return acc }, {})
console.log(`packages: ${nodes.length}  edges: ${edges.length}  clusters: ${clusters.length} (covering ${clustered} packages)  external keys: ${externalKeys.size}`)
console.log('universal keys:', graph.meta.universalKeys.join(', '))
console.log('bundle origin:', JSON.stringify(byBundle))
