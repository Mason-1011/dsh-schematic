import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { HttpError } from '../src/llm.ts'
import {
  captureBlueprint,
  materializeBlueprint,
  blueprintIdOf,
  BlueprintStore,
  adoptBlueprintEntries,
  capabilityOf,
  seedOfficialBlueprints,
  migrateLegacyBlueprints,
  migrateOfficialSchematicFlags,
  parseBlueprintDoc,
  type BlueprintDoc,
} from '../src/compose/blueprints.ts'
import { parseOps, planOperations, type TargetRow } from '../src/compose/ops.ts'
import type { ModelEntry } from '../src/compose/model.ts'
import type { Dialect } from '../src/compose/layers.ts'

const dialect: Dialect = {
  load: (text) => yaml.load(text, { schema: entryListSchema }),
  dump: (value) => yaml.dump(value, { schema: entryListSchema, noRefs: true }),
}

const entry = (overrides: Partial<ModelEntry> = {}): ModelEntry => ({
  id: 'alpha',
  name: 'pkg-alpha',
  desc: null,
  groupPath: null,
  disabled: false,
  disabledSource: null,
  origin: { layer: 'bundle', label: 'test', managed: false },
  config: null,
  live: null,
  protected: null,
  ...overrides,
})

/** The TargetRow view the planner takes, derived the way routes derives it. */
const targetsOf = (entries: ModelEntry[]): Map<string, TargetRow> => new Map(entries.map((e): [string, TargetRow] => [e.id, {
  id: e.id,
  name: e.name,
  disabled: e.disabled,
  disabledSource: e.disabledSource,
  configKeys: e.config === null ? [] : Object.keys(dialect.load(e.config.raw) as Record<string, unknown>),
  jsExprFields: e.config?.jsExprFields ?? [],
  managed: e.origin.managed,
  protected: e.protected,
}]))

const is422 = (error: unknown): boolean => error instanceof HttpError && error.status === 422

test('capture keeps enabled unprotected entries and the whole world, configs parsed', () => {
  const jsExpr = { __jsExpr: 'return process.env.X' }
  const entries = [
    entry({ id: 'on', name: 'pkg-on', config: { raw: dialect.dump({ a: 1, fn: jsExpr }).trimEnd(), jsExprFields: ['fn'] } }),
    entry({ id: 'off', name: 'pkg-off', disabled: true }),
    entry({ id: 'spine', name: 'pkg-spine', protected: { tier: 'warn', reason: 'boot' } }),
    entry({ id: 'self', name: 'dsh-schematic', protected: { tier: 'danger', reason: 'editor' } }),
  ]

  const { doc, skipped } = captureBlueprint(entries, '全量', 'everything on', dialect)

  assert.deepEqual(doc.world, ['on', 'off', 'spine', 'self'])
  assert.deepEqual(doc.members.map((m) => m.id), ['on'])
  assert.deepEqual(doc.members[0]!.config, { a: 1, fn: jsExpr })
  assert.deepEqual(skipped, [])
})

test('curated capture takes picked members regardless of disabled, skips protected and unknown ids', () => {
  const entries = [
    entry({ id: 'on', name: 'pkg-on', config: { raw: dialect.dump({ a: 1 }).trimEnd(), jsExprFields: [] } }),
    entry({ id: 'off', name: 'pkg-off', disabled: true, config: { raw: dialect.dump({ b: 2 }).trimEnd(), jsExprFields: [] } }),
    entry({ id: 'spine', name: 'pkg-spine', protected: { tier: 'warn', reason: 'boot' } }),
  ]

  // curation means "this should be on after a switch": a disabled entry joins,
  // protected and unknown picks are refused into `skipped` instead of vanishing
  const { doc, skipped } = captureBlueprint(entries, '精简', null, dialect, ['on', 'off', 'spine', 'nope'])

  assert.deepEqual(doc.members.map((m) => m.id), ['on', 'off'])
  assert.deepEqual(doc.members[1]!.config, { b: 2 })
  assert.deepEqual(doc.world, ['on', 'off', 'spine'])
  assert.deepEqual(skipped, ['spine', 'nope'])

  // an empty pick is a legal (bare-core) blueprint
  const bare = captureBlueprint(entries, '空', null, dialect, [])
  assert.deepEqual(bare.doc.members, [])
  assert.deepEqual(bare.skipped, [])
})

