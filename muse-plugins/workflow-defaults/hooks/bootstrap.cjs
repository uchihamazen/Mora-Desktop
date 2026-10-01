const { readFileSync } = require('node:fs');
const path = require('node:path');
// Read only bundled workflow instructions; no credentials, commands, or project writes.
const root = path.resolve(__dirname, '..');
const files = ['defaults.md', 'using-superpowers.md', 'muse-tools.md', 'ponytail.md'];
const additionalContext = files.map(file => readFileSync(path.join(root, 'instructions', file), 'utf8')).join('\n\n');
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
