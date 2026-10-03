# Features

## Chat and project operations
- Chat, image attachments, saved native Muse conversations, and project selection. Timeline styling uses right-aligned midnight-navy user bubbles with a subtle blue border and a cyan rail for replies, expandable operations and compact change cards. Status comes from engine messages; live elapsed time stays available while working. Running-project outcomes offer an Open preview card; file review and checkpoint Undo retain their existing guards.
- Requires the installed and signed-in Muse engine; reconnects share one discovery attempt, reject malformed catalogs and reconcile the selected effort after model fallback.
- Read only inspects; Full access permits project edits and commands under the user's Windows permissions.
- Uses Muse 1.4.1's working `exec --json` interface and excludes foreign personal rules/skills on every turn; native workspace instructions and engine settings still apply. Interactive per-command approvals remain available in the native terminal.
- Verify with the existing frontend and real-engine smoke scripts; these operate on temporary projects where they write files.

## Conversation retention
- All normal launches, including Windows Search, use `%APPDATA%\Muse Desktop`; builds and workspace changes retain conversations until explicit deletion.
- A separate conversation index and its latest atomic backup protect the sidebar from settings resets; existing preferences migrate automatically without importing unrelated native/test sessions.
- Saved chat ownership loads before the renderer; engine initialization overlaps renderer loading. Metadata-only discovery uses a memory-only Muse host and publishes verified readiness before cleanup; ordinary chat requests keep native journals. Explicit chat/project deletion removes native logs and display recovery journals. A damaged index preserves files and stops startup.
- Per-chat drafts, image/annotation attachments, pending requests and active receipts use separate atomic files with latest backups; interrupted work stays paused, and admitted requests are never replayed automatically. Native logs remain authoritative for conversation context.
- Verify persistence/recovery/deletion tests and `scripts/history-smoke.js`: restart from another working folder, restore native messages, and keep the real profile untouched.

## Projects and general chats
- Sidebar groups conversations under collapsible project folders, with a + for a new chat in that project; Add/Open project chooses a local folder. New project offers Node, plain HTML/CSS/JS or empty starters, refusing existing targets and linked parent paths. New conversation / Ctrl N starts a general chat for questions and images.
- Existing chats keep their IDs, messages, and saved workspace; absent project identity uses the legacy workspace. Full Windows paths distinguish folders, including projects with the same name.
- Explicit null project identity keeps general chats separate on reopen; the engine uses a private profile folder and Read only, without inheriting the previously selected project or its Full access setting. This is not a filesystem sandbox.
- Project paths and chat identity use the backed-up index; entries remain after the last chat is deleted. Remove project confirms deletion of all active/archived chats, drafts and engine history while keeping source files. Running work must stop and saved queues/interrupted requests must be resolved first. Failed saves preserve the project; incomplete cleanup is reported.
- Verify grouping/lifecycle/persistence/date-boundary tests, `scripts/frontend-smoke.js`, and `scripts/projects-smoke.js [EXE] --send` for two real general replies with context and enabled sending after restart; tests use temporary profiles.

## Shared project brief
- Project brief edits `.mora/project-brief.md`, shared by project chats and read before every project request. General chats never inherit it; native project instructions remain applicable.
- Keep the goal, decisions, commands and constraints within 24,000 characters. Reading needs a project; saving requires Full access and idle work. Paths reject links and traversal.
- Atomic, serialized saves compare the editor's revision and refuse newer external edits. Unsaved text stays in the dialog on failure; reload/close requires explicit discard when dirty.
- The file is ordinary project source, included in eligible checkpoints; it does not share other chats' messages or native context.
- Verify brief/lifecycle tests, frontend editing/discard checks and `scripts/product-loop-smoke.js [EXE] --send` with an isolated profile.

