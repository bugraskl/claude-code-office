'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { startServer } = require('../src/server');

async function withServer(opts, fn) {
  const server = await startServer({ port: 0, host: '127.0.0.1', root: os.tmpdir(), hide: [], ...opts });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test('serves the page and the demo state', async () => {
  await withServer({ demo: true }, async (base) => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /importmap/);
    const state = await (await fetch(base + '/api/state?hours=3')).json();
    assert.equal(state.demo, true);
    assert.ok(state.sessions.length >= 4);
    const statuses = new Set(state.sessions.flatMap((s) => [s.status, ...s.subagents.map((a) => a.status)]));
    for (const s of ['blocked', 'away']) assert.ok(statuses.has(s), `demo shows ${s}`);
  });
});

test('refuses paths outside the public folder', async () => {
  await withServer({ demo: true }, async (base) => {
    const r = await fetch(base + '/..%2F..%2Fpackage.json');
    assert.notEqual(r.status, 200);
  });
});
