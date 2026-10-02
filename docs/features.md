# Features

## Chat and project operations
- Chat, image attachments, saved native Muse conversations, and project selection.
- Requires the installed and signed-in Muse engine; reconnects share one discovery attempt, reject malformed catalogs and reconcile the selected effort after model fallback.
- Read only inspects; Full access permits project edits and commands under the user's Windows permissions.
- Uses Muse 1.4.1's working `exec --json` interface and excludes foreign personal rules/skills on every turn; native workspace instructions and engine settings still apply. Interactive per-command approvals remain available in the native terminal.
- Verify with the existing frontend and real-engine smoke scripts; these operate on temporary projects where they write files.

## Conversation retention
- All normal launches, including Windows Search, use `%APPDATA%\Muse Desktop`; builds and workspace changes retain conversations until explicit deletion.
- A separate conversation index and its latest atomic backup protect the sidebar from settings resets; existing preferences migrate automatically without importing unrelated native/test sessions.
- Saved messages load before engine connection; native log lookup follows local calendar folders and locates retained UTC/other-day logs by validated session ID. A damaged index with no readable backup stops startup and preserves files.
- Per-chat drafts, image/annotation attachments, pending requests and active receipts use separate atomic files with latest backups; interrupted work stays paused, and admitted requests are never replayed automatically. Native logs remain authoritative for conversation context.
- Verify persistence/recovery/deletion tests and `scripts/history-smoke.js`: restart from another working folder, restore native messages, and keep the real profile untouched.

## Projects and general chats
- Sidebar groups conversations under collapsible project folders, with a + for a new chat in that project; Add/Open project chooses a local folder. New project creates a named folder and optionally a dependency-free Node web starter, refusing existing targets and linked parent paths. New conversation / Ctrl N starts a general chat for questions and images.
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
- Finished/interrupted/failed summaries report actual operation outcomes and changed-file counts; a reply or screenshot alone never establishes that tests passed. Stop cancels the active process tree and pauses pending work; completed file changes remain.
- Verify with `node scripts/activity-smoke.js` and the existing lifecycle tests.

## Branding
- Mora Desktop uses an original geometric M in the EXE/window icon, sidebar, welcome screen, and assistant avatars; the existing blue accent and layout are retained.
- Local SVG and multi-size ICO assets require no runtime image service or new app dependency.
- The original icon is MIT-licensed; `src/assets/README.md` records its source. Engine settings and README identify the app as an independent Muse Code interface without Meta endorsement.
- Keep the legacy profile folder, installer app ID, and internal test/IPC identifiers stable so branding changes do not reset existing chats or engine integration.
- Verify with the frontend/packaged UI smoke and inspect the rebuilt EXE icon.

## Windows Start and Search
- A current-user Setup shortcut registers the app as “Mora Desktop”, searchable by “Mora”.
- Targets `Mora Desktop.exe` in the chosen Setup folder (local development uses `dist`) and uses its embedded Mora icon; no extra runtime or administrator permission is required.
- Point existing manual development shortcuts at the renamed EXE. Verify the saved shortcut target/icon and confirm `Get-StartApps` lists Mora Desktop after Setup.
- Reopening the EXE reveals and focuses an existing hidden/minimized window; verify with `scripts/window-smoke.js` rather than treating a running process as proof of a visible app.

## Desktop installation and antivirus compatibility
- The installed app runs directly from its installation folder with the complete Electron package beside it; local development uses `dist/Mora Desktop.exe`. Startup does not extract another EXE into a random temporary folder.
- Deploy a verified staged `win-unpacked` folder with `scripts/install-desktop.ps1` after closing the app, from an external terminal; chat data and engine permissions remain. Update any old manual shortcut to `Mora Desktop.exe`.
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
- Reuses the existing icon and deletion path; deleting a chat also removes its separate draft/queue work files, without altering other conversations.
- Verification: `scripts/frontend-smoke.js` covers hover/focus, arm-then-delete clicks, and the `deleteChat` call; the existing deletion and lifecycle tests cover the main process.

## Building while Mora Desktop is open
- Build into a separate output folder (for example `artifacts/self-build`) while the installed app remains open.
- Wait for exit code 0 and verify the package before deploying its complete `win-unpacked` folder with the external installer; keep the portable artifact for optional distribution only.
- Closing Mora Desktop stops its engine process tree; use an external terminal/Codex for replacement after closing the old app.
- Keep the installed EXE path stable so the Windows Search shortcut continues working.

## File change review
- Full access requests update a Live file count and green/red line totals during edits; an open diff updates while preserving the selected file, scroll and keyboard focus.
- Live scans reuse unchanged file contents and diff results against the original baseline; ignore changes, unnamed events and watcher failures trigger full scans. The final full reconciliation also catches missed events and concurrent external edits.
- Uses installed Git for diff calculations, with the existing Codex Git runtime as a fallback; works in ordinary folders and respects Git ignore rules in repositories.
- Saves reviews per conversation until that chat is deleted; skips symlinks, generated folders outside Git, files over 2 MiB and snapshots over 32 MiB/5,000 files. Partial reviews are labelled; binary files have no line counts and long previews are truncated.
- Verify with the change/lifecycle tests, frontend smoke, and `scripts/changes-smoke.js` (real Muse edit and saved review); the panel is read-only, without accept/revert controls.

