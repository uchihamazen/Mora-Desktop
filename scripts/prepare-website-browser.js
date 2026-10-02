import {chromium} from 'playwright';
import {cp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
if(process.platform!=='win32'||process.arch!=='x64')throw Error('The desktop browser package currently targets Windows x64.');
const cache=path.resolve('artifacts/browser-runtime'),browserFolder=path.basename(path.dirname(path.dirname(chromium.executablePath())));
const executable=path.join(cache,browserFolder,'chrome-win64','chrome.exe');
// Refresh from the vendor archive: launching Chromium can add machine-local
// files alongside the executable, which must never enter a release package.
execFileSync(process.execPath,[path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js'),'install','--force','chromium','--no-shell'],{stdio:'inherit',windowsHide:true,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:cache}});
const target=path.resolve('artifacts/website-browser');if(!target.startsWith(path.resolve('artifacts')+path.sep))throw Error('Invalid staged browser directory.');await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
await cp(path.dirname(executable),target,{recursive:true,force:true});
const browser=await chromium.launch({executablePath:executable,headless:true});
try{const page=await browser.newPage();await page.goto('chrome://credits');await writeFile(path.join(target,'LICENSES.chromium.html'),await page.content());}finally{await browser.close();}
for(const name of ['LICENSE','NOTICE'])await cp(path.join(path.dirname(require.resolve('playwright/package.json')),name),path.join(target,'PLAYWRIGHT-'+name));
await writeFile(path.join(target,'mora-browser.json'),JSON.stringify({playwright:require('playwright/package.json').version,browser:path.basename(path.dirname(path.dirname(chromium.executablePath())))}));
console.log('Prepared the pinned Windows browser for desktop packaging.');
