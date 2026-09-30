import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  loader: { '.html': 'text' },
});
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const template = readFileSync(new URL('../../../ClashConfigTemp.yaml', import.meta.url), 'utf8');
const request = new Request('https://worker.example/clash/sub?target=clash&url=https%3A%2F%2Fprovider.example%2Fsub');

test('each conversion reads the current repository template', async () => {
  let reads = 0;
  const fetchMock = mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://raw.githubusercontent.com/ningjx/Clash-Rules/master/ClashConfigTemp.yaml');
    reads++;
    return new Response(template.replace('time.is', `fresh-${reads}.example`), { status: 200 });
  });
  try {
    const first = await worker.fetch(request, {});
    const second = await worker.fetch(request, {});
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.match(await first.text(), /fresh-1\.example/);
    assert.match(await second.text(), /fresh-2\.example/);
    assert.equal(reads, 2);
  } finally {
    fetchMock.mock.restore();
  }
});

test('a repository fetch failure never generates a configuration from a bundled copy', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('network unavailable'); });
  try {
    const response = await worker.fetch(request, {});
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /获取仓库模板失败/);
  } finally {
    fetchMock.mock.restore();
  }
});

test('a missing repository template returns an error', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  try {
    const response = await worker.fetch(request, {});
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /HTTP 404/);
  } finally {
    fetchMock.mock.restore();
  }
});
