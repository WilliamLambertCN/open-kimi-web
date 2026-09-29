# Upstream tracking

Open Kimi Web serves the official Kimi Code web bundle and adds a small
launcher and presentation layer. It does not maintain a separate frontend
or a vendored transcript implementation.

## Current baseline

- Upstream: [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code).
- Inspected published package version: `2.1.1`.
- Official release tag commit: `f67e6398fb3210ad8ace970e2dfd5bcc984ed61f`.
- Published package integrity:
  `sha512-xClqcnTQUKgKDbeOGPU78qcwxGzL8wA2rqWuOX3CLpyQ1/NhSX7jAh6hZo/JFwThSX8obkgef3uw/li5JaJNyw==`.
- Server API compatibility target: `2.1.1`; no complete live protocol recapture was performed.
- Open Kimi Web version: `2.1.1-r5`, still based on `2.1.1`.
  The earlier `2.1.1-r1` was withdrawn after the archive loop was confirmed; `r2`–`r4` remain historical releases.
  `r5` includes usage pricing auto-match, batch confirmation, pagination, a complete usage bundle and pricing
  refresh continuity. After `r5` is released, retire only the older `r2`–`r4` tgz assets; retain tags and releases.
- Machine-readable upstream version and historical contract records: `upstream.json`.

`r5` keeps manual mappings and rates ahead of automatic defaults. Each model's original default catalog key
is preserved separately from manual mappings: the same key uses the updated price after refresh; if absent,
the last valid entry remains available with an old-price source label. `r4` cache recovery uses only known
built-in origins, never fuzzy suggestions for billing. The earlier `r4` refresh with 7,932 entries left
13 built-in models unpriced; a live public catalog with 7,926 entries was checked after the fix, and all
13 retained their original keys with updated rates. These checks did not access a user's actual local data.

The commit resolves from the official `@moonshot-ai/kimi-code@2.1.1` Git tag;
the integrity comes from npm package metadata. Static inspection of the
published `dist-web` confirmed the title composer, archive selectors,
provider model rows (`.pmt-grid`), `prompts:steer`, and the empty-state logo.
The old `.empty-doodle` and `.empty-hint-text` elements are absent, so their
mobile overrides were removed. These are bundle observations, not live server
or browser interaction results.

An isolated `2.1.1` backend returned `server_version: 2.1.1`; the launcher
served that official page with the Side Chat guard before the official module.
Separate headless Chrome checks used fictional content with the official
`2.1.1` CSS to verify scroll behavior and unchanged initial layout across
content lengths, viewports, and affected themes. A real side agent turn was
not run in this isolated environment.

The historical `r4` mobile question checks used the complete `2.1.1` Web app with fictional
API and WebSocket responses. They covered the real `question` field, choices,
answer requests, height dragging and persistence, constrained viewports, and
seven appearances. These are isolated browser results, not physical phone or
real-session acceptance. See the [verification record](docs/plans/mobile-question-height-v1-verification.md).

The `2.1.1` workspace store reads `kimi-web.workspace-sort` as `manual` or
`recent`. Its recent order uses session update times and workspace
`last_opened_at`; the default script selects `recent` only when this preference
has not been set, leaving an explicit manual choice intact.

The `2.1.1` Web bundle requests non-forced title generation after a turn and
uses `force: true` for manual regeneration. Default fork titles begin with
`Fork: `, but neither v1 session details nor the v2 session list exposes
`forkedFrom`. The presentation guard checks the current v1 title before the
automatic request and preserves it while that prefix remains. Manual title
changes and forced regeneration still use the official API. Requests made
outside Open Kimi Web, including direct CLI traffic, remain upstream behavior.

The `0.43.1` compatibility audit established that, during a running turn,
the regular `.send` control creates a queued prompt. Steering a specific new
prompt requires `POST /api/v1/sessions/{session_id}/prompts:steer` with its
`prompt_id`; `Ctrl+S` promotes the existing queue head. The `2.1.1` bundle
still contains the steer path, but this release has not been checked through
a real-browser click-through or live server protocol validation.

