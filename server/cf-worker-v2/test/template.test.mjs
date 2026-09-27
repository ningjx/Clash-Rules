import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../../ClashConfigTemp.yaml', import.meta.url);
const snapshot = new URL('../src/template.yaml', import.meta.url);
const normalize = text => text.replace(/\r\n/g, '\n').replace(/ +$/gm, '');

test('bundled template matches the repository template', () => {
  assert.equal(normalize(readFileSync(snapshot, 'utf8')), normalize(readFileSync(root, 'utf8')));
});

test('bundled template retains the policy group type and name strings', () => {
  const text = readFileSync(snapshot, 'utf8');
  assert.match(text, /name: Microsoft\r?\n\s+type: select/);
  assert.match(text, /name: 最快节点\r?\n\s+type: url-test/);
  assert.doesNotMatch(text, /type: (?:selec|url-tes)\r?\n/);
});
