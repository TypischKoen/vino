import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputText } from '../js/ai-perplexity.js';

test('outputText pakt alle output_text uit message-items, zoals de SDK', () => {
  const response = {
    status: 'completed',
    output: [
      { type: 'search_results', results: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '1}' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'other', text: 'nee' }] },
    ],
  };
  assert.equal(outputText(response), '{"a":1}');
  assert.equal(outputText({ output: [] }), '');
  assert.equal(outputText({}), '');
});
