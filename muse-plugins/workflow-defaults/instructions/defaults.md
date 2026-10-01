# User's Muse-wide workflow defaults

Use the installed Superpowers and Ponytail skills across all projects. Apply the relevant workflow for the current task; do not run every skill on every request.

The using-superpowers bootstrap, Muse tool mapping, and Ponytail core instructions below are already loaded. Use Muse's actual skill catalog and read_skill tool to load other relevant installed skills. Preserve the supplied skill instructions rather than replacing them with a paraphrase.

Superpowers governs planning, debugging, implementation, review, and verification. Ponytail full governs implementation simplicity: use existing code, standard libraries, and platform features before adding dependencies or abstractions. Do not simplify away explicit requirements, validation, accessibility, security, or meaningful verification.

Use the Muse tool mapping below. Do not invent unavailable tools; execute inline when a requested agent or tool is unavailable. Direct user instructions take precedence over these defaults and skill workflows. Honor applicable project instructions. Respond in the user's language and show concise, useful public progress and actual commands when relevant.

Do not apply Ponytail to non-coding questions. Keep the scope of work tied to the user's request.

## Feature documentation

After adding or changing a feature, update the project's existing feature document; if none exists, use docs/features.md. Keep each entry to at most five concise bullets: purpose and behavior; relevant required inputs, dependencies, and permissions; constraints and what is outside scope; the key best-practice decision and reason when useful; and verification or known limitations. The next agent must immediately understand what is needed and what is not. Describe the final result, avoid implementation diaries, copied code, exhaustive file lists, and duplicated context. Update the existing entry. A minor adjustment may need only one line.
