# Features

## Chat and project operations
- Arabic/English chat, image attachments, saved native Muse conversations, and project selection.
- Requires the installed and signed-in Muse engine; no extra model API key or credential copy.
- Read only inspects; Full access permits project edits and commands under the user's Windows permissions.
- Uses Muse 1.4.1's working `exec --json` interface; interactive per-command approvals remain available in the native terminal.
- Verify with the existing frontend and real-engine smoke scripts; these operate on temporary projects where they write files.

## Conversation retention
- All normal launches, including Windows Search, use `%APPDATA%\Muse Desktop`; builds and workspace changes retain conversations until explicit deletion.
- A separate conversation index and its latest atomic backup protect the sidebar from settings resets; existing preferences migrate automatically without importing unrelated native/test sessions.
- Saved messages load before engine connection; native log lookup follows local calendar folders and locates retained UTC/other-day logs by validated session ID. A damaged index with no readable backup stops startup and preserves files.
- Desktop smoke tests use an explicit temporary profile via `MUSE_DESKTOP_TEST_USER_DATA`, never restore old snapshots over user preferences, and require an absolute profile path.
- Verify persistence/recovery/deletion tests and `scripts/history-smoke.js`: restart from another working folder, restore native messages, and keep the real profile untouched.

## Projects and general chats
- Sidebar groups conversations under collapsible project folders, with a + for a new chat in that project; Add project chooses a local folder. New conversation / Ctrl N starts a general chat for questions and images.
- Existing chats keep their IDs, messages, and saved workspace; absent project identity uses the legacy workspace. Full Windows paths distinguish folders, including projects with the same name.
- Explicit null project identity keeps general chats separate on reopen; the engine uses a private profile folder and Read only, without inheriting the previously selected project or its Full access setting. This is not a filesystem sandbox.
- Project paths and chat identity persist in the existing conversation index and backup; project entries remain after their last chat is deleted. Full access remains available in project chats.
- Verify grouping/lifecycle/persistence/date-boundary tests, `scripts/frontend-smoke.js`, and `scripts/projects-smoke.js [EXE] --send` for two real general replies with context and enabled sending after restart; tests use temporary profiles.

## Missing engine history recovery
- If a log is genuinely missing, recover available text from its view journal and show a notice; dismissal survives UI refreshes, expires when that error clears, and healthy chats clear stale notices.
- Recovered chats stay viewable; sending requires restoring the original log from a backup/quarantine or starting a new chat. Only explicitly unused chats with no cached messages can proceed without a log; titles never determine usage.
- Reads local cached notifications for the exact session only, preserves message revisions, and executes no cached tools; availability depends on retained Muse cache, with a 64 MiB journal limit.
- This restores display text, not engine context or a complete tool transcript; no native logs or antivirus settings are rewritten.
- Verify cached-history parsing and missing-log lifecycle tests; inspect the real recovered chat and test Full access independently in a temporary profile.

## Activity and completion
- Shows real model preparation steps, public Muse messages, tool descriptions, exact commands, output and exit codes during execution; elapsed time uses `2m 15s` and 14px text.
- Native logs supply details absent from CLI events; preparation indicators are live only, while native messages/tools remain in saved history. Displays observable work, without inventing reasoning or progress.
- A visible reply may precede native completion; sending while busy queues and auto-runs (see Send queue).
- Stop cancels the active process tree; completed file changes remain.
- Verify with `node scripts/activity-smoke.js` and the existing lifecycle tests.

## Branding
- Meta's blue symbol appears in the EXE/window icon, sidebar, welcome screen, and assistant avatars; “make happen” uses `#0082FB`.
- Local SVG and multi-size ICO assets require no runtime image service or new app dependency.
- Preserve the original artwork and recorded attribution in `src/assets/README.md`.
- Verify with the frontend/packaged UI smoke and inspect the rebuilt EXE icon.

## Windows Start and Search
- A current-user Start menu shortcut registers the app as “Muse Desktop”, searchable by “Muse”.
- Targets `Muse Desktop.exe` in the chosen Setup folder (local development uses `dist`) and uses its embedded Meta icon; no extra runtime or administrator permission is required.
- Keep the target path stable when rebuilding. Verify the saved shortcut target/icon and confirm `Get-StartApps` lists Muse Desktop.
- Reopening the EXE reveals and focuses an existing hidden/minimized window; verify with `scripts/window-smoke.js` rather than treating a running process as proof of a visible app.

