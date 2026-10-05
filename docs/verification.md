# Mora Mode verification

Mora integrates a worker's changes only after host checks pass against the captured source revision. Checks run outside the model; a worker's completion message is not test evidence. Failed checks retain the isolated source and results for review.

## Project commands

With Full access or approval for one task run, Mora uses the original project's configured `typecheck` (or `check`), `build`, `test`, and `test:flows` (or `test:e2e`) scripts. Commands run in shallow disposable source copies using installed project dependencies, a clean environment and a short temporary home/cache directory. Copies are removed after project and browser verification; result evidence stays with the task. Mora does not install missing dependencies or replace project scripts.

Original tests, check scripts, conventional test inputs and the verification configuration are restored for an original-regression pass; current inputs are also checked when different. Changed command definitions are refused for separate review. Empty test-suite output, timeouts and source changes during checks fail verification. An unconventional indirect check input may need manual review.

Without project commands, discovered Node `.test.js` / `.spec.js` suites run with restricted filesystem permissions, including the original regressions. JavaScript syntax is checked with the declared module type. Python projects with discovered `test_*.py` / `*_test.py` files use `unittest` when Python is installed and Full access or this-run command approval is available. Other test frameworks should expose an established project command. Missing runtimes or no available checks leave changes isolated.

Commands normally have a two-minute deadline. They must exit when done and keep child processes attached until completion; daemonized children that outlive an exited Windows parent are not covered by tree cleanup. Stop/timeout terminates a still-running command tree.

Project commands are trusted local code running with the user's permissions. Disposable copies, a clean environment and Node's permission controls are useful safeguards, not an operating-system sandbox. Installed dependency files are reused; project commands must not modify those dependencies or rely on personal account files.

## Browser workflows

Add `.mora/verification.json` to the project before dispatching a task. For example:

```json
{
  "browser": {
    "path": "/",
    "steps": [
      { "action": "click", "role": "button", "name": "Add" },
      {
        "action": "assert",
        "role": "status",
        "name": "Count",
        "check": "text",
        "expected": "1"
      }
    ]
  }
}
```

Use an exact accessible role/name or label for each locator. Supported actions are `click`, `fill`, `select`, `press` and `assert`; assertions check exact text, value, visibility or checked state. `select` uses an option label. Visibility/checked expectations are the strings `"true"` or `"false"`. A workflow needs an outcome assertion and at most 20 steps. Worker changes to these requirements require a separate review.

Verification opens a fresh browser context on an owned local preview. When a successful build produces `dist/index.html`, Mora serves that output; otherwise it starts the established dev/start/serve command or serves a plain website. Starting a project command requires Full access or approval for this task run. HTTP resources and WebSockets must stay on that preview's origin; external dependencies make coverage fail explicitly. HTTP redirects are currently unsupported and fail coverage before being followed; configure a canonical page path that loads directly. The browser blocks service workers, downloads and popups and records runtime errors. Browser checks have a bounded deadline.

Browser verification is mandatory for recognized web apps on every task, including data/backend edits. Recognition uses original/current root website HTML, configured web preview commands and framework/UI/server entrypoints (including relative imports), or successfully built `dist/index.html`. Documentation/templates and pure library build-watch scripts do not declare a product preview. Removing an original web indicator cannot skip the requirement. Missing browsers, preview launch failures, unavailable dependencies and failed outcomes block integration. Discovery covers supported local previews; an unconventional web app should declare a baseline workflow and a supported preview command so it cannot be mistaken for a command-line tool or library.

A successful **Run my app** preview also marks that Mora Mode chat as requiring browser verification. This observation survives reopening and covers apps that file detection does not recognize. Active workers also receive the requirement; a task that already skipped the browser must recheck before applying. If the preview becomes available during integration, unchecked changes are rolled back. For an unusual app without an authored workflow, run its preview before delegating changes.

`Workflow passed` means the configured outcomes passed. `Smoke passed` means the page loaded without observed runtime errors; it does not prove user flows or new-feature correctness. Without an authored workflow, recognized web apps receive required smoke checks. Non-browser projects without a configured workflow may show `Not checked`.

The task's **Review result** shows check outcomes and a screenshot when available. Failed browser checks also retain a local trace alongside the verification record. Saved evidence is historical; later project changes do not update it.

## Independent source review and recovery

Candidates changing at least three files, sensitive access/credential files, or 200 total before/after lines require a separate read-only Muse reviewer. It receives actual changed hunks and paginated current/original source tools. Binary, invalid UTF-8 or truncated inputs block integration and should be split into smaller tasks. Approval requires no material findings; malformed or contradictory replies fail closed.

Review supplements host checks. Its fingerprint and verification-input revision must still match before integration; changed check inputs or source need fresh verification/review. Cancellation prevents application. Findings remain with the isolated candidate for correction.

After application, Review files provides Keep and guarded file/hunk Reject; rejection first saves recovery and refuses newer manual edits. Saved checks cover the task revision; later edits need Test again. Model review does not prove the absence of bugs.

## Role-specific guidance

Mora Mode reads existing namespaced Ponytail and Superpowers libraries from the local Codex plugin cache. It installs nothing. The coordinator can discover planning/review skills; workers can discover Ponytail Full, execution, debugging and verification skills. Test-driven guidance is available when the worker owns explicit test paths. Skill metadata is listed first, and original bodies or supporting text are read only when needed. One installed version per namespace is cached for the conversation.

Workers must read the available Ponytail body before editing. Skill instructions remain below the user request, assigned files and existing tools; referenced scripts are readable references rather than execution permissions. Native skill activation and plugin hooks stay disabled in the isolated engine. Missing libraries appear in the task panel/results and work continues with native guidance. Normal chat behavior is unchanged.

Actual reads retain the skill ID, installed version, resource and SHA-256, including failed or cancelled tasks and coordinator requests. Bodies are not copied into task receipts or source archives. Reads reject escaped/linked paths, invalid text and oversized tool payloads; supporting-resource caching is bounded. Review result displays loaded skills, which does not prove that the model followed every instruction or that the work is correct. Host checks remain authoritative.

This follows [LangChain progressive skill loading](https://docs.langchain.com/oss/javascript/deepagents/skills) while retaining Mora's guarded source tools.

## Reliability and measurement

The workload benchmark compares one combined worker, three independent workers, and independent work followed by a dependent integration task. It uses original regressions, an external feature grader, a local browser workflow, repeated trials and a question while work is running. Run `node scripts/mora-workload-benchmark.js` for the offline harness; real-provider trials require the explicit native option and an installed signed-in engine. Inspect the script's arguments before running provider trials.

Keep failed and interrupted attempts alongside successful results. Report correctness and coverage before timing; a parallel task graph is useful only when tasks are independent. A small workload comparison is not a universal speed or reliability guarantee.

The design follows [LangChain asynchronous subagents](https://docs.langchain.com/oss/javascript/deepagents/async-subagents), [Playwright testing practices](https://playwright.dev/docs/best-practices), and [outcome-based agent evaluation](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).
