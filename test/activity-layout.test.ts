import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  ActivityLayoutStore, defaultActivityLayout, parseActivityLayout,
} from '../src/activity/layout.ts'

test('the default activity layout retains the eight-stage journey', () => {
  const layout = defaultActivityLayout()
  assert.equal(layout.groups.length, 8)
  assert.equal(layout.groups.filter((group) => group.lane === 'flow').length, 6)
  assert.equal(layout.groups.filter((group) => group.lane === 'side').length, 2)
  assert.ok(layout.groups.every((group) => group.label.en && group.label.zh))
})

test('activity layouts reject ambiguous membership and malformed groups', () => {
  const duplicate = defaultActivityLayout()
  duplicate.groups[0].memberIds = ['include:tools']
  duplicate.groups[1].memberIds = ['include:tools']
  assert.throws(() => parseActivityLayout(duplicate), /多个分组/)

  const lane = defaultActivityLayout() as unknown as { groups: { lane: string }[] }
  lane.groups[0].lane = 'middle'
  assert.throws(() => parseActivityLayout(lane), /flow\|side/)

  const id = defaultActivityLayout()
  id.groups[0].id = 'Not Valid'
  assert.throws(() => parseActivityLayout(id), /小写字母/)
})

test('activity layout store saves, reads, and resets one profile document', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schematic-layout-'))
  try {
    const store = new ActivityLayoutStore(join(dir, 'layout.json'))
    assert.equal(store.read().customized, false)
    const draft = defaultActivityLayout()
    draft.name = 'My operating model'
    draft.groups[0].memberIds = ['include:web']
    const saved = store.save(draft)
    assert.ok(saved.updatedAt)
    assert.deepEqual(store.read(), { layout: saved, customized: true })
    assert.equal(store.reset().name, 'Message journey')
    assert.equal(store.read().customized, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