## Desktop installation and antivirus compatibility
- The installed app runs directly from its installation folder with the complete Electron package beside it; local development uses `dist/Muse Desktop.exe`. Startup does not extract another EXE into a random temporary folder.
- Deploy a verified staged `win-unpacked` folder with `scripts/install-desktop.ps1` after closing the app, from an external terminal; the stable shortcut, Meta icon, chat data, and engine permissions remain.
- The installer backs up the previous EXE/app archive, checks required resources and installed hashes, and refuses to overwrite a running installed app.
- Packaging removes the portable extraction stage; binaries remain unsigned without a trusted code-signing certificate, and antivirus acceptance is not guaranteed. No exclusions or security settings are changed automatically.
- Verify packaged history/UI tests and direct shortcut launch; review any remaining behavioral alert with the antivirus vendor or apply an explicit app-only exception manually.

## Muse-wide workflow defaults
- Superpowers and Ponytail are installed for the user, with a SessionStart hook that loads their startup instructions in every project.
- Requires Node on PATH and an approved `workflow-defaults` hook on each machine; full skill libraries install separately and relevant skills load on demand.
- The hook reads bundled instructions only. It does not change credentials, permissions, model settings, or project files.
- Per-project instructions and direct user requests remain authoritative; feature documentation stays concise under `AGENTS.md`.
- Verify the hook with Muse's native `plugins hook test`, inspect the plugin skill catalog, and check a fresh session. Restart existing sessions after installation.

## Hover delete icon for conversations

- Each conversation row in the sidebar shows a small `X` icon when hovered (keyboard: visible on focus). First click arms it (turns red), second click deletes.
- Deleting removes the conversation from the sidebar, clears the open view if it was active, and deletes its native engine history folder. No confirmation dialog beyond the two-click arm.
- Outside scope: bulk delete, undo/restore, deleting the active chat while a request runs (must Stop first) or while a conversation loads.
- Decision: reused the existing `#i-x` SVG symbol and `deleteChat` IPC/Main logic; the change is renderer markup plus CSS only, so the five `delete-chat` main-process tests still apply unchanged.
- Verification: `scripts/frontend-smoke.js` covers hover/focus, arm-then-delete clicks, and the `deleteChat` call; the existing deletion and lifecycle tests cover the main process.

## Building while Muse Desktop is open
- Build into a separate output folder (for example `artifacts/self-build`) while the installed app remains open.
- Wait for exit code 0 and verify the package before deploying its complete `win-unpacked` folder with the external installer; keep the portable artifact for optional distribution only.
- Closing Muse Desktop stops its engine process tree; use an external terminal/Codex for replacement after closing the old app.
- Keep the installed EXE path stable so the Windows Search shortcut continues working.

## File change review
- Full access requests update a Live file count and green/red line totals during edits; an open diff updates while preserving the selected file, scroll and keyboard focus.
- Watches changes with debounced, serialized comparisons against the initial snapshot, excluding pre-existing edits and including concurrent external edits; closes the watcher before the final saved review, with final review as fallback if watching is unavailable.
- Uses installed Git for diff calculations, with the existing Codex Git runtime as a fallback; works in ordinary folders and respects Git ignore rules in repositories.
- Saves reviews per conversation until that chat is deleted; skips symlinks, generated folders outside Git, files over 2 MiB and snapshots over 32 MiB/5,000 files. Partial reviews are labelled; binary files have no line counts and long previews are truncated.
- Verify with the change/lifecycle tests, frontend smoke, and `scripts/changes-smoke.js` (real Muse edit and saved review); the panel is read-only, without accept/revert controls.

## Browser and design annotations
- A light Chromium panel opens HTTP/HTTPS pages and local development servers; Desktop fits a minimum 1280px CSS viewport and Mobile centers a 390px viewport. Expand fills the app window; Back to chat restores the split view. Cookies use the same persistent browser partition in both modes.
- Annotate selects an element or dragged region; Add to chat crops the screenshot to its visible bounds, preserving the highlight and selected HTML/URL/styles. Crop coordinates account for preview scaling, zoom and display density; context keeps original page bounds. Expanded view returns to the main composer for your request. Removing the screenshot removes its context.
- Navigation, Escape, scrolling, resizing or device switching clears selection; capture rejects a changed page. Device changes wait until the page loads or recovers. App/page zoom use their own coordinates; file/image review temporarily hides the native browser view.
- Web pages run sandboxed without Node or the Muse bridge; native permissions, downloads and non-web schemes are denied. HTML omits scripts, event handlers and form values, with a 24,000-character cap; frames are selected as outer elements, without inspecting frame contents.
- Uses Chromium's native device metrics after initializing a blank renderer, so responsive layouts apply before page scripts and survive navigation/reload. Verify `tests/browser.test.js`, frontend checks and `scripts/browser-smoke.js [EXE] [--send]` for viewport startup, native pointer selection, expansion, PNG/HTML handoff and page-crash recovery. Mobile is a responsive width preview, without phone hardware, touch or user-agent emulation.

