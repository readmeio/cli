import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getClaudeReasoningOptions, getStructuredOutput } from '../src/commands/import.js'

test('getClaudeReasoningOptions uses adaptive thinking for Sonnet 5', () => {
  assert.deepEqual(getClaudeReasoningOptions('claude-sonnet-5'), {
    thinking: { type: 'adaptive' },
    effort: 'high',
  })
  assert.deepEqual(getClaudeReasoningOptions('sonnet'), {
    thinking: { type: 'adaptive' },
    effort: 'high',
  })
})

test('getClaudeReasoningOptions leaves older model reasoning unchanged', () => {
  assert.deepEqual(getClaudeReasoningOptions('haiku'), {})
})

test('getStructuredOutput includes Claude SDK execution errors', () => {
  assert.throws(
    () =>
      getStructuredOutput({
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['API Error: 401 invalid x-api-key'],
      }),
    /Claude failed: error_during_execution — API Error: 401 invalid x-api-key/,
  )
})

test('getStructuredOutput includes response diagnostics when structured output is absent', () => {
  assert.throws(
    () =>
      getStructuredOutput({
        type: 'result',
        subtype: 'success',
        api_error_status: 401,
        result: 'Authentication failed',
      }),
    /Claude returned no structured output — API status 401; Authentication failed/,
  )
})

test('getStructuredOutput returns valid structured output', () => {
  const output = { categories: [] }
  assert.equal(
    getStructuredOutput({ type: 'result', subtype: 'success', structured_output: output }),
    output,
  )
})