test('capture applies form config overrides without losing advanced nested values', () => {
  const entries = [entry({
    id: 'model', name: 'provider-openai',
    config: { raw: dialect.dump({ temperature: 0.2, retry: { enabled: true }, stops: ['END'] }).trimEnd(), jsExprFields: [] },
  })]

  const { doc } = captureBlueprint(entries, 'tuned', null, dialect, ['model'], {
    model: { temperature: 0.7, retry: { enabled: false }, stops: ['END'] },
  })

  assert.deepEqual(doc.members[0]?.config, { temperature: 0.7, retry: { enabled: false }, stops: ['END'] })
})

test('schematic mount intent is explicit, backward compatible, and materializes through the protected self row', () => {
  const self = entry({
    id: 'schematic', name: 'dsh-schematic',
    protected: { tier: 'danger', reason: 'self' },
  })
  const captured = captureBlueprint([self], 'with editor', null, dialect).doc
  assert.equal(captured.includeSchematic, true)
  assert.deepEqual(captured.members, []) // dedicated bit, never an ordinary member

  const without = { ...captured, includeSchematic: false }
  assert.deepEqual(materializeBlueprint(without, [self], dialect, () => true).ops, [
    { kind: 'disable', id: 'schematic' },
  ])
  assert.deepEqual(materializeBlueprint(captured, [{ ...self, disabled: true }], dialect, () => true).ops, [
    { kind: 'enable', id: 'schematic' },
  ])
  assert.deepEqual(materializeBlueprint(captured, [], dialect, () => true).ops, [
    { kind: 'insert', id: 'schematic', name: 'dsh-schematic' },
  ])

  const legacyShape = { ...captured } as Record<string, unknown>
  delete legacyShape.includeSchematic
  assert.equal(parseBlueprintDoc(legacyShape).includeSchematic, true)
  assert.throws(() => parseBlueprintDoc({ ...captured, includeSchematic: 'yes' }), is422)
})

test('capability grouping uses services and package identity, with a stable other fallback', () => {
  assert.equal(capabilityOf(entry({ id: 'chat-model', name: 'provider-openai' })), 'model')
  assert.equal(capabilityOf(entry({ id: 'runner', live: { state: 'active', provides: ['tools'], inject: [] } })), 'tools')
  assert.equal(capabilityOf(entry({ id: 'history', name: 'vector-memory' })), 'memory')
  assert.equal(capabilityOf(entry({ id: 'approval', name: 'permission-policy' })), 'safety')
  assert.equal(capabilityOf(entry({
    id: 'session-title',
    name: '@deepseek-ai/dsh-session-title',
    live: { state: 'active', provides: [], inject: ['llm'] },
  })), 'other')
  assert.equal(capabilityOf(entry({ id: 'metrics', name: 'telemetry' })), 'other')
})

