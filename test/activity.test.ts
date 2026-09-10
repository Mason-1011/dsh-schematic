import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import { ActivityCollector } from '../src/activity/collector.ts'
import type { TimelineEntry } from '../src/activity/protocol.ts'
import type { LiveGraph, LiveNode } from '../src/graph.ts'

// The collector only needs a context shell for these paths: noteAction and
// snapshot never touch host services (the firehose lives behind start()).
const ctx = {} as Context

const action = (module: string | null, name: string, time: number): TimelineEntry => ({
  time, kind: 'action', module, name,
})

test('a burst of identical actions folds into one counting row', () => {
  const c = new ActivityCollector(ctx)
  for (let i = 0; i < 300; i++) c.noteAction(action('@deepseek-ai/dsh-tools', 'tools/change', i * 3))
  const rows = c.snapshot().actions
  assert.equal(rows.length, 1)
  assert.equal(rows[0].count, 300)
  assert.equal(rows[0].name, 'tools/change')
})

test('an interleaved storm folds per action, not per adjacency', () => {
  // The real shape of a host-side storm: tools/change alternating with its
  // system-prompt/change echo. Two ring rows total, counting in place.
  const c = new ActivityCollector(ctx)
  for (let i = 0; i < 250; i++) {
    c.noteAction(action('@deepseek-ai/dsh-tools', 'tools/change', i * 4))
    c.noteAction(action('@deepseek-ai/dsh-system-prompt', 'system-prompt/change', i * 4 + 1))
  }
  const rows = c.snapshot().actions
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'tools/change')
  assert.equal(rows[0].count, 250)
  assert.equal(rows[1].name, 'system-prompt/change')
  assert.equal(rows[1].count, 250)
})

test('a different action, or a gap, starts a fresh row', () => {
  const c = new ActivityCollector(ctx)
  c.noteAction(action('a', 'x', 0))
  c.noteAction(action('a', 'x', 100))
  c.noteAction(action('b', 'x', 200)) // different owner: no fold
  c.noteAction(action('a', 'x', 300)) // folds into row 1, not into the b row
  c.noteAction(action('a', 'x', 3000)) // outside the window: fresh row
  const rows = c.snapshot().actions
  assert.equal(rows.length, 3)
  assert.equal(rows[0].count, 3)
  assert.equal(rows.filter((r) => r.count === undefined).length, 2)
})

test('the counting rows re-broadcast on the flush cadence, not per event', async () => {
  const c = new ActivityCollector(ctx)
  const seen: TimelineEntry[] = []
  c.subscribe({ onAction: (e) => seen.push(e), onActivity: () => {}, onState: () => {}, onTraffic: () => {} })
  c.noteAction(action('a', 'x', 0)) // first occurrence: immediate broadcast
  c.noteAction(action('b', 'y', 1))
  for (let i = 1; i <= 50; i++) {
    c.noteAction(action('a', 'x', i * 10))
    c.noteAction(action('b', 'y', i * 10 + 1))
  }
  assert.equal(seen.length, 2) // only the two first-seen rows
  await new Promise((r) => setTimeout(r, 260)) // one flush cadence
  assert.equal(seen.length, 4) // + one update per counting row
  const x = seen.filter((e) => e.name === 'x').at(-1)
  const y = seen.filter((e) => e.name === 'y').at(-1)
  assert.equal(x?.count, 51)
  assert.equal(y?.count, 51)
})

test('a scoped topology lifecycle batch occupies one counted activity row', (t) => {
  let now = 1_000
  t.mock.method(Date, 'now', () => now)
  const c = new ActivityCollector(ctx)
  const graph = (nodes: LiveNode[]): LiveGraph => ({
    meta: { mode: 'live', generated: '', universalKeys: [] },
    nodes, edges: [], clusters: [], hostKeys: [], unresolvedKeys: [], eventSubs: [],
  })
  const node = (id: string): LiveNode => ({
    id, module: `pkg-${id}`, label: id.split(':').at(-1)!, origin: 'entry',
    state: 'active', error: null, dir: '', category: 'extension-seams', group: 'tool',
    form: 'plugin', desc: null, pluginName: null, provides: [], inject: [], softInject: [],
  })

  c.noteTopo(graph([]))
  now = 12_000 // past the collector's boot-settling grace
  c.noteTopo(graph(['agent-presets:a', 'agent-presets:b', 'agent-presets:c', 'agent-presets:d', 'agent-presets:e'].map(node)))

  const rows = c.snapshot().actions
  assert.equal(rows.length, 1)
  assert.deepEqual(
    { kind: rows[0].kind, name: rows[0].name, snippet: rows[0].snippet, count: rows[0].count, module: rows[0].module },
    { kind: 'topo', name: 'agent-presets', snippet: '+', count: 5, module: null },
  )
})
