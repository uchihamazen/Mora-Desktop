# Third-party notices and attribution

Mora Desktop's original project code is licensed under the [MIT License](LICENSE).
That license does not transfer rights in third-party names, trademarks, artwork,
services or separately installed software.

## Meta

The Meta and Muse names and associated trademarks and brand assets belong to
Meta and their respective rights holders. References to Muse Code describe the
separately installed engine this app works with. Meta's logo is not bundled with
Mora Desktop. See the [Meta brand guidelines](https://www.meta.com/brand/resources/meta/company-brand/).
Attribution alone is not a grant of permission to use or redistribute a trademark.

The Muse engine is installed separately and remains subject to its own applicable
license, account requirements and service terms.

## Mora artwork

The Mora M icon is original project artwork covered by this repository's MIT
license. Its SVG source and Windows ICO are documented in
[src/assets/README.md](src/assets/README.md).

## OpenAI

OpenAI, Codex and related product names and brand assets belong to OpenAI and their
respective rights holders. All rights in those marks and assets remain with their
owners; see [OpenAI's brand guidelines](https://openai.com/brand/).

The desktop workflow is inspired by Codex-style coding interfaces. This independent
project is not an official Meta or OpenAI product, and no sponsorship, partnership
or endorsement by either company is claimed. Mentioning Codex does not grant a
license to OpenAI's product code, artwork or trademarks.

## Bundled workflow instructions

- Superpowers: copyright and MIT terms are preserved in
  [SUPERPOWERS-LICENSE](muse-plugins/workflow-defaults/SUPERPOWERS-LICENSE).
- Engineering Suite / Ponytail: copyright and MIT terms are preserved in
  [PONYTAIL-LICENSE](muse-plugins/workflow-defaults/PONYTAIL-LICENSE).

## Runtime, dependencies and services

Mora Mode uses unmodified LangChain, LangGraph, their core/checkpoint/SDK packages,
and Deep Agents by LangChain, Inc., distributed under the MIT License. Zod by
Colin McDonnell is also distributed under MIT. Their original LICENSE files remain
in the installed and packaged dependencies; exact versions are recorded in
`pnpm-lock.yaml`. Source: [LangChain.js](https://github.com/langchain-ai/langchainjs),
[LangGraph.js](https://github.com/langchain-ai/langgraphjs),
[Deep Agents.js](https://github.com/langchain-ai/deepagentsjs), and
[Zod](https://github.com/colinhacks/zod). These libraries do not include Muse account
credentials or grant rights to the separately installed model service.

Electron, Chromium, Node.js and other dependencies retain their original licenses
and notices. Windows packages preserve `LICENSE.electron.txt` and
`LICENSES.chromium.html` from the Electron distribution. Development dependencies
are obtained from their package publishers when installed.

Website testing bundles Playwright and its matching browser distribution. Playwright
is distributed under Apache-2.0; its LICENSE and NOTICE are retained in the runtime
and `resources/website-browser/PLAYWRIGHT-LICENSE` and `PLAYWRIGHT-NOTICE`.
The dedicated browser's component notices are retained as
`resources/website-browser/LICENSES.chromium.html`, collected from that exact browser's
credits page during packaging. The source build prepares a clean pinned browser rather
than copying an everyday browser profile or development cache into the installer.

Accessibility checks bundle unmodified `@axe-core/playwright` 4.13.0 and `axe-core`
4.13.0 by Deque Systems, distributed under Mozilla Public License 2.0. Their LICENSE
files remain in the packaged dependencies. Corresponding source is available from
[axe-core-npm](https://github.com/dequelabs/axe-core-npm) and
[axe-core](https://github.com/dequelabs/axe-core); the pinned package versions are
recorded in `pnpm-lock.yaml`.

Google Stitch and other external services remain subject to their respective
owners' rights and service terms. This repository does not distribute account
credentials, provider API keys or a license to those services.
