import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require('./runtime-packages.cjs').runtimeRequire('playwright');
const reservation = createServer();
reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
env.MUSE_DESKTOP_TEST_USER_DATA = await mkdtemp(path.join(tmpdir(), 'muse-portable-profile-'));
// The portable wrapper does not forward Electron's debugger pipe to Playwright.
// A temporary local CDP port verifies the actual extracted app; normal launch has no port.
const child = spawn(path.resolve(process.argv[2] || 'artifacts/self-build/Muse Desktop.exe'), [`--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: 'ignore' });
const ended = once(child, 'close');
let browser;
try {
  const deadline = Date.now() + 45000;
  while (true) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('Portable app did not open its test connection.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  async function waitState(predicate, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (true) {
      const state = await page.evaluate(() => window.muse.getState());
      if (predicate(state)) return state;
      if (Date.now() > deadline) throw new Error('Timed out waiting for native app state.');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await waitState(state => state.connection === 'ready' && !state.loading);
  assert.equal(await page.evaluate(() => typeof window.muse.sendMessage), 'function');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  // Wait for startup's native history restoration, not just catalog discovery.
  await page.waitForTimeout(1500);
  await waitState(state => !state.loading);
  const created = await page.evaluate(() => window.muse.newChat());
  const sessionId = created.sessionId;
  const marker = `PORTABLE_OK_${Date.now()}`;
  await page.evaluate(() => window.muse.setOptions({ reasoningEffort: 'minimal', executionMode: 'readonly' }));
  await page.locator('.message.assistant').waitFor({ state: 'detached' });
  await page.locator('#prompt').fill(`Reply with exactly ${marker}.`);
  await page.locator('#prompt').press('Enter');
  await waitState(state => state.busy && state.finishing && state.items.some(item => item.kind === 'agentMessage' && item.text?.includes(marker)), 90000);
  await page.locator('#working-label').filter({hasText:'Reply ready'}).waitFor();
  await page.locator('#prompt').fill('Next draft while final checks finish');
  await page.screenshot({path:'artifacts/muse-portable-finishing.png'});
  await waitState(state => state.sessionId === sessionId && !state.busy && state.items.some(item => item.kind === 'agentMessage' && item.text?.includes(marker)), 90000);
  let state = await page.evaluate(() => window.muse.getState());
  assert.equal(state.error, '');
  await page.locator('.message.assistant').filter({ hasText: marker }).waitFor();
  assert.equal(await page.locator('.message.user').count(), 1);
  assert.equal(await page.locator('#prompt').inputValue(),'Next draft while final checks finish');
  await page.locator('#prompt').fill('');
  await page.evaluate(() => window.muse.newChat());
  await page.evaluate(id => window.muse.resumeChat(id), sessionId);
  state = await page.evaluate(() => window.muse.getState());
  assert.equal(state.sessionId, sessionId);
  assert.equal(state.items.some(item => item.kind === 'agentMessage' && item.text?.includes(marker)), true);
  await page.locator('.message.assistant').filter({ hasText: marker }).waitFor();
  await page.screenshot({ path: 'artifacts/muse-desktop-portable.png' });
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.muse.setOptions({ reasoningEffort: 'max' }));
  await page.evaluate(() => window.muse.newChat());
  console.log('PASS actual portable EXE: connected, isolated preload, real assistant reply, final checks phase, next draft retained, saved history restored, no terminal error');
  await page.evaluate(() => window.close());
  await ended;
  console.log('PASS portable process exited cleanly');
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await ended;
  }
}
