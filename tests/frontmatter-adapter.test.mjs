import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceQuotedWikiLinkList } from '../src/frontmatter-adapter.mjs';

const property = 'Related Items';
const quoted = `---\nComponents: []\n"${property}":\n  - "[[Public Fixtures/Item One]]"\nAmount Exact: "20.0000"\n---\n\n# Quoted Fixture\n`;
const unquoted = quoted.replace(`"${property}":`, `${property}:`);

test('mutates a quoted wiki-link list and preserves unrelated bytes', () => {
  const result = replaceQuotedWikiLinkList(quoted, property, ['[[Public Fixtures/Item Two]]']);
  assert.match(result, /^"Related Items":\n  - "\[\[Public Fixtures\/Item Two\]\]"$/m);
  assert.equal(result.replace(/^"Related Items":\n  - .*\n/m, ''), quoted.replace(/^"Related Items":\n  - .*\n/m, ''));
});

test('repairs the frozen unquoted failure shape while changing the value', () => {
  const result = replaceQuotedWikiLinkList(unquoted, property, ['[[Public Fixtures/Item One]]']);
  assert.match(result, /^"Related Items":/m);
  assert.doesNotMatch(result, /^Related Items:/m);
  assert.match(result, /^Components: \[\]$/m);
  assert.match(result, /^Amount Exact: "20\.0000"$/m);
});

test('supports an empty relationship without changing the key contract', () => {
  const result = replaceQuotedWikiLinkList(quoted, property, []);
  assert.match(result, /^"Related Items": \[\]$/m);
});

test('supports apostrophes in paths while retaining double-quoted YAML', () => {
  const result = replaceQuotedWikiLinkList(unquoted, property, ["[[Public Fixtures/Jo's Item]]"]);
  assert.match(result, /^"Related Items":\n  - "\[\[Public Fixtures\/Jo's Item\]\]"$/m);
  assert.doesNotMatch(result, /^Related Items:/m);
});

test('rejects duplicate, missing, malformed, and unsupported inputs', () => {
  assert.throws(() => replaceQuotedWikiLinkList(`${quoted.replace('\n---\n', '\n"Related Items": []\n---\n')}`, property, []), /exactly once/);
  assert.throws(() => replaceQuotedWikiLinkList(quoted.replace(/^"Related Items":\n  - .*\n/m, ''), property, []), /exactly once/);
  assert.throws(() => replaceQuotedWikiLinkList(quoted.replace(/^"Related Items":\n  - .*\n/m, '"Related Items": {}\n'), property, []), /unsupported inline shape/);
  assert.throws(() => replaceQuotedWikiLinkList(quoted, property, ['not a wiki link']), /unsupported wiki link/);
  assert.throws(() => replaceQuotedWikiLinkList(quoted, property, ['PRIVATE-VALUE']), (error) => !error.message.includes('PRIVATE-VALUE'));
  assert.throws(() => replaceQuotedWikiLinkList(quoted.replace(/^---\n/, '---\r\n'), property, []), /byte zero with LF/);
});