## Google Stitch MCP
- Engine settings connects/tests/disconnects Stitch's native MCP server; Muse discovers its design tools on the next request in Desktop and PowerShell, with ordinary annotations sent through the existing image/text flow.
- Requires a Stitch account API key, including dotted keys (Profile → Stitch settings → API key); Test checks a pasted key without saving, and Connect verifies tools/account access before saving. The key lives in the standard local Muse settings HTTP header, outside projects and chat/state/error output.
- Preserves other settings/servers, keeps a backup and writes atomically; supports the existing canonical or legacy MCP root and refuses ambiguous or malformed settings. No extra runtime dependency or permission change.
- Uses the fixed HTTPS Stitch endpoint, optional startup with a 15-second budget and 300 seconds per native tool call; generation/authentication/quota depend on the user's account. This supplies UI design tools, without adding a separate app-side generator.
- Verify `tests/stitch.test.js` and `scripts/stitch-smoke.js [EXE]` (isolated connection/error/disconnect UI and a real Muse fixture MCP call). Live Google generation still requires a valid account key; it is not verified by the fixture.

## Send queue
- Sending while a request runs queues the message with a Queued badge and auto-runs queued messages FIFO when the current turn ends.
- Same inputs as a normal send (text plus PNG/JPEG/WebP images); no extra permission or new dependency.
- Stop discards the current turn and everything queued; at most 10 queued messages; the queue is in-memory and lost if the app quits.
- Decision: the main process owns the FIFO and drains it behind the first admission, so reloads cannot lose or duplicate entries.
- Verify with the lifecycle queue tests, `node scripts/frontend-smoke.js`, and `node scripts/ui-smoke.js --send` (two ordered replies on a temp profile).

## Stitch image previews
- Stitch image URLs in plain text or Markdown display directly in chat, including saved replies; click to enlarge and Escape to close. The embedded browser hides while the image viewer is open.
- Loads only HTTPS `lh3.googleusercontent.com` image paths under `/aida/` or `/aida-public/`, without API keys or referrers; code and other links remain literal.
- Uses native images/dialogs without downloads or new dependencies. Expired or inaccessible images show a fallback with Copy image link; previews depend on the original URL remaining available.
- Verify `tests/stitch-images.test.js`, frontend smoke and `scripts/stitch-images-smoke.js [EXE]` for loading, copy/failure fallback, zoom and browser occlusion.

## Windows distribution
- `pnpm run build` creates a versioned Windows x64 Setup in `artifacts/release`; per-user installation creates a Start/Search shortcut and preserves `%APPDATA%\Muse Desktop` on upgrades/uninstall. Local `build:desktop` stages in `artifacts/self-build`, preserving the existing `dist` installation.
- Each PC needs its own installed/signed-in Muse; full diff previews need Git. The desktop bundles its runtime. Optional workflow-defaults uses Node on PATH and separately installed skill libraries, without an author-specific path.
- Setup includes only application source/metadata; the source ZIP includes code/tests/public docs/plugins, excluding Git history, internal development records, outputs, dependencies, backups and chat profiles. First publication uses a new repository; older local commits contain personal paths. Private runtime filenames are ignored. The unsigned package does not modify security settings.
- A manual/tag-triggered Windows GitHub workflow tests and builds Setup plus SHA-256 checksum as downloadable artifacts; publishing a GitHub Release remains a separate action.
- `scripts/clean-local-builds.ps1` removes obsolete builds while retaining the installed app, releases, dependencies and chat/profile backups; `-WhatIf` previews targets. Verify archive membership, Node tests, relocated builds and installer smoke; another PC's Muse login requires testing there.

## Public documentation and licensing
- README covers features, per-chat context, setup, technology stack, workflows, privacy, limitations and contribution steps; source code uses the repository's MIT license.
- `THIRD_PARTY_NOTICES.md` preserves Meta/OpenAI brand ownership and separate artwork/service/dependency rights; it does not claim endorsement or trademark permission. Setup includes project license and notices alongside vendor licenses.
- Verify public source membership/privacy, README's relative links and packaged notices; original third-party license files remain intact.