In `2.1.1`, `SideChatPanel` watches a summary of the latest turn and assigns
`.sc-body.scrollTop = .sc-body.scrollHeight` after every streamed change while
the side agent is running. The local guard keeps tail following until the
reader scrolls away, then blocks only that bottom assignment on the Side Chat
body. Scrolling back to the bottom resumes following. Other scroll containers
and user-provided `--web-dir` builds are untouched.

By default the launcher resolves the web bundle version from the target
server, with its configured fallback when metadata is unavailable.
`--web-version` / `OPEN_KIMI_WEB_VERSION` pins the official frontend version;
it does not pin or upgrade the backend. `--web-dir` / `OPEN_KIMI_WEB_DIR`
serves a prepared build without injecting the presentation layer or theme picker.

## Maintaining enhancements

The usage statistics feature follows
[`docs/plans/usage-statistics-v1-plan.md`](docs/plans/usage-statistics-v1-plan.md).
Kimi Code `2.1.1` persists `usage.record` events with request usage, model alias,
and a millisecond timestamp. The four counters are `inputOther`, `inputCacheRead`,
`inputCacheCreation`, and `output`; total input includes all three input counters.
Durable `llm.request` records carry the model ID sent to the upstream API in `model`;
their `provider` field is a protocol, not a historical billing channel. Statistics
associate compatible request and usage records within each agent wire, accepting
only an unambiguous model ID. Missing or conflicting identities remain unresolved
and unpriced, with their token counts preserved. Aliases are display metadata only.
The existing session and transcript APIs do not preserve equivalent history
detail, so full statistics require the known local managed backend data directory.
External `--target` mode must not silently read a different local data source.

Forks copy source agent wire records and append a `forked` marker. Statistics
exclude inherited prefixes and retain physical usage from inactive branches.
Provider cache fields can be normalized to zero when unreported. Statistics and
price mappings use confirmed model IDs; multiple aliases for one ID are combined,
while an alias rebound to different IDs is separated. Old alias-keyed price settings
are not reinterpreted as ID mappings. Historical channels cannot be recovered from
the request protocol. Costs use current public or manually entered prices as API estimates.
Deleted, damaged, unrecorded, and unverified older wire formats may be incomplete.

Keep HTTPS and proxy behavior in the launcher, and keep presentation fixes
in `packages/launcher/src/mobile/`. When adopting another official version,
check the affected selectors and behaviors. Remove a local workaround when
the upstream version fixes the corresponding issue. Do not rebuild session
state management in DOM patches.

Observer-driven enhancements must converge after their own DOM writes. Assigning
the same `textContent` still emits a child-list mutation, so existing controls need
value guards. Keep a real MutationObserver regression with an in-callback stop guard;
a fake observer or an HTTP asset check does not establish browser-side convergence.

The presentation layer also provides five optional CSS atmosphere themes through
the official settings panel. Theme selection uses its own local browser storage
and root attribute; restoring the original appearance removes these overrides
without changing the official light/dark/system preference. Keep theme colors
on upstream semantic tokens where possible and check component selectors when
upgrading the official bundle.

The removed `--web-ui open` frontend is not a fallback. If an official bundle
cannot be loaded, restore access to its package or provide a prepared build.
The historical 0.32 source snapshot is not the active implementation.

## Historical protocol snapshots

`contracts/upstream/openapi.json` and `asyncapi.json` were captured from a real
upstream server at the older 0.41.0 baseline. `metadata.json` records their
origin and original checksums. They remain historical reference material;
the retired standalone-client contract tests and capture workflow no longer
run. The `0.43.1` archive, deletion, and steer behavior was checked separately,
but the full artifacts were not recaptured, so these snapshots do not claim
`0.43.1`, `2.0.2`, or `2.1.1` coverage.
