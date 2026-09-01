import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { HttpError } from '../src/llm.ts'
import {
  BLOCK_MARKERS,
  readManagedBlock,
  removeManagedBlock,
  spliceManagedBlock,
  validatePatchFile,
} from '../src/compose/block.ts'
import { parseOps, planOperations, type TargetRow } from '../src/compose/ops.ts'
import type { Dialect, PatchRow } from '../src/compose/layers.ts'

const dialect: Dialect = {
  load: (text) => yaml.load(text, { schema: entryListSchema }),
  dump: (value) => yaml.dump(value, { schema: entryListSchema, noRefs: true }),
}

const target = (overrides: Partial<TargetRow> = {}): TargetRow => ({
  id: 'alpha',
  name: 'pkg-alpha',
  disabled: false,
  disabledSource: 'literal',
  configKeys: ['keep', 'drop'],
  jsExprFields: [],
  managed: false,
  protected: null,
  ...overrides,
})

test('managed block round-trips without changing bytes outside it', () => {
  const before = '# hand-written header\n- id: manual\n  disabled: false\n'
  const rows: PatchRow[] = [{ id: 'alpha', disabled: true }]
  const withBlock = spliceManagedBlock(before, rows, dialect)

  assert.deepEqual(readManagedBlock(withBlock, dialect).rows, rows)
  assert.equal(removeManagedBlock(withBlock, dialect), before)
  assert.equal(withBlock.split(BLOCK_MARKERS.open).length - 1, 1)
  assert.equal(withBlock.split(BLOCK_MARKERS.close).length - 1, 1)
})

test('comments-only files remain valid after an empty managed block is cleared', () => {
  const withBlock = spliceManagedBlock('# notes only\n', [], dialect)
  const cleared = removeManagedBlock(withBlock, dialect)

  assert.doesNotThrow(() => validatePatchFile(cleared, dialect))
  assert.deepEqual(dialect.load(cleared), [])
})

test('unterminated and malformed managed blocks fail with 422', () => {
  for (const text of [
    `${BLOCK_MARKERS.open}\n- id: alpha\n`,
    `${BLOCK_MARKERS.open}\nnot-an-array: true\n${BLOCK_MARKERS.close}\n`,
  ]) {
    assert.throws(
      () => readManagedBlock(text, dialect),
      (error: unknown) => error instanceof HttpError && error.status === 422,
    )
  }
})

test('planner keeps enable/config edits in one deterministic managed row', () => {
  const targets = new Map([['alpha', target({ disabled: true })]])
  const plan = planOperations(
    targets,
    [{ id: 'alpha', disabled: true }],
    parseOps([
      { kind: 'enable', id: 'alpha' },
      { kind: 'setConfig', id: 'alpha', config: 'keep: 2\n' },
    ]),
    dialect,
    () => true,
  )

  assert.deepEqual(plan.rows, [{ id: 'alpha', disabled: false, config: { keep: 2 } }])
  assert.ok(plan.warnings.some((warning) => warning.code === 'CONFIG_FIELD_DROPPED'))
})

test('invalid plans return 422 before producing a writable candidate', () => {
  const targets = new Map([['alpha', target()]])
  const invalid = [
    [{ kind: 'enable', id: 'missing' }],
    [{ kind: 'insert', id: 'alpha', name: 'pkg-duplicate' }],
    [{ kind: 'setConfig', id: 'alpha', config: '[]' }],
  ]

  for (const operations of invalid) {
    assert.throws(
      () => planOperations(targets, [], parseOps(operations), dialect, () => true),
      (error: unknown) => error instanceof HttpError && error.status === 422,
    )
  }
})

test('uninstalled swap is atomic: it refuses instead of disabling the old provider', () => {
  const targets = new Map([['alpha', target()]])
  assert.throws(
    () => planOperations(
      targets,
      [],
      parseOps([{ kind: 'swap', seam: 'fs', from: 'alpha', to: { id: 'beta', name: 'pkg-beta' } }]),
      dialect,
      () => false,
    ),
    (error: unknown) => error instanceof HttpError && error.status === 422 && error.message.includes('未安装'),
  )
})