test('official starter blueprints seed once and never overwrite an existing id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schematic-seed-'))
  try {
    const entries = [
      entry({ id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop' }),
      entry({ id: 'ui-shell', name: '@deepseek-ai/dsh-client-ui', origin: { layer: 'bundle', label: '@deepseek-ai/dsh-web-app', managed: false } }),
      entry({ id: 'third-party', name: 'community-plugin' }),
    ]
    assert.deepEqual(seedOfficialBlueprints(entries, dialect, dir), ['dsh-native', 'dsh-no-web', 'dsh-minimal'])
    const store = new BlueprintStore(dir, dialect)
    assert.deepEqual(store.read('dsh-native').members.map((member) => member.id), ['agent-loop', 'ui-shell'])
    assert.deepEqual(store.read('dsh-no-web').members.map((member) => member.id), ['agent-loop'])
    assert.deepEqual(store.read('dsh-minimal').members.map((member) => member.id), ['agent-loop'])
    assert.equal(store.read('dsh-native').includeSchematic, false)
    assert.equal(store.read('dsh-no-web').includeSchematic, false)
    assert.equal(store.read('dsh-minimal').includeSchematic, false)
    const original = store.yamlOf('dsh-native')
    assert.deepEqual(seedOfficialBlueprints([entry({ id: 'changed' })], dialect, dir), [])
    assert.equal(store.yamlOf('dsh-native'), original)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('official legacy blueprints get schematic off once without changing user or explicit choices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schematic-official-flag-'))
  const oldDoc = { schema: 2, name: 'old', desc: null, savedAt: '2026-09-01T00:00:00Z', world: [], members: [] }
  try {
    writeFileSync(join(dir, 'dsh-native.yml'), dialect.dump(oldDoc))
    writeFileSync(join(dir, 'dsh-minimal.yml'), dialect.dump({ ...oldDoc, includeSchematic: true }))
    writeFileSync(join(dir, 'my-blueprint.yml'), dialect.dump(oldDoc))

    assert.deepEqual(migrateOfficialSchematicFlags(dialect, dir), ['dsh-native'])
    const store = new BlueprintStore(dir, dialect)
    assert.equal(store.read('dsh-native').includeSchematic, false)
    assert.equal(store.read('dsh-minimal').includeSchematic, true)
    assert.equal(store.read('my-blueprint').includeSchematic, true)
    assert.deepEqual(migrateOfficialSchematicFlags(dialect, dir), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('adopting unmanaged entries is pure and records their current enabled state', () => {
  const doc: BlueprintDoc = {
    schema: 2, name: 'base', desc: null, includeSchematic: false, savedAt: '2026-09-01T00:00:00Z', world: ['a'],
    members: [{ id: 'a', name: 'pkg-a', config: null }],
  }
  const entries = [
    entry({ id: 'a', name: 'pkg-a' }),
    entry({ id: 'fresh-on', name: 'pkg-on', config: { raw: 'level: 2', value: { level: 2 }, jsExprFields: [] } }),
    entry({ id: 'fresh-off', name: 'pkg-off', disabled: true }),
  ]

  const adopted = adoptBlueprintEntries(doc, entries, ['fresh-on', 'fresh-off'], dialect)

  assert.deepEqual(doc.world, ['a'])
  assert.deepEqual(adopted.world, ['a', 'fresh-on', 'fresh-off'])
  assert.deepEqual(adopted.members.map((member) => member.id), ['a', 'fresh-on'])
  assert.deepEqual(adopted.members[1]?.config, { level: 2 })
})

test('materialize disables non-members, realigns members, and inserts absent installed ones', () => {
  const doc: BlueprintDoc = {
    schema: 2, name: 'p', desc: null, includeSchematic: false, savedAt: '2026-09-01T00:00:00Z',
    world: ['keep', 'drop', 'gone', 'held'],
    members: [
      { id: 'keep', name: 'pkg-keep', config: null },
      { id: 'held', name: 'pkg-held', config: null },
      { id: 'gone', name: 'pkg-gone', config: { k: 'v' } },
    ],
  }
  const entries = [
    entry({ id: 'keep', name: 'pkg-keep' }),
    entry({ id: 'drop', name: 'pkg-drop' }),
    entry({ id: 'held', name: 'pkg-held', disabled: true }),
  ]

  const { ops, report } = materializeBlueprint(doc, entries, dialect, () => true)

  assert.deepEqual(ops, [
    { kind: 'disable', id: 'drop' },
    { kind: 'enable', id: 'held' },
    { kind: 'insert', id: 'gone', name: 'pkg-gone', config: 'k: v' },
  ])
  assert.deepEqual(report, { newEntries: [], renamed: [] })
})

test('post-save new entries stay exactly as they are, named in the report', () => {
  const doc: BlueprintDoc = {
    schema: 2, name: 'p', desc: null, includeSchematic: false, savedAt: '2026-09-01T00:00:00Z',
    world: ['a'], members: [{ id: 'a', name: 'pkg-a', config: null }],
  }
  const entries = [entry({ id: 'a', name: 'pkg-a' }), entry({ id: 'fresh', name: 'pkg-fresh' })]

  const { ops, report } = materializeBlueprint(doc, entries, dialect, () => true)

  assert.deepEqual(ops, [])
  assert.deepEqual(report.newEntries, [{ id: 'fresh', disabled: false }])
})

test('config drift yields one setConfig; a renamed member is skipped and named', () => {
  const doc: BlueprintDoc = {
    schema: 2, name: 'p', desc: null, includeSchematic: false, savedAt: '2026-09-01T00:00:00Z',
    world: ['a', 'b'], members: [
      { id: 'a', name: 'pkg-a', config: { n: 2 } },
      { id: 'b', name: 'pkg-old', config: null },
    ],
  }
  const entries = [
    entry({ id: 'a', name: 'pkg-a', config: { raw: dialect.dump({ n: 1 }).trimEnd(), jsExprFields: [] } }),
    entry({ id: 'b', name: 'pkg-new' }),
  ]

  const { ops, report } = materializeBlueprint(doc, entries, dialect, () => true)

  // The dialect quotes one-letter 'n' (a YAML 1.1 boolean); it parses back identically.
  assert.deepEqual(ops, [{ kind: 'setConfig', id: 'a', config: "'n': 2" }])
  assert.deepEqual(report.renamed, [{ id: 'b', was: 'pkg-old', now: 'pkg-new' }])
})

test('an empty materialization means the tree is on the blueprint (divergence semantics)', () => {
  const entries = [entry({ id: 'a', name: 'pkg-a' })]
  const { doc } = captureBlueprint(entries, 'now', null, dialect)

  const { ops } = materializeBlueprint(doc, entries, dialect, () => true)

  assert.equal(ops.length, 0)
})

test('an absent member whose package is uninstalled refuses the whole batch', () => {
  const doc: BlueprintDoc = {
    schema: 2, name: 'p', desc: null, includeSchematic: false, savedAt: '2026-09-01T00:00:00Z',
    world: [], members: [{ id: 'x', name: 'pkg-x', config: null }],
  }

  assert.throws(
    () => materializeBlueprint(doc, [], dialect, () => false),
    (error: unknown) => is422(error) && (error as HttpError).message.includes('未安装'),
  )
})

test('a materialized batch plans into the managed-block shape: id rows plus one trailing insert row', () => {
  const entries = [
    entry({ id: 'keep', name: 'pkg-keep', config: { raw: 'k: 1\n', jsExprFields: [] } }),
    entry({ id: 'drop', name: 'pkg-drop' }),
    entry({ id: 'held', name: 'pkg-held', disabled: true }),
  ]
  // Hand-built doc: the shape a save of this tree would produce after 'held'
  // had been enabled and 'gone' was still mounted.
  const doc: BlueprintDoc = {
    schema: 2, name: 'batch', desc: null, includeSchematic: false, savedAt: '2026-09-01T00:00:00Z',
    world: ['keep', 'drop', 'held', 'gone'],
    members: [
      { id: 'keep', name: 'pkg-keep', config: { k: 1 } },
      { id: 'held', name: 'pkg-held', config: null },
      { id: 'gone', name: 'pkg-gone', config: null },
    ],
  }
  const { ops } = materializeBlueprint(doc, entries, dialect, () => true)

  const plan = planOperations(targetsOf(entries), [], parseOps(ops), dialect, () => true)

  assert.deepEqual(plan.rows, [
    { id: 'drop', disabled: true },
    { id: 'held', disabled: false },
    { insert: [{ id: 'gone', name: 'pkg-gone' }] },
  ])
})

test('the store round-trips docs (js-expr configs verbatim), refuses same-name saves, and manages the pointer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sch-blueprints-'))
  try {
    const store = new BlueprintStore(dir, dialect)
    const jsExpr = { __jsExpr: 'return 1' }
    const doc: BlueprintDoc = {
      schema: 2, name: '全量', desc: null, includeSchematic: false, savedAt: '2026-09-01T00:00:00Z', world: ['a'],
      members: [{ id: 'a', name: 'pkg-a', config: { fn: jsExpr } }],
    }

    const meta = store.save(doc)
    assert.deepEqual(store.list(), [meta])
    assert.deepEqual(store.read(meta.id), doc)

    assert.throws(() => store.save({ ...doc, savedAt: '2026-09-02T00:00:00Z' }), is422)
    // The overwrite path writes the same id in place.
    store.save({ ...doc, savedAt: '2026-09-02T00:00:00Z' }, meta.id)
    assert.equal(store.read(meta.id).savedAt, '2026-09-02T00:00:00Z')

    assert.equal(store.currentId(), null)
    store.setCurrentId(meta.id)
    assert.equal(store.currentId(), meta.id)
    store.remove(meta.id)
    assert.equal(store.currentId(), null)
    assert.throws(() => store.read(meta.id), (error: unknown) => error instanceof HttpError && error.status === 404)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt blueprint file fails loud with its filename, and ids never carry path characters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sch-blueprints-'))
  try {
    const store = new BlueprintStore(dir, dialect)
    writeFileSync(join(dir, `${blueprintIdOf('broken')}.yml`), 'schema: 2\n')

    assert.throws(() => store.read(blueprintIdOf('broken')), (error: unknown) =>
      is422(error) && (error as HttpError).message.includes(blueprintIdOf('broken')))
    assert.throws(() => store.read('../escape'), (error: unknown) =>
      error instanceof HttpError && error.status === 400)
    assert.notEqual(blueprintIdOf('全量'), blueprintIdOf('全量 2'))
    assert.match(blueprintIdOf('全量'), /^[a-z0-9一-鿿-]+-[0-9a-f]{6}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy schema-1 presets migrate once while the source remains an untouched backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'sch-blueprint-migrate-'))
  const legacy = join(root, 'presets')
  const next = join(root, 'blueprints')
  try {
    writeFileSync(join(root, '.keep'), '')
    const legacyDoc = {
      schema: 1, name: '编程', desc: '旧数据', savedAt: '2026-09-01T00:00:00Z', world: ['a'],
      members: [{ id: 'a', name: 'pkg-a', config: { enabled: true } }],
    }
    const id = blueprintIdOf(legacyDoc.name)
    mkdirSync(legacy, { recursive: true })
    const legacyYaml = dialect.dump(legacyDoc)
    writeFileSync(join(legacy, `${id}.yml`), legacyYaml)
    writeFileSync(join(legacy, '.current.json'), `${JSON.stringify({ id })}\n`)

    const first = migrateLegacyBlueprints(dialect, legacy, next)
    assert.deepEqual(first.migrated, [id])
    assert.equal(readFileSync(join(legacy, `${id}.yml`), 'utf8'), legacyYaml)
    assert.equal(new BlueprintStore(next, dialect).read(id).schema, 2)
    assert.equal(new BlueprintStore(next, dialect).currentId(), id)
    assert.ok(existsSync(join(next, '.migrated-from-presets.json')))

    const second = migrateLegacyBlueprints(dialect, legacy, next)
    assert.deepEqual(second.migrated, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