## Chat organization and conversation find
- Search filters chat titles and project names/paths in Active or Archived views; it does not search message history. Pins sort first within their project while preserving the remaining order.
- Each chat has keyboard-accessible Options for rename, pin, archive and restore, plus a pencil for inline rename (Enter saves, Escape cancels). Both rename paths use the same metadata validation and preserve chosen titles. Archiving keeps its session, native history, draft, queue and project; current work must stop before its chat can be archived. Deletion remains separate.
- Metadata uses the existing backed-up index, accepts older records and ignores malformed organization flags. Restore never creates a new native session; renamed titles stay chosen by the user.
- Ctrl+F searches visible text in the current conversation, including formatted text and expanded operations; counts, Enter/Shift+Enter, arrows and Escape support navigation. Stream updates refresh safe native highlights; switching chats clears the query. Native page focus keeps its own shortcuts.
- Verify grouping/persistence tests, frontend smoke and project restart smoke with an isolated profile, including primary-index corruption and draft retention.

## Workspace actions and continuity
- Actions / Ctrl+K lists existing workspace commands and shortcuts. Search/Enter/Tab/arrows/Escape work from the keyboard; unavailable commands remain disabled. Ctrl+Shift+F opens library search; Ctrl+F, Ctrl+B and Ctrl+N retain their existing purposes while Mora has focus.
- Window size, position and maximize state persist with normal restore bounds; startup clamps the window to connected display work areas and recovers disconnected or malformed positions.
- Finished chat work, tester runs and verified repairs play one short, one-second local sound, once per completion, in foreground or background. Failed, paused, cancelled and permission outcomes stay quiet. Background work retains unread markers until viewed; settings can mute the sound, and an earlier disabled-notices preference stays muted.
- Uses the existing actions and profile/index backups, with no additional service or history import. Closing saves geometry and drafts; changing sound preferences does not interrupt work. Completion sounds replace Windows notifications.
- Verify desktop-workspace tests, frontend keyboard/disabled-action checks, isolated project restart and real native completion/audio playback. System volume or muted output controls audibility.

## Browser tabs and history
- Browser keeps up to eight tabs per chat, with accessible select/close/new controls and a visited-page selector; native Back/Forward retain their meaning. Opening Browser reopens that chat's selected page after restart; startup leaves saved sites unopened.
- Tab locations, titles and up to fifty history entries persist in the conversation index/backup. Saved history excludes serialized page/form state; URLs must be HTTP(S) without embedded credentials. Browser history is local profile data and stays out of distribution archives.
- Chats use separate native browser storage partitions; tabs within a chat share its login/storage. Switching chats closes their native views and clears selections while retaining tab metadata. Existing browser profile data is retained; Website Tester remains separate.
- Existing navigation/permission/download restrictions, responsive viewport/zoom, native occlusion during resizing/dialogs, annotation evidence and renderer crash recovery remain in force. Remembered-page network failures leave the address controls available for recovery.
- Verify browser-tabs tests, original browser smoke and `scripts/workspace-smoke.js [EXE]` for native tab/history/restart, no startup navigation, storage separation, focus/shortcut scope and tab limits using temporary profiles and loopback pages.

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
- Mora Desktop uses the original white geometric M on a rounded blue tile in the sidebar, welcome screen, assistant avatars and favicon; matching Windows ICO frames supply the window and future packaged application icon.
- Local SVG artwork and a multi-size ICO require no runtime image service or new app dependency; update both assets together.
- The icon is MIT-licensed; `src/assets/README.md` records its source. Engine settings and README identify the app as an independent Muse Code interface without Meta endorsement.
- Keep the legacy profile folder, installer app ID, and internal test/IPC identifiers stable so branding changes do not reset existing chats or engine integration.
- Verify rendered images in the local preview; inspect the embedded EXE icon after an explicitly requested build.

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
- Full access requests keep a Live file count and green/red line totals above the composer during edits, returning the completed review inline afterward. An open diff updates while preserving the selected file, scroll and keyboard focus.
- Live scans reuse unchanged file contents and diff results against the original baseline; ignore changes, unnamed events and watcher failures trigger full scans. The final full reconciliation also catches missed events and concurrent external edits.
- Uses installed Git for diff calculations, with the existing Codex Git runtime as a fallback; works in ordinary folders and respects Git ignore rules in repositories.
- Saves reviews per conversation until that chat is deleted; skips symlinks, generated folders outside Git, files over 2 MiB and snapshots over 32 MiB/5,000 files. Partial reviews are labelled; binary files have no line counts and long previews are truncated.
- Verify with the change/lifecycle tests, frontend smoke, and `scripts/changes-smoke.js` (real Muse edit and saved review); the panel is read-only, without accept/revert controls.

