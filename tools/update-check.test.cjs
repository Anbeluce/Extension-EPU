const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../background/service-worker.js'), 'utf8');
function setup(fetch) {
  const event = { addListener() {} };
  const context = vm.createContext({
    importScripts() {}, fetch, AbortController, setTimeout, clearTimeout,
    chrome: { runtime: { onMessage: event, onStartup: event, onInstalled: event, getManifest: () => ({ version: '0.4.1' }) }, commands: { onCommand: event }, alarms: { onAlarm: event } },
  });
  vm.runInContext(source, context);
  return context;
}
test('update check compares numeric versions and rejects invalid metadata', async () => {
  for (const [version, available] of [['0.4.1', false], ['0.4.1.0', false], ['0.4.0', false], ['0.4.2', true], ['0.10.0', true]]) {
    const context = setup(async () => Response.json({ version }));
    const result = await context.checkExtensionUpdate();
    assert.equal(result.available, available);
    assert.equal(result.url, 'https://github.com/Anbeluce/Extension-EPU/archive/refs/heads/main.zip');
  }
  const invalid = setup(async () => Response.json({ version: '<script>' }));
  assert.equal((await invalid.checkExtensionUpdate()).ok, false);
});
test('simultaneous requests share fetch; later visits check again; network errors are handled', async () => {
  let count = 0;
  const context = setup(async () => { count++; return Response.json({ version: '0.4.2' }); });
  await Promise.all([context.checkExtensionUpdate(), context.checkExtensionUpdate()]);
  assert.equal(count, 1);
  await context.checkExtensionUpdate();
  assert.equal(count, 2);
  assert.equal((await setup(async () => { throw Error('offline'); }).checkExtensionUpdate()).ok, false);
  assert.equal((await setup(async () => new Response('', { status: 404 })).checkExtensionUpdate()).ok, false);
});
