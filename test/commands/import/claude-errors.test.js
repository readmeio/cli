import { expect, test } from 'vitest';

import { getClaudeReasoningOptions, getStructuredOutput } from '../../../src/commands/import.js';

test('getClaudeReasoningOptions uses adaptive thinking for Sonnet 5', () => {
  expect(getClaudeReasoningOptions('claude-sonnet-5')).toStrictEqual({
    thinking: { type: 'adaptive' },
    effort: 'medium',
  });
  expect(getClaudeReasoningOptions('sonnet')).toStrictEqual({
    thinking: { type: 'adaptive' },
    effort: 'medium',
  });
});

test('getClaudeReasoningOptions leaves older model reasoning unchanged', () => {
  expect(getClaudeReasoningOptions('haiku')).toStrictEqual({});
});

test('getStructuredOutput includes Claude SDK execution errors', () => {
  expect(() =>
    getStructuredOutput({
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['API Error: 401 invalid x-api-key'],
    }),
  ).toThrow(/Claude failed: error_during_execution — API Error: 401 invalid x-api-key/);
});

test('getStructuredOutput includes response diagnostics when structured output is absent', () => {
  expect(() =>
    getStructuredOutput({
      type: 'result',
      subtype: 'success',
      api_error_status: 401,
      result: 'Authentication failed',
    }),
  ).toThrow(/Claude returned no structured output — API status 401; Authentication failed/);
});

test('getStructuredOutput returns valid structured output', () => {
  const output = { categories: [] };
  expect(getStructuredOutput({ type: 'result', subtype: 'success', structured_output: output })).toStrictEqual(output);
});