## Browser and design annotations
- A Chromium panel opens HTTP/HTTPS pages and local servers; Desktop fits a minimum 1280px CSS viewport and Mobile centers a 390px viewport. Drag its left divider or use arrow keys to resize; double-click resets and Escape cancels dragging. Width is remembered and bounded to keep chat usable. Expand fills the window; Back to chat restores the split; tabs in the same chat share persistent cookies.
- Selecting an element/region opens a trusted note popup. A fixed footer keeps capture bounds stable; selection waits for current preview bounds and installed page controls. Save (Ctrl+Enter) queues the capture without sending and leaves a numbered marker; click the marker or compact chat note to edit/delete. Escape cancels. Send notes submits the current notes with the existing composer/images flow; failed sends and failed disk saves preserve notes for retry.
- Navigation, Escape, scrolling, resizing or device switching clears selection; capture rejects a changed page. Device changes wait until the page loads or recovers. App/page zoom use their own coordinates; file/image review temporarily hides the native browser view.
- Web pages run sandboxed without Node or the Muse bridge; note text never enters the website DOM. Native permissions, downloads and non-web schemes are denied. HTML omits scripts, event handlers and form values, with a 24,000-character cap; frames are selected as outer elements. Saved notes use current-chat draft backups and remain editable after restart without loading the saved site. Markers bind to the original DOM node/current document, not replacement nodes; region markers hide after viewport changes. Captures remain frozen evidence.
- Capture before / Compare after shows timestamped screenshots of the same page, device, viewport and scroll position; changed sources require a new baseline. This compares appearance without verifying functionality. Verify browser/draft tests, `scripts/browser-smoke.js [EXE]` for low-level capture and `scripts/annotation-smoke.js [EXE]` for the popup/markers, save retry, restart, cancellation and send races. Mobile previews responsive width without phone hardware emulation.

## Local UI preview
- `node scripts/ui-preview.js` serves the actual renderer at `http://127.0.0.1:4173` with sample data identified in the sidebar and a small counter iframe. Annotate Mora's UI using Codex's browser, then send the feedback to the coding chat.
- Uses an in-memory sample bridge, without Muse, real chats/project files, process execution, native browser APIs or source editing. Sample controls do not call a model; Run/Test and unsupported actions explain their desktop requirement.
- Binds only to loopback; static reads stay within source/assets, reject traversal and symlink escapes, and reject HTTP writes. Allows injected annotation styles in this preview only; scripts and the packaged desktop retain their strict policy. No additional dependency, installation or user-wide setting is needed.
- Verify the preview server test and `scripts/ui-preview-smoke.js` for the renderer, sidebar sample label, effort selection, sample chat, unavailable engine actions, injected shadow-root popup styling/note save and browser errors. The popup regression models annotation injection; check Codex's button manually. This proof does not establish a full browser edition.

## Workspace layout
- Projects, conversation and preview share a calm three-column workspace. Run/Test/Preview stay in the header; the workspace menu retains restart/stop, results, checkpoints, brief, export and testers. Ctrl+K remains available.
- New chat and the selected conversation share a charcoal fill and subtle slate border. Settings and Ctrl+K → Engine settings open the same scrollable floating dialog without moving its sidebar anchor; Escape, outside click and the close button dismiss it and return focus. Existing controls and unsaved fields are preserved. The arrow beside the Mora logo hides the sidebar; the navigation button beside the project selector reopens or toggles it; Ctrl+B works while the Mora interface has focus. The choice persists locally, and hiding a focused sidebar returns focus to the toggle.
- The composer keeps its CSS minimum height for short messages and grows for longer text; shortcut hints beneath it are omitted, while paste and Enter/Shift+Enter behavior remain available. It shows model, its supported native reasoning levels and access directly. Model, reasoning, access, browser-history and project-starter selectors share a dark popover with selected checkmarks, supported options and keyboard navigation. Clicking an open selector’s trigger closes it. Composer menus open upward; other menus fit above or below their trigger. Access descriptions and full model IDs remain visible; existing values, busy guards, Escape and outside dismissal stay in effect. Native model IDs and saved effort choices remain unchanged; friendly labels and model-ID tooltips improve readability.
- Preview navigation, address, device icons, Point to edit, expand and menu share one compact row; icon buttons retain accessible labels and tooltips. Preview history, new tabs, region selection and captures live in its menu; multiple tabs remain visible. History options stay within that menu: Escape returns focus to the visible trigger; closing the menu or Preview closes its popovers. Add to chat appears for a selection; the bottom action strip is hidden until a selection or saved notes needs its controls. Menus/dialogs and resizing share native-preview occlusion and preserve keyboard focus.
- Verify frontend, `scripts/layout-smoke.js`, `scripts/layout-native-smoke.js [EXE]` and browser smoke for menus, five renderer sizes down to 860px, the native preview's 1080px minimum, trusted pointer input, captures, expansion and resize cancellation. Desktop preview retains its existing scaled viewport; sample pages can appear smaller than the surrounding interface.

