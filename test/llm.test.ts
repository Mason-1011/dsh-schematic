import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTranslateConfig } from '../src/llm.ts'

test('normalizeTranslateConfig: absent means the host default', () => {
  assert.equal(normalizeTranslateConfig(undefined), null)
  assert.equal(normalizeTranslateConfig(null), null)
  assert.deepEqual(normalizeTranslateConfig({}), null)
})

test('normalizeTranslateConfig: a full override passes through trimmed', () => {
  assert.deepEqual(
    normalizeTranslateConfig({ provider: ' deepseek-official ', model: 'deepseek-chat' }),
    { provider: 'deepseek-official', model: 'deepseek-chat' },
  )
})

test('normalizeTranslateConfig: half an override is refused', () => {
  assert.throws(() => normalizeTranslateConfig({ provider: 'deepseek-official' }), /必须同时给出/)
  assert.throws(() => normalizeTranslateConfig({ model: 'deepseek-chat' }), /必须同时给出/)
})

test('normalizeTranslateConfig: unknown keys and wrong shapes fail loud', () => {
  assert.throws(() => normalizeTranslateConfig({ provider: 'a', model: 'b', apiKey: 'sk-x' }), /未知字段/)
  assert.throws(() => normalizeTranslateConfig('nope'), /必须是映射对象/)
  assert.throws(() => normalizeTranslateConfig([1]), /必须是映射对象/)
  assert.throws(() => normalizeTranslateConfig({ provider: '', model: 'b' }), /非空字符串/)
  assert.throws(() => normalizeTranslateConfig({ provider: 'a', model: 3 }), /非空字符串/)
})
