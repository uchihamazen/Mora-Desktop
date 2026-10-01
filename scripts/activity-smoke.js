import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { _electron } = require('./runtime-packages.cjs').runtimeRequire('playwright');
const workspace = await mkdtemp(path.join(tmpdir(), 'muse-activity-smoke-'));
const packaged = process.argv[2];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
env.MUSE_DESKTOP_TEST_USER_DATA = await mkdtemp(path.join(tmpdir(), 'muse-activity-profile-'));
const electron = await _electron.launch({ executablePath: packaged || require('electron'), args: packaged ? [] : ['.'], cwd: process.cwd(), env });
try {
  const page = await electron.firstWindow();
  async function waitState(predicate, timeout = 120000) {
    const deadline = Date.now()+timeout;
    while (true) {
      const state = await page.evaluate(() => window.muse.getState());
      if (predicate(state)) return state;
      if (Date.now() > deadline) throw new Error('Activity smoke timed out');
      await new Promise(resolve => setTimeout(resolve,100));
    }
  }
  await page.locator('#connection-badge').filter({hasText:'Connected'}).waitFor();
  await page.waitForTimeout(2000);
  await waitState(state => !state.loading);
  await electron.evaluate(({dialog},folder) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[folder]}); },workspace);
  await page.evaluate(() => window.muse.chooseWorkspace());
  await page.evaluate(() => window.muse.setOptions({reasoningEffort:'max',executionMode:'readonly'}));
  await page.locator('#prompt').fill('تمام يا برنس، كنت بس بتأكد منك. رد بجملة واحدة قصيرة من غير أدوات.');
  await page.locator('#prompt').press('Enter');
  await waitState(state => state.busy && state.finishing);
  await page.locator('#working-label').filter({hasText:'Reply ready'}).waitFor();
  assert.equal(await page.locator('#prompt').isEnabled(),true);
  await page.locator('#prompt').fill('مسودة الرسالة التالية');
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/muse-finishing.png'});
  await waitState(state => !state.busy);
  assert.equal(await page.locator('#prompt').inputValue(),'مسودة الرسالة التالية');
  console.log('PASS real max-effort response: final checks shown, next draft editable and retained');
  await page.evaluate(() => window.muse.setOptions({reasoningEffort:'minimal',executionMode:'full'}));
  await page.locator('#prompt').fill('Only in this temporary workspace: create activity-proof.txt containing ACTIVITY_OK. Then run PowerShell command Get-Content activity-proof.txt and include description "Read activity proof". Do not use other projects. Reply briefly.');
  await page.locator('#prompt').press('Enter');
  const toolState = await waitState(state => state.items.some(item => item.commandText?.includes('Get-Content') && item.commandText.includes('activity-proof.txt')));
  const card = toolState.items.find(item => item.commandText?.includes('Get-Content'));
  assert.ok(card.args); assert.ok(card.description);
  await page.locator('.tool-card').filter({hasText:'Get-Content'}).first().waitFor();
  await waitState(state => !state.busy);
  assert.equal((await readFile(path.join(workspace,'activity-proof.txt'),'utf8')).trim(),'ACTIVITY_OK');
  const final = await page.evaluate(() => window.muse.getState());
  assert.equal(final.error,'');
  const finalCard = final.items.find(item => item.commandText?.includes('Get-Content'));
  assert.match(finalCard.visibleOutput,/ACTIVITY_OK/);
  const target = page.locator('.tool-card').filter({hasText:'Get-Content'}).first();
  if (!(await target.evaluate(el=>el.open))) await target.locator('summary').click();
  await page.screenshot({path:'artifacts/muse-command-activity.png'});
  console.log('PASS real project tools: exact command, description, output, native history retained');
} finally {
  await electron.close();
}