## Browser and design annotations
- A light Chromium panel opens HTTP/HTTPS pages and local development servers; Desktop fits a minimum 1280px CSS viewport and Mobile centers a 390px viewport. Expand fills the app window; Back to chat restores the split view. Cookies use the same persistent browser partition in both modes.
- Annotate selects an element or region; Add to chat creates a numbered screenshot card with source URL and an editable change note. Multiple cards use the existing image flow; removing a card removes its bounded HTML/URL/styles context. Expanded view returns to chat.
- Navigation, Escape, scrolling, resizing or device switching clears selection; capture rejects a changed page. Device changes wait until the page loads or recovers. App/page zoom use their own coordinates; file/image review temporarily hides the native browser view.
- Web pages run sandboxed without Node or the Muse bridge; native permissions, downloads and non-web schemes are denied. HTML omits scripts, event handlers and form values, with a 24,000-character cap; frames are selected as outer elements, without inspecting frame contents.
- Capture before / Compare after shows timestamped screenshots of the same page, device, viewport and scroll position; changed sources require a new baseline. This compares appearance without verifying functionality. Verify browser tests and `scripts/browser-smoke.js [EXE]`; Mobile previews responsive width without phone hardware emulation.

## Google Stitch MCP
- Engine settings connects/tests/disconnects Stitch's native MCP server; Muse discovers its design tools on the next request in Desktop and PowerShell, with ordinary annotations sent through the existing image/text flow.
- Requires a Stitch account API key, including dotted keys (Profile → Stitch settings → API key); Test checks a pasted key without saving, and Connect verifies tools/account access before saving. The key lives in the standard local Muse settings HTTP header, outside projects and chat/state/error output.
- Preserves other settings/servers, keeps a backup and writes atomically; supports the existing canonical or legacy MCP root and refuses ambiguous or malformed settings. No extra runtime dependency or permission change.
- Uses the fixed HTTPS Stitch endpoint, optional startup with a 15-second budget and 300 seconds per native tool call; generation/authentication/quota depend on the user's account. This supplies UI design tools, without adding a separate app-side generator.
- Verify `tests/stitch.test.js` and `scripts/stitch-smoke.js [EXE]` (isolated connection/error/disconnect UI and a real Muse fixture MCP call). Live Google generation still requires a valid account key; it is not verified by the fixture.

## Send queue
- Sending during a request queues text/images in order, with a maximum of ten pending messages.
- Pending requests persist separately per chat, including images; queued-to-active receipts preserve interrupted submissions without automatically replaying them.
- Stop cancels only the current request and pauses the rest; failure, restart and recovered work require explicit Resume. A fresh send leaves a recovered queue paused.
- Edit, remove, pause, resume or clear pending messages; save failures retain the unsent draft and report the error. Immediate steering awaits verified transport support.
- Draft text, images and annotation notes autosave and flush on close; loading another chat preserves draft ownership. Verify storage/lifecycle tests, frontend smoke and `scripts/work-smoke.js [EXE]`; real ordered replies use `scripts/ui-smoke.js [EXE] --send`.

## Formatted answers and streaming
- Headings, lists, tables, quotes, links and fenced code render as safe DOM nodes; raw HTML stays literal and only HTTP(S) links can open externally. Code Copy and supported Stitch image previews remain available.
- Streaming retains unchanged chat rows, image nodes, sidebar entries and tool expansion state; closed tool output renders only when opened.
- Quick, Balanced and Thorough select supported efforts on the current model; explicit model/effort controls remain available, and the chosen preset persists without changing providers.
- Verify Markdown/speed tests, frontend smoke and `scripts/performance-smoke.js` (optional baseline renderer file; fixture results only). The optional pinned `scripts/sdk-probe.js` checks the SDK handshake in isolation; migration still requires live-event, cancellation, durable-resume and approval checks.

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
- `THIRD_PARTY_NOTICES.md` preserves Meta/OpenAI brand ownership and separate service/dependency rights, identifies the original MIT-licensed Mora artwork, and does not claim endorsement or trademark permission. Setup includes project license and notices alongside vendor licenses.
- README includes three native desktop screenshots: workspace, browser annotation and engine settings, captured with an isolated profile and local demo; no personal chats or API keys are included.
- Verify public source membership/privacy, README's relative links and packaged notices; original third-party license files remain intact.


## Muse account and first use
- Account discovery distinguishes signed-in, key-based, sign-in-required, missing-engine and unknown states without storing native credentials or account details. Existing engine login remains authoritative.
- Sign in opens the installed engine device-code flow at a validated HTTPS Meta link, displays its temporary code and supports cancellation, expiry and denial; attempts expire after five minutes and clear the code on completion.
- Uses installed Muse 1.4.1 experimental account methods; older or unavailable methods show terminal sign-in guidance. Onboarding stays visible when action is needed, and unauthenticated sending preserves the draft.
- Project creation validates the parent/name and never replaces an existing folder. The optional starter has dev/check/build/test scripts and needs Node.js on PATH; opening existing projects remains available.
- Verify account/project tests, rendered first-run fixtures and native journey. Existing sign-in plus native issuance/cancellation have live proof; a fresh person's browser approval requires that person to complete Meta login.

