# Muse Desktop

**A Windows desktop workspace for the Muse coding engine.**

Chat in Arabic or English, work with local projects, inspect live file changes, and
send selected browser designs to Muse with a cropped screenshot and HTML context.

[Screenshots](#screenshots) · [Features](#features) · [Installation](#installation) · [Technology stack](#technology-stack) ·
[Build from source](#build-from-source) · [Privacy](#privacy-and-local-data) ·
[License & attribution](#license-and-attribution)

Muse Desktop is an independent community project with a Codex-inspired workflow.
It uses your separately installed Muse engine and that engine's existing login.

## Screenshots

Captured from Muse Desktop using an isolated profile and a local demo page.
No personal chats, API keys, or private project data are shown.

### Desktop workspace

![Muse Desktop welcome screen and chat workspace](docs/screenshots/desktop-overview.png)

### Browser annotations

Select a page element, preview its cropped screenshot, and attach its HTML context to the main chat.
The example below uses the Mobile preview.

![Browser annotation with a selected demo card and screenshot attached to chat](docs/screenshots/browser-annotation.png)

### Engine settings

Choose your Muse executable, reconnect the engine, and configure your own Google Stitch MCP connection.

![Engine settings and Google Stitch MCP controls with an empty API key field](docs/screenshots/engine-settings.png)

## Features

| Feature | What it does |
| --- | --- |
| Arabic & English chat | Mixed-language messages, automatic text direction, multiline input and code blocks. |
| Image attachments | Pick or paste PNG, JPEG and WebP images into the main chat. |
| Projects & general chat | Group conversations under local project folders, or ask general questions without attaching a project. |
| Persistent conversations | Restore chats across restarts and upgrades; remove a conversation explicitly from the sidebar. |
| Live activity | Show current work, public progress messages, actual commands, tool arguments, output and exit codes supplied by Muse. |
| Live file reviews | Update a changed-file badge and added/removed line counts during edits; open a colored diff preview. |
| Request queue | Draft and send follow-ups while Muse works; queued messages run in order. |
| Execution controls | Read only for inspection, Full access for project operations, and Stop for the active request. |
| Integrated browser | Browse websites and local development servers in a Chromium panel with Desktop/Mobile previews and an expanded view. |
| Design annotations | Select an element or region and attach only its visible screenshot area, along with selected HTML, URL and styles. |
| Google Stitch MCP | Connect, test and disconnect your own Stitch account; use design tools through Muse's native MCP integration. |
| Image previews | Display supported Stitch image links in chat, enlarge them, or copy the original link. |
| Windows integration | Per-user Setup, Start/Search shortcut, single-instance activation and minutes/seconds activity timing. |

The concise agent-facing feature reference is [docs/features.md](docs/features.md).

### Conversation context

Each conversation keeps its own Muse session and context. Conversations inside a
project can read the same project files, but do not automatically read each other's
messages. Record shared decisions in project documentation when another chat needs
to continue the work. General chats run in a private workspace with Read only mode.

### Live work and completion

Tool cards report the engine's actual activity. The file badge updates while files
change, and saved reviews remain attached to their conversation. Reviews show what
changed; they do not provide accept/revert controls. Large files or partial snapshots
are labelled rather than presented as a complete review.

A reply can appear before the engine finishes its final work. **Reply ready · finishing
final checks** reflects that state. Follow-up messages wait in the queue until native
completion. Stop terminates the active engine process tree and discards queued messages;
file edits already completed remain on disk.

## Installation

### Requirements

| Requirement | Installed app | Source development |
| --- | --- | --- |
| Windows 10/11 x64 | Required | Required for Windows packaging and desktop checks |
| Muse engine | Installed and signed in on that PC | Required for live engine checks |
| Git for Windows | Required for full diff previews | Required for repository work and diff tests |
| Node.js 24+ | Bundled desktop runtime; no separate installation needed | Required on PATH |
| pnpm 11.19.0 | Not required | Required on PATH |
| Stitch account/key | Only for Stitch features | Only for live Stitch features |

Engine compatibility has been tested with Muse Code **1.4.1**. The engine and access
to its provider must be obtained separately; this repository does not bundle them.

### Install a release

1. Install Muse and sign in on your Windows account.
2. Open [Releases](https://github.com/uchihamazen/Muse-Desktop/releases) and, when an
   installer is published, download `Muse-Desktop-Setup-<version>-x64.exe`.
3. Run Setup and choose an installation folder. Installation is for the current user
   and creates **Muse Desktop** in Start/Windows Search.
4. Open the app. It discovers Muse under `%LOCALAPPDATA%\Programs\muse`; for another
   location, select **Engine settings → Choose Muse executable**.
5. Start a general conversation, or use **Add project** to choose a local folder.

Setup installs the complete Electron package beside the EXE. Keep those resources
together. The current package is unsigned; a trusted signing certificate is not
included, and antivirus acceptance is not guaranteed. Setup does not change Windows
security settings. Upgrades and uninstall preserve the local chat profile.

## Using the app

### Chat and projects

- **Enter** sends; **Shift+Enter** inserts a line; **Ctrl+N** starts a general chat.
- Use **+** or **Ctrl+V** to attach images. Limits: 20 images, 10 MiB per image,
  and 20 MiB total per message.
- Choose a model and reasoning effort from the engine-provided choices.
- In a project, select **Read only** to inspect or **Full access · YOLO** to allow
  edits and commands under your Windows account's permissions.
- Hover a conversation's delete control: the first click arms it, the second deletes
  the conversation and its native history. There is no built-in undo.
- The queue accepts up to 10 pending messages and is not retained after quitting.

### Browser annotations

1. Open **Browser** and enter an HTTP/HTTPS URL or local address such as `localhost:3000`.
2. Choose **Desktop** or **Mobile**, and **Expand** for more room.
3. Use **Annotate element** to click an element, or **Select region** to drag an area.
4. Click **Add to chat**. Muse receives a cropped screenshot of the visible selection
   with bounded HTML, URL and computed styles.
5. Write your design question in the main composer and send it.

Desktop fits a minimum **1280px CSS viewport**; Mobile previews a **390px viewport**.
Mobile changes responsive width, without emulating a phone's hardware, touch or user agent.
Navigation, scrolling, resizing and device changes invalidate the selection. Select again
if the page changes. Annotation HTML omits scripts, event handlers and form values,
and is limited to 24,000 characters. Frames are selected as outer elements.

The browser uses a persistent partition for cookies and login state. Web pages run
sandboxed without Node or the Muse bridge; downloads, native permissions and non-web
navigation schemes are denied.

### Google Stitch

Open **Engine settings → Google Stitch · MCP**, paste your own key and use **Test**
or **Connect**. Test checks a pasted key without saving it; Connect verifies access
before storing it in your local Muse settings. Muse discovers the native MCP tools
on the next request, including from its terminal.

Stitch generation depends on the tools available to your account, authentication and
quota. Supported Stitch image links render in chat and open in a larger viewer. A
failed or expired image URL offers a copy-link fallback. There is no separate model
or image-generation service bundled in the desktop app.

## Technology stack

| Layer | Technology | Role |
| --- | --- | --- |
| Desktop shell | Electron **44.5.0** | Native window, isolated preload/IPC, clipboard, dialogs and embedded browser views. |
| Browser/rendering | Chromium supplied by Electron | App rendering and sandboxed web previews; DevTools Protocol handles viewport metrics and cropped screenshots. |
| Runtime | Node.js; **24+** for development | Child processes, filesystem operations, HTTP requests and application orchestration. |
| Frontend | JavaScript ES modules, HTML5, CSS | Chat UI, responsive layout, activity cards, file reviews and image viewers. |
| Engine integration | Muse CLI, JSON Lines and JSON-RPC | `exec --json --session-id` runs turns; native logs restore context; `serve` discovers models. |
| Design integration | MCP over Streamable HTTP | Google Stitch tools configured through the native engine settings. |
| Local persistence | JSON files and Muse JSONL logs | Atomic preferences/conversation indexes, backups and per-conversation review data. |
| File review | Git CLI and Node filesystem watchers | Baseline comparisons, ignore-aware discovery and live diff updates. |
| Tests | Node.js test runner and Playwright **1.62.1** | Deterministic unit/lifecycle checks and browser/Electron smoke checks. |
| Package management | pnpm **11.19.0** | Pinned dependencies and frozen-lockfile installs. |
| Windows packaging | electron-builder **26.15.3**, NSIS | Per-user x64 Setup and staged unpacked builds. |
| Automation | GitHub Actions on Windows | Tests, installer builds and SHA-256 artifact checksums. |

Dependency versions are pinned in [package.json](package.json) and
[pnpm-lock.yaml](pnpm-lock.yaml).

## Build from source

Install Node.js 24+, pnpm 11.19.0 and Git for Windows, then:

```powershell
git clone https://github.com/uchihamazen/Muse-Desktop.git
Set-Location Muse-Desktop
pnpm install --frozen-lockfile
pnpm test
pnpm start
```

Build the Windows installer:

```powershell
pnpm run build
```

Output: `artifacts/release/Muse-Desktop-Setup-<version>-x64.exe`.
The build includes the desktop runtime and license notices. Output is staged outside
the local installed `dist` package.

For an unpacked development build:

```powershell
pnpm run build:desktop
# After verification, close the old app and use an external PowerShell:
& .\scripts\install-desktop.ps1
```

The local deployment helper installs `artifacts/self-build/win-unpacked` into `dist`
and preserves its shortcut path. Wait for a successful build exit before deployment.
Do not overwrite a running EXE or install a portable extraction wrapper in its place.
Quitting Muse Desktop stops its own engine process tree, so replacement must happen
from an external terminal. End users launch the Setup-created Start shortcut directly.

### GitHub Actions and releases

The [Windows installer workflow](.github/workflows/windows-build.yml) runs manually
from **Actions → Windows installer → Run workflow**, or on a pushed `v*` tag. It
installs locked dependencies, runs Node tests and builds Setup plus a SHA-256 checksum.
Download the resulting artifact and attach those files to a GitHub Release. The
workflow does not publish a Release automatically or require a Muse account/API key.

## Privacy and local data

Each Windows account stores preferences and the conversation index in
`%APPDATA%\Muse Desktop`. Native Muse logs retain message context; the embedded
browser retains its own cookies locally. Local storage does not imply offline AI:
messages, images and tool context are sent through the selected engine/provider and
are subject to that provider's terms.

Stitch credentials live in the native local Muse settings, outside project files.
They are not displayed in chat/state/error output, and this project does not claim
that the engine's JSON settings file is an encrypted credential vault.

Public source packages exclude chat/session logs, profiles, backups, API keys,
machine-specific settings, internal development records and the original development
Git history. Test credentials in fixtures are synthetic. Upload code and public
documentation; attach installers/checksums as Release assets. Preserve real credentials
and user profiles locally.

`scripts/clean-local-builds.ps1 -WhatIf` previews removal of obsolete local build
copies. It preserves the installed package, release files, dependencies and chat/profile backups.

## Optional Ponytail / Superpowers workflows

The [workflow-defaults plugin](muse-plugins/workflow-defaults/README.md) loads startup
instructions into Muse sessions. It requires Node on PATH, an approved native hook,
and separately installed full Superpowers/Ponytail skill libraries on each machine.
It is not automatically installed by Setup. Project instructions and direct user
requests remain authoritative. Its original license notices are retained.

## Testing and troubleshooting

```powershell
pnpm test
node scripts/frontend-smoke.js
node scripts/browser-smoke.js
node scripts/ui-smoke.js
```

Frontend smoke uses Microsoft Edge; desktop smoke checks use temporary profiles.
Live engine checks require a signed-in Muse installation. Adding `--send` to supported
smoke scripts uses the provider account. Reports and screenshots stay in ignored `artifacts`.

| Symptom | What to check |
| --- | --- |
| Engine is disconnected | Confirm Muse is installed and signed in; select its executable and Reconnect. |
| Chat appears restored but cannot send | A native log is missing. Cached text can be displayed, but cannot recreate engine context; restore the native log or start a new chat. |
| Reply is visible while the request remains busy | The engine may still be finishing native work; follow the activity cards or queue a follow-up. |
| Diff is unavailable or incomplete | Check Git installation and the review's partial/large-file limits. |
| Browser selection cannot attach | Wait for loading to finish and reselect after navigation, scrolling or resizing. |
| Stitch tools or images fail | Test your account/key, check quota and confirm the image URL remains accessible. |

Muse 1.4.1's headless interface does not support working streamed turns/history via
the tested MSP methods or interactive per-tool approval dialogs. Turns therefore use
the working CLI/native-log path; granular approvals remain in the Muse terminal.
Windows child processes receive `RUST_MIN_STACK=33554432` to address the tested runtime's
thread-stack issue, without modifying global environment settings.

## Contributing

Fork the repository, make a focused change, update [docs/features.md](docs/features.md),
and run checks appropriate to the change. Keep feature entries concise. Include no
real account keys, chat histories or personal screenshots. Check [AGENTS.md](AGENTS.md)
for build and publication guidance. Rebuild and verify the installer when application
behavior or packaged files change.

## Contributors

- [@Qorsham](https://github.com/Qorsham) — Original idea and contributions to performance optimization.

## License and attribution

Original project code is available under the [MIT License](LICENSE), allowing use,
modification and redistribution subject to its notice requirements.

**Meta retains all rights in its name, logo and brand assets. OpenAI retains all rights
in OpenAI/Codex names and associated brand assets.** Third-party software, artwork,
services and trademarks remain covered by their owners' terms and are not relicensed
by this project's MIT license. Attribution does not itself grant trademark permission.

Muse Desktop is an independent project; no Meta or OpenAI sponsorship, affiliation
or endorsement is claimed. The workflow's inspiration does not transfer ownership
of the project's original code to either company.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md),
[Meta's brand guidelines](https://www.meta.com/brand/resources/meta/company-brand/),
[OpenAI's brand guidelines](https://openai.com/brand/), and
[asset attribution](src/assets/README.md).
