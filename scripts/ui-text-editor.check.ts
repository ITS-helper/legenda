import assert from 'node:assert/strict'
import { deepMergeUiText } from '../src/lib/uiTextEditor.ts'

const merged = deepMergeUiText(
  { a: 'x', nested: { left: 'keep', right: 'replace' } },
  { nested: { right: 'done' } },
)

assert.deepEqual(merged, {
  a: 'x',
  nested: { left: 'keep', right: 'done' },
})

console.log('deepMergeUiText ok')
