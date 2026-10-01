const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(path.resolve(__dirname, '../dist/Mora Desktop.exe'), [], {
  env, detached: true, windowsHide: true, stdio: 'ignore',
});
child.on('error', error => { console.error(`Mora Desktop could not open: ${error.message}`); process.exitCode = 1; });
child.unref();