## Trello board connection
- Settings accepts a Trello API key, token and board link/ID. Test checks account, board and list access without saving new credentials; Connect verifies and saves them in Mora's local profile. Test with empty fields uses the saved connection.
- This is read-only board verification, not card editing or an AI tool integration. Requests use only the fixed HTTPS Trello API origin, reject redirects, time out after 30 seconds and redact credentials from returned status/errors.
- Credentials are stored locally in primary/backup JSON files; use your own key/token and keep the profile private. Password fields clear after Connect or Disconnect. Disconnect clears damaged settings and interrupted credential temp files, reporting failed deletion honestly.
- Verify Trello unit tests and `scripts/features-native-smoke.js` for real IPC, profile saves and corrupt recovery with a mocked provider. Actual account/board access remains unverified without user-supplied credentials.

## Native editing menu
- Right-click editable fields for Cut/Copy/Paste/Select all, spelling suggestions and Add to dictionary; selected read-only text offers Copy. Uses Electron's native menu and spellchecker, with no extra dependency.
- Suggestions depend on the installed spellchecker; credential fields disable spelling. Verify context-menu unit tests and native source-mode smoke for actual menu registration and editing roles.

## Google Stitch MCP
- Engine settings connects/tests/disconnects Stitch's native MCP server; Muse discovers its design tools on the next request in Desktop and PowerShell, with ordinary annotations sent through the existing image/text flow.
- Requires a Stitch account API key, including dotted keys (Profile → Stitch settings → API key); Test checks a pasted key without saving, and Connect verifies tools/account access before saving. The key lives in the standard local Muse settings HTTP header, outside projects and chat/state/error output.
- Preserves other settings/servers, keeps a backup and writes atomically; supports the existing canonical or legacy MCP root and refuses ambiguous or malformed settings. No extra runtime dependency or permission change.
- Uses the fixed HTTPS Stitch endpoint, optional startup with a 15-second budget and 300 seconds per native tool call; generation/authentication/quota depend on the user's account. This supplies UI design tools, without adding a separate app-side generator.
- Verify `tests/stitch.test.js` and `scripts/stitch-smoke.js [EXE]` for isolated connection/error/disconnect UI with a local fixture. Add `--send` explicitly for a real Muse fixture MCP call using the provider account. Live Google generation still requires a valid account key; it is not verified by the fixture.

## Send queue
- Sending during a request queues text/images in order, with a maximum of ten pending messages.
- Pending requests persist separately per chat, including images; queued-to-active receipts preserve interrupted submissions without automatically replaying them.
- Stop cancels only the current request and pauses the rest; failure, restart and recovered work require explicit Resume. A fresh send leaves a recovered queue paused.
- Edit, remove, pause, resume or clear pending messages; save failures retain the unsent draft and report the error. Immediate steering awaits verified transport support.
- Draft text, images and annotation notes autosave and flush on close; loading another chat preserves draft ownership. Verify storage/lifecycle tests, frontend smoke and `scripts/work-smoke.js [EXE]`; real ordered replies use `scripts/ui-smoke.js [EXE] --send`.

