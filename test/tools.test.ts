import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { blueprintToolDefs } from '../src/tools.ts'
import { normalizeEditConfig } from '../src/compose/config.ts'
import type { ComposeDeps } from '../src/compose/routes.ts'

/** A Context stand-in: the defs only close over it, never call it at build time. */
const ctxStub = {} as Context

const deps: ComposeDeps = {
  editConfig: normalizeEditConfig(undefined),
  updateFailures: new Map(),
}

const defs = blueprintToolDefs(ctxStub, deps)
const byName = new Map(defs.map((d) => [d.name, d]))

test('four schematic tools are defined with unique prefixed names', () => {
  assert.deepEqual(defs.map((d) => d.name).sort(), [
    'schematic_blueprint_list', 'schematic_blueprint_save', 'schematic_blueprint_switch', 'schematic_plugins',
  ])
  for (const def of defs) {
    assert.match(def.description, /blueprint|composition/i)
    assert.ok(def.description.length > 80, `${def.name}: description must actually guide the model`)
    assert.equal(typeof def.execute, 'function')
  }
})

test('parameters and output schemas sit inside the registry\'s enforced JSON Schema subset', () => {
  for (const def of defs) {
    // The registry rejects anything outside the subset at registration time;
    // asserting here keeps a future edit from shipping an unregistrable tool.
    assertSupportedJsonSchema(def.parameters)
    assert.doesNotThrow(() => assertObjectRoot(def.parameters), `${def.name}: parameters must be object-rooted`)
    assertSupportedJsonSchema(def.output.schema)
  }
})

function assertObjectRoot(schema: unknown): void {
  assert.equal((schema as { type?: string }).type, 'object')
}

test('save requires name and accepts its optionals; switch takes exactly one of id/name', () => {
  const save = byName.get('schematic_blueprint_save')!
  assert.deepEqual(validateJsonSchemaValue(save.parameters, {}), ['missing required property "value.name"'])
  assert.deepEqual(validateJsonSchemaValue(save.parameters, { name: '精简' }), [])
  assert.deepEqual(validateJsonSchemaValue(save.parameters, { name: '精简', desc: 'd', memberIds: ['a', 'b'] }), [])
  assert.deepEqual(validateJsonSchemaValue(save.parameters, { name: 'x', memberIds: 'a' }),
    ['"value.memberIds" must be an array'])

  const switchTool = byName.get('schematic_blueprint_switch')!
  // The schema keeps both optional (exactly-one is the tool's own 400, stated
  // in the descriptions) — but each alone validates.
  assert.deepEqual(validateJsonSchemaValue(switchTool.parameters, { id: 'p-1a2b3c' }), [])
  assert.deepEqual(validateJsonSchemaValue(switchTool.parameters, { name: '全量' }), [])
})

test('renders speak to the model: save names skipped ids, switch reports a rejected reload', () => {
  const textOf = (blocks: { type: string }[]): string => blocks.map((b) => (b as { text?: string }).text ?? '').join('\n')
  const save = byName.get('schematic_blueprint_save')!
  const saved = save.output.render({}, {
    blueprint: { id: 'x', name: '精简', desc: null, savedAt: 't', memberCount: 3 },
    skipped: ['spine', 'nope'],
    hint: 'switch to it with schematic_blueprint_switch',
  })
  assert.equal(saved.length, 1)
  assert.equal(saved[0]!.type, 'text')
  assert.match(textOf(saved), /"精简" \(3 members\)/)
  assert.match(textOf(saved), /spine, nope/)

  const switchTool = byName.get('schematic_blueprint_switch')!
  const rejected = switchTool.output.render({}, {
    switched: false, rolledBack: true, blueprint: '精简', appliedOps: 4, backup: '/tmp/b.yml',
    reload: 'REJECTED BY HARNESS: bad bytes', note: 'rollback…',
  })
  assert.match(textOf(rejected), /REJECTED BY HARNESS: bad bytes/)
  assert.match(textOf(rejected), /rollback/)

  const clean = switchTool.output.render({}, {
    switched: true, blueprint: '精简', appliedOps: 4, backup: '/tmp/b.yml',
    reload: 'hot reload issued; no failure recorded within the watch window',
  })
  assert.doesNotMatch(textOf(clean), /rollback/)
  const already = switchTool.output.render({}, { switched: false, alreadyOn: true, blueprint: '精简', report: {} })
  assert.match(textOf(already), /Already on blueprint/)
})
