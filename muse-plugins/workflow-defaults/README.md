# Muse workflow defaults

This local Windows SessionStart plugin loads the original using-superpowers bootstrap,
Muse tool mapping, and Ponytail core instructions from bundled UTF-8 files.
The full libraries are installed separately as `superpowers` 6.4.2 and
`engineering-suite-ponytail` 2.0.0. Installation is user-wide and requires no EXE rebuild.

The optional plugin requires Node.js 24+ on PATH on each machine; its hook uses `node`
without a username or author-specific runtime path. Mora Desktop itself bundles its
runtime and does not require Node to launch. The hook only reads
its bundled instructions and writes Muse's documented additionalContext JSON to stdout.
It does not access credentials or alter approvals, sandboxing, project files, or model settings.

Source instructions were copied unchanged from the user's existing Codex plugin bundles.
Their respective licenses are included. Sources:
- Superpowers: https://github.com/obra/superpowers
- Ponytail: the installed engineering-suite-ponytail 2.0.0 bundle.

Install or update from this source directory with `muse plugins install <path> --scope user`
or `muse plugins update workflow-defaults`, then approve the session-start capability.
After updating either skill library, refresh the copied bootstrap instructions here,
update the plugin, and approve its changed hook definition if Muse requests it.

Disable automatic startup instructions with `muse plugins disable workflow-defaults`.
The two skill libraries remain available for explicit use. Disable those separately with
`muse plugins disable superpowers` and `muse plugins disable engineering-suite-ponytail`.

Verify with `node --test tests/workflow-plugin.test.js` from the repository root; it
relocates the plugin to a folder with spaces, runs the manifest command and checks the
complete bundled context. Install both full skill libraries separately on a new machine;
this bootstrap is not a replacement for them or an automatic global installation.