## Formatted answers and streaming
- Headings, lists, tables, quotes, links and fenced code render as safe DOM nodes; raw HTML stays literal and only HTTP(S) links can open externally. Code Copy and supported Stitch image previews remain available.
- Streaming retains unchanged chat rows, image nodes, sidebar entries and tool expansion state; closed tool output and completion-operation lists render only when opened. Native state updates send 200 recent history items initially; Load older adds 200 while preserving reading position and full saved history. Live reviews and complete completion summaries stay available outside the window. Find searches rendered text.
- The reasoning selector uses the selected model's supported levels directly. Saved efforts survive restart; unsupported or unset efforts use a supported native default or the first supported level. Old work-preset metadata is ignored; models without choices show disabled Not available and omit the effort argument.
- Verify Markdown/lifecycle tests, frontend/layout/native smoke and `scripts/performance-smoke.js` (optional baseline renderer file; fixture results only). The optional pinned `scripts/sdk-probe.js` checks the SDK handshake in isolation; migration still requires live-event, cancellation, durable-resume and approval checks.

## Long-chat model context
- Uses the installed engine's supported per-run context controls: soft compaction at 75%, hard compaction at 90%, and at most 64 KiB of each tool output fed back to the model. Model, reasoning effort, native compaction strategy and retained session identity stay chosen by the existing controls.
- Reads `exec --help` during connection, with bounded output/time; missing flags or failed discovery retain native defaults. Requires both threshold flags before changing either. No user-wide settings or provider-specific cache overrides.
- Compaction summarizes model-visible history and can lose detail; displayed/native history stays preserved. Project brief and targeted source rereads retain durable context. Provider load, model choices and generated output still affect response latency.
- Uses native controls instead of a separate summarizing model or copying entire transcripts into prompts. See [Muse context controls](https://dev.meta.ai/docs/muse-code/interactive) and [latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization).
- Verify history-window/context-policy/runtime tests and `scripts/long-chat-native-smoke.js` for bounded IPC, older history, find, stale owners, draft retention and installed flags. Fixture checks do not measure real provider latency or compaction-summary fidelity.

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
- `scripts/clean-local-builds.ps1` removes obsolete builds while retaining the installed app, releases, dependencies and chat/profile backups; `-WhatIf` previews targets. Verify archive membership, Node tests, relocated builds and installer smoke; native login remains account-specific.

## Public documentation and licensing
- README covers features, per-chat context, setup, technology stack, workflows, privacy, limitations and contribution steps; source code uses the repository's MIT license.
- `THIRD_PARTY_NOTICES.md` preserves Meta/OpenAI brand ownership and separate service/dependency rights, identifies the original MIT-licensed Mora artwork, and does not claim endorsement or trademark permission. Setup includes project license and notices alongside vendor licenses.
- README includes three native desktop screenshots: workspace, browser annotation and engine settings, captured with an isolated profile and local demo; no personal chats or API keys are included.
- Verify public source membership/privacy, README's relative links and packaged notices; original third-party license files remain intact.


## Muse account and first use
- Account discovery distinguishes signed-in, key-based, sign-in-required, missing-engine and unknown states without storing native credentials or account details. Existing engine login remains authoritative.
- Sign in opens the installed engine device-code flow at a validated HTTPS Meta link, displays its temporary code and supports cancellation, expiry and denial; attempts expire after five minutes and clear the code on completion.
- Uses installed Muse 1.4.1 experimental account methods; older or unavailable methods show terminal sign-in guidance. Onboarding stays visible when action is needed, and unauthenticated sending preserves the draft.
- Check setup in Welcome or engine settings probes installed Muse, account status, Node/Git versions, the selected package manager and configured commands. Plain websites report Mora's bundled runtime instead of requiring Node or a package manager. Checks install nothing and preserve credentials/settings.
- Project creation validates names and never replaces folders; the Node starter needs no packages. Verify account/project/setup tests, first-run fixtures and native product loop. Native issuance/cancellation have live proof; browser approval stays with the user.

## Checkpoints and restore
- Full access Muse requests and Run/Test commands save bounded project source checkpoints in the local app profile; failed or incomplete snapshots block mutation. Manual save/list/delete uses Checkpoints.
- Includes dirty and visible untracked source; excludes generated/secret files and compiled binaries (including loose EXE/DLL files) even if tracked, rejects links, and limits files to 2 MiB, snapshots to 32 MiB/5,000 files and stored checkpoints to 256 MiB per project. Older checkpoints can still restore source while leaving compiled output alone. Checkpoints are not a backup of databases, dependencies or secrets.
- Automatic Muse/Test snapshots seal post-work hashes; restore previews select only those changed paths and flag later edits. Manual/Run snapshots require file selection. Stale previews refuse writes; newer edits need explicit acknowledgement.
- Undo this request beside the latest completed/interrupted editable request opens its sealed checkpoint review, stopping the owned preview first. Restore requires idle work, saves recovery, changes selected files only and leaves Git history intact. Partial failure preserves recovery; chat deletion retains checkpoints.
- Verify checkpoint/lifecycle tests and native journey for dirty originals, additions/deletions, exclusions, link/bounds protection, later edits, stale previews, partial failures and restart persistence.

## Run my app
- Runs the configured dev/start/serve script or a plain website with index.html and no package.json, waits for a localhost URL to respond, then opens the native preview. Concurrent openings of the same page share its pending load. Open preview reopens it; finished requests offer Run / open preview. Stop/Restart manages owned processes only.
- Node projects require Node.js and their declared package manager (npm by default) on PATH, with dependencies already installed. Plain HTML/CSS/JS uses Mora's bundled runtime on a loopback-only random port; file serving rejects links, traversal, common secrets and hidden paths. Other project runtimes remain unsupported.
- Records occupied Windows TCP ports before launch, refuses previewing an existing owner and never kills another app to free a port; startup is bounded to 30 seconds and retained output to 24,000 characters.
- Running apps may stay open while Muse edits the same project. Stop Run before switching projects or restoring; closing Mora stops owned project processes. Servers that print no local URL need a supported script.
- Verify real Windows starter, occupied-port/exit/deadline/output/cleanup tests and packaged native journey including browser interaction and restart.

## Recovery actions
- Error messages offer relevant Reconnect, Sign in, Check setup, Show results or Start a new chat actions. Results belong to the selected project; missing native history retains the protected original chat.
- Failed/interrupted requests offer Continue in chat, focusing the composer while preserving its draft and attachments. Recovery never sends or retries a request automatically.
- Actions wait for current work; account and setup checks preserve the existing login/settings. Source Undo remains a separate, reviewed checkpoint action.
- Verify frontend recovery, busy guards, selected-project results and retained drafts; lifecycle tests retain interrupted requests and native history protection.

## Project source export
- Export project saves a ZIP of eligible project source plus run instructions, returning its SHA-256 checksum with Copy and Show in folder actions. It uses the Windows save dialog and does not upload anything.
- Reuses source snapshot exclusions for dependencies, generated output and common secrets, additionally omitting local chat/tool data, runtime databases and archives. Filename rules cannot identify every inline credential; review code before sharing.
- Requires idle project work; refuses linked or incomplete captures and limits source to 5,000 files, 2 MiB per file and 32 MiB total. ZIP creation uses bundled Windows libraries; the destination changes only after successful creation.
- Instructions distinguish bundled plain-website preview from Node/package-manager setup and configured test assertions. Unsupported runtimes are not made runnable by export.
- Verify actual ZIP bytes/membership/checksum, refusal preserving existing destinations, save-dialog ownership/cancellation and `scripts/project-portability-smoke.js [EXE]` for native export/reopen preview.

## Test my app and Fix failures
- Runs typecheck (or check), build, test and optional test:flows (or test:e2e) scripts sequentially with real exit/output, a two-minute deadline and CI mode. Stop cancels owned work; absent checks never pass.
- Saves a checkpoint around checks and prevents agent/project switching during the command. Run may remain active for page-load checking.
- Page loading and essential-flow script outcomes are separate; only configured assertions have coverage. Add essential tests prepares an editable chat request without sending it. Results record time/revision and become historical after source changes; opening results rechecks the revision.
- Fix failures requires Full access, failed checks and an idle engine; sends one bounded repair request, then rechecks once on successful completion. Follow-ups remain paused and failed repairs never loop automatically.
- Verify real scripts, three repeatable healthy/faulty unit pairs, failure/deadline/cancel/stale/configuration checks, repair orchestration and native healthy/faulty browser flow. AI exploration remains experimental and incomplete.

## Website tester (experimental)
- Website tester and `/tester [URL] [objective]` use the installed Muse account and a dedicated packaged Playwright browser without source or repair tools. Workflow/page/site modes save bounded states, controls, observed relationships and explicit coverage gaps.
- Grounded cases prioritize normal flows, new-page planning and newly revealed controls/ready cases before leaving their state. Bounded discovery retains queued checks; invalid plans get one correction with a 30-second cap. Starting checks must match before execution/replay; older cases retain whole-state matching. Reproduction requires fresh approval. Demonstrate up to eight actions with an expected outcome; Finish flushes pending input from the current document. Navigation during Finish remains unverified; demonstrations grant no permission.
- Separate navigation/resource origins and path scopes constrain traversal. Sign in manually; encrypted login storage is per site/account. Provider text filters common secrets, local screenshots mask inputs, and report backups preserve evidence and uncertain interruptions. Use test accounts: arbitrary personal content may remain.
- Persistent Setup/Overview/Tests/Findings/Explore/Evidence/Teach/Reports navigation separates setup from results. Budgets, inline errors, exact approvals and run controls remain accessible; case/feature/history filters, expected/actual details and evidence links support investigation. Keyboard focus survives report updates and compact windows reflow. Counts distinguish discovered controls, checked cases and remaining gaps.
- Planning timeouts leave new plans untested; validated cases can still receive independent failure reviews and replay within the original budget. A review timeout stops further AI calls and leaves failures unconfirmed. Discovery prioritizes unvisited navigation; budget cleanup/uncertainty stays explicit. Native repeatability remains experimental; other roles need logins, unsupported interactions remain gaps and resets cannot undo live data.

## Project tester reports (experimental)
- Project tester and `/project-tester report` use native Spark with isolated skills/reminders disabled and no native tools; Mora executes generic actions in a dedicated visible browser, restricted to the running localhost origin. Account reuse is temporary; normal cleanup removes its credential copy without changing global settings.
- Durable cases, action intents, actual assertions and screenshots distinguish passed checks, suspected/confirmed failures, blocked work and untested coverage. A finding requires replay of the same failed assertion against unchanged source plus a separate native expectation review with retained rationale; unsupported expectations stay ineligible for repair. Human review remains necessary.
- Reports survive restart through atomic primary/backup saves. Stop cancels native/browser work; Resume rechecks source/address, restarts unfinished cases and continues interrupted reproduction from original evidence. Reopened results with mismatched source are historical/stale. Runs allow 100 additional browser actions, 150 planning/action decisions and 15 minutes plus a pending 90-second decision; each reproduced failure adds one bounded expectation-review decision.
- Browser sessions clear cookies/storage between cases, leaving server data intact. External resources/popups/downloads and non-HTML document navigation are blocked; canvas/drag-and-drop are unsupported. Use test data. Reports are local but provider requests include requirements, observations and selected images.
- Verify report/native/controller regressions, real browser input including select/ARIA controls at three sizes, rendered report/history/evidence/keyboard flows and independent native benchmarks. AI discovery is experimental, not exhaustive coverage or release approval.

## AI Tester repair
- `/project-tester solver` and issue selection require Full access, one to five confirmed current-report findings, unchanged project source and a running app. Every selected finding is reproduced before any edit; no reproduced issue means no repair request.
- Save a source checkpoint, make one bounded native repair in a fresh session with its journal in isolated temporary storage, restart at the same address, then replay original assertions, up to three previously passing cases and configured checks. Missing checks or altered recognized tests/requirements/configuration/dependencies prevent verification; common test directories/snapshots and configured check entry files are protected before and after checks. Unconventional indirect check inputs need manual review.
- Retain per-issue reproduction/verification evidence and checkpoint ID. Stop preserves source changes and recovery; unresolved, blocked, stopped and unverified outcomes remain explicit. App data reset is separate from source restore.
- Existing Checkpoints handles selective source recovery with conflict checks. Regular chat, project operations and queue resume remain locked while testing or repair owns the project.
- Verify selected/stale/unreproduced findings, unchanged assertions, test-protection failures, checkpoint recovery and live native repair. Findings depend on the stated requirements; review before selecting a repair.
