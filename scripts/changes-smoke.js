import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { _electron } = require('./runtime-packages.cjs').runtimeRequire('playwright');
const workspace = await mkdtemp(path.join(tmpdir(), 'muse-real-changes-'));
await writeFile(path.join(workspace, 'fixture.txt'), 'before\n');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
env.MUSE_DESKTOP_TEST_USER_DATA = await mkdtemp(path.join(tmpdir(), 'muse-changes-profile-'));
const electron = await _electron.launch({ executablePath: process.argv[2] || require('electron'), args: process.argv[2] ? [] : ['.'], cwd: process.cwd(), env });
try {
  const page = await electron.firstWindow();
  async function waitState(predicate, timeout = 120000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.muse.getState());
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the real file change review.');
  }
  await waitState(state => state.connection === 'ready' && !state.loading);
  await page.waitForTimeout(2000); // Startup restores saved native history after catalog discovery.
  await waitState(state => !state.loading);
  await electron.evaluate(({dialog}, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, workspace);
  await page.evaluate(() => window.muse.chooseWorkspace());
  await page.evaluate(() => window.muse.setOptions({ reasoningEffort: 'minimal', executionMode: 'full' }));
  await page.evaluate(() => window.muse.sendMessage({ text: 'Approved exact fixture edit for a UI integration test: replace fixture.txt contents with exactly after followed by a newline, then added followed by a newline. Use write_file. Then run PowerShell Start-Sleep -Seconds 5 (description: Checking live file review) before replying UPDATED. Change only fixture.txt, no documentation or other files; the exact edit and wait are approved.' }));
  const live = await waitState(state => state.busy && state.items.some(item => item.kind === 'fileChanges' && item.live));
  assert.equal(live.items.find(item=>item.kind==='fileChanges').added,2);
  assert.ok(live.items.some(item=>item.kind==='activity'), 'Real model preparation should be visible during execution');
  assert.ok(live.items.some(item=>item.kind==='toolCall' && item.tool==='write_file' && item.args?.includes('fixture.txt')));
  await page.locator('.change-badge').click();
  await page.locator('.diff-line.added').first().waitFor();
  assert.match(await page.locator('.changes-header').textContent(),/Live/);
  await page.screenshot({path:'artifacts/muse-live-file-changes.png'});
  let state = await waitState(state => !state.busy && state.items.some(item => item.kind === 'fileChanges'));
  await writeFile('artifacts/changes-smoke-state.json', JSON.stringify({sessionId:state.sessionId,error:state.error,busy:state.busy,items:state.items.map(item=>({kind:item.kind,itemId:item.itemId,turnId:item.turnId,files:item.files,added:item.added,removed:item.removed}))},null,2));
  const item = state.items.find(item => item.kind === 'fileChanges');
  assert.equal(state.error, ''); assert.equal(item.files.length, 1); assert.equal(item.added, 2); assert.equal(item.removed, 1);
  assert.equal(await readFile(path.join(workspace, 'fixture.txt'), 'utf8'), 'after\nadded\n');
  assert.equal(item.live,false);
  assert.equal(state.items.filter(item=>item.kind==='fileChanges').length,1);
  if (!await page.locator('.changes-panel').count()) await page.locator('.change-badge').click();
  await page.locator('.diff-line.added').first().waitFor();
  await page.screenshot({ path: 'artifacts/muse-real-file-changes.png' });
  const sessionId = state.sessionId;
  await page.evaluate(() => window.muse.newChat());
  await page.evaluate(id => window.muse.resumeChat(id), sessionId);
  state = await page.evaluate(() => window.muse.getState());
  assert.equal(state.items.find(row => row.kind === 'fileChanges')?.itemId, item.itemId);
  await page.locator('.change-badge').waitFor();
  console.log('PASS real Muse edit: live +2/-1 while engine busy, open colored diff, single final review, persistent after reopening chat');
} finally {
  await electron.close();
}