## Checkpoints and restore
- Full access Muse requests and Run/Test commands save bounded project source checkpoints in the local app profile; failed or incomplete snapshots block mutation. Manual save/list/delete uses Checkpoints.
- Includes dirty and visible untracked source; excludes generated/secret files even if tracked, rejects links, and limits files to 2 MiB, snapshots to 32 MiB/5,000 files and stored checkpoints to 256 MiB per project. Checkpoints are not a backup of databases, dependencies or secrets.
- Automatic Muse/Test snapshots seal post-work hashes; restore previews select only those changed paths and flag later edits. Manual/Run snapshots require file selection. Stale previews refuse writes; newer edits need explicit acknowledgement.
- Restore requires idle agent and stopped project commands, saves a recovery checkpoint, changes selected files only and leaves Git history intact. A partial filesystem failure preserves recovery and reports it; deleting a chat does not delete project checkpoints.
- Verify checkpoint/lifecycle tests and native journey for dirty originals, additions/deletions, exclusions, link/bounds protection, later edits, stale previews, partial failures and restart persistence.

## Run my app
- Runs the configured dev/start/serve script in the selected Node project, waits for a reported localhost URL to respond, then opens the native preview. Stop/Restart manages its owned process tree only.
- Requires Node.js and the package manager declared in package.json (npm by default) on PATH; dependencies must already be installed. Missing scripts/runtime/dependencies report a next action rather than installing automatically.
- Records occupied Windows TCP ports before launch, refuses previewing an existing owner and never kills another app to free a port; startup is bounded to 30 seconds and retained output to 24,000 characters.
- Running apps may stay open while Muse edits the same project. Stop Run before switching projects or restoring; closing Mora stops owned project processes. Servers that print no local URL need a supported script.
- Verify real Windows starter, occupied-port/exit/deadline/output/cleanup tests and packaged native journey including browser interaction and restart.

## Test my app and Fix failures
- Runs configured typecheck (or check), build and test scripts sequentially; each result includes real exit/output with a two-minute deadline and CI mode. Stop tests cancels owned work; absent scripts are not configured, never passed.
- Saves a checkpoint around checks and prevents agent/project switching during the command. Run may remain active for page-load checking.
- Page load checks the running local app and reported console errors. Interaction coverage remains explicitly not checked by Mora; configured project tests determine their own coverage. A green script result does not establish every app behavior.
- Fix failures requires Full access, failed checks and an idle engine; sends one bounded repair request, then rechecks once on successful completion. Follow-ups remain paused and failed repairs never loop automatically.
- Verify real check/build/test results, failure/deadline/cancel/missing-script/page-load fixtures, one-repair orchestration and native journey.

## AI Tester reports (experimental)
- AI Tester and `/tester report` use native Spark with isolated skills/reminders disabled and no native tools; Mora executes generic actions in a dedicated visible browser, restricted to the running localhost origin. Account reuse is temporary; normal cleanup removes its credential copy without changing global settings.
- Durable cases, action intents, actual assertions and screenshots distinguish passed checks, suspected/confirmed failures, blocked work and untested coverage. A finding requires replay of the same failed assertion against unchanged source; incorrect expectations still require human review.
- Reports survive restart through atomic primary/backup saves. Stop cancels native/browser work; Resume is explicit, rechecks source/address and restarts unfinished cases. Runs are bounded to 100 additional browser actions, 150 decisions and 15 minutes plus the pending 90-second decision deadline.
- Browser sessions clear cookies/storage between cases, leaving server data intact. External resources/popups/downloads and non-HTML document navigation are blocked; canvas/drag-and-drop are unsupported. Use test data. Reports are local but provider requests include requirements, observations and selected images.
- Verify report/native/controller regressions, real browser input at three sizes, rendered report/history/evidence/keyboard flows and independent native benchmarks. AI discovery is experimental, not exhaustive coverage or release approval.

## AI Tester repair
- `/tester solver` and issue selection require Full access, one to five confirmed current-report findings, unchanged project source and a running app. Every selected finding is reproduced before any edit; no reproduced issue means no repair request.
- Save a source checkpoint, make one bounded native repair, restart at the same address, then replay original assertions, up to three previously passing cases and configured checks. Neither missing checks nor altered tests/requirements/configuration/dependencies can produce a verified repair.
- Retain per-issue reproduction/verification evidence and checkpoint ID. Stop preserves source changes and recovery; unresolved, blocked, stopped and unverified outcomes remain explicit. App data reset is separate from source restore.
- Existing Checkpoints handles selective source recovery with conflict checks. Regular chat, project operations and queue resume remain locked while testing or repair owns the project.
- Verify selected/stale/unreproduced findings, unchanged assertions, test-protection failures, checkpoint recovery and live native repair. Findings depend on the stated requirements; review before selecting a repair.
