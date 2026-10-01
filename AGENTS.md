# Project guidance

## GitHub publication

Future changes are intended for the public GitHub repository. Keep source, tests,
public feature documentation and build instructions ready to publish. After a change
is verified, refresh the clean source archive and checksum; rebuild Setup when the
application changes. State which artifacts are current and which checks ran.

Never publish local Git history containing personal paths, internal development
records, chat/session history, user profiles, backups, credentials, API keys or
machine-specific settings. Preserve user data locally. The first publication uses
the clean source archive in a new repository; later updates use that public repository's
history. Preserve third-party licenses and artwork attribution. Prepare updates locally;
pushes and GitHub Releases require a direct user request.

## Feature documentation

After adding or changing a feature, update the project's existing feature document. If there is none, use `docs/features.md`.

Keep each feature entry short: at most five concise bullets covering:
- Purpose and expected behavior.
- Required inputs, dependencies, and permissions, only where relevant.
- Important constraints and what is outside the feature's scope.
- The key best-practice decision and its reason, when useful for future changes.
- How to verify the feature, including any known limitation.

Write for the next agent: it should quickly understand what is needed and what is not. Describe the final behavior and meaningful constraints. Avoid implementation diaries, exhaustive file lists, copied code, repeated context, and unnecessary detail. Update the existing entry rather than creating duplicates. Scale the documentation to the change; a minor adjustment can be a one-line update.

## Desktop rebuilds

When building from inside Mora Desktop, use a separate output directory: `electron-builder --win portable --x64 --config.directories.output=artifacts/self-build`. Ensure Node and pnpm are available in the command environment. Await the build to exit successfully; an assistant reply or a background session is not build completion. Do not overwrite the running `dist/Mora Desktop.exe` or close this app from its own engine: quitting stops the engine process tree. Verify the staged package, then replace the installed EXE from an external process after closing the old app. Preserve its path for the Start menu shortcut.

The installed desktop runs directly from `dist` with its Electron resources alongside the EXE. After verifying the build, deploy the complete `win-unpacked` folder using `scripts/install-desktop.ps1` from an external terminal. Do not replace the installed EXE with the portable wrapper: its temporary extraction caused an antivirus behavior alert. This deployment does not alter antivirus settings or provide a trusted signing certificate.
