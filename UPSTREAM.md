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
- Open Kimi Web version: `2.1.1-r9`, still based on `2.1.1`; use the fixed GitHub Release tgz URL.
  `r9` adds dependency-free Node streaming gzip for HTTP proxy responses, official/custom static and injected resources.
  Earlier presentation features and safe self-update since `r8` remain unchanged.
  Windows standard checks and complete official-app source checks passed.
  Package-browser, CI and online verification are separately [recorded in the release plan][lan-plan].
- Historical `r8` acceptance, not an r9 CI or release result:
  Windows passed lint, typecheck, 65 unit-test files/1007 tests, 11 integration-test files/89 tests and test:pack.
  Windows unit line/branch coverage was 87.58%/79.64%; integration coverage was 87.43%/74.87%.
  [PR #24 Ubuntu CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/37879364663) succeeded.
  Ubuntu passed lint, typecheck and test:pack; 65 unit-test files had 1006 passes and one Windows-only skip (1007 total).
  Integration tests had 10 passing files/one skipped file, 87 passes and two Windows-only skips (89 total).
  Ubuntu unit line/branch coverage was 87.31%/79.79%; integration coverage was 86.11%/73.95%, with unchanged gates.
  Chrome checks used the complete official app with fictional REST/WS, not physical devices or real user data.
  The r8 record lists online asset installation and already-current checks as separate post-publication verification.
  Production-user upgrades are outside this isolated acceptance.
- The earlier `2.1.1-r1` release is absent after withdrawal; its withdrawal history remains in CHANGELOG.
  The historical GitHub query found no assets on `r2`–`r4`; retain those historical tags and releases.
  No further asset deletion is planned, and `r5` or other releases are not changed by this revision.
- Machine-readable upstream version and historical contract records: `upstream.json`.

## r9 streaming gzip and remaining boundaries

`packages/launcher/src/responseCompression.mjs` uses only Node zlib and stream, adding no runtime dependency.
It serves HTTP proxy responses, official/custom static files and injected resources. Compressible MIME types
negotiate gzip via Accept-Encoding when known length is at least 1024 bytes or the stream length is unknown.
Level 1 and `Z_SYNC_FLUSH` keep the transfer streaming; no whole-body compression buffer or session cache is added.
Vary is merged; transformed responses drop original Content-Length and encoding-related digest headers,
and valid strong ETags become weak. Pipeline preserves backpressure and cleans up on errors, cancellation and disconnects.
Identity preference, gzip q=0, existing encoding, HEAD, no-body statuses, Range/206, SSE and no-transform skip transcoding.
Payload, pagination, authorization and WS semantics remain intact.
Folding defaults/preferences, observers and themes do not change.
Custom `--web-dir` builds still receive no presentation injection, although eligible static responses can be compressed.

The exact official `2.1.1` main view already requests page_size=10, uses before_turn for history and keeps four resident sessions.
The problem is not downloading all history. The backend fully reduces agent history before paging and includes tasks and other
associated entities on each page; a single turn can also be large. Wire log size is not response size.
Official Remote Control negotiates gzip, whereas the local entry and r8 proxy send raw responses.
The isolated real-backend check passed 48 requests/147 assertions for recent pages, exclusive cursors and entity boundaries.
The complete official app using r9 source passed 10 samples/217 assertions plus 27 edge assertions, with no page errors.
Desktop Original checks used explicit folded tools, n=3 medians, 25 ms latency and 1 MiB/s.
Tool content became visible at 109 ms versus 2885 ms in r8; decoded response size stayed 1,340,243 bytes.
The gzip transfer was 11,710 bytes. Fictional, highly repetitive fixtures do not establish general compression gains,
actual Remote Control tunnel or user LAN performance. Trusted input was tested after content visibility,
not at its earliest availability.
Wheel pagination, zero-download resident switching and slow-B/fast-C stale-response protection passed; B was not aborted.
HTTP 500 triggered official automatic retry. Valid WS append, duplicate and reset, plus missing-sequence REST recovery passed;
the resumed subscribe_v2 used transcript_since.main=9. Raw HTTP integration separately verified upstream closure after client
 disconnect for gzip and identity; the browser race check is not cancellation proof. Representative images were reviewed,
not a full visual acceptance: the existing Original mobile top badge/subtitle contrast issue remains unchanged.

Windows passed lint, typecheck, 66 unit-test files/1146 tests, 13 integration-test files/154 tests and test:pack.
Unit line/branch coverage was 88.14%/80.76%; integration coverage was 87.98%/75.91%, with unchanged gates.
Review follow-ups cover conditional variant metadata, preset response headers, 205 framing and idle timeout after a gzip chunk.
Package smoke verified r9 version, the included compression module and live static/API calls.
Source-app acceptance is not package-browser acceptance; package-browser, PR/main CI and online verification
are separately recorded in the [release plan][lan-plan]. No CI or online-install result is inferred from local checks.
Shared expanded-tool render/layout still has 400–900 ms long tasks and is not fixed by this revision.
Gzip does not remove full-history reduction, JSON parsing or synchronous rendering. Physical phones, real home Wi-Fi
and production installation are unverified. After upgrading, restart the old launcher and refresh the page;
no session migration or official-cache clearing is needed.

## Retained r8 enhancements and historical acceptance

`r8` added current-session wire size beside the desktop main title and above an empty session, as well as below
mobile titles. Desktop and mobile share request state and the 10-second refresh timer. It includes agent wires,
not image attachments, and does not parse log contents. Only managed local mode is supported; unavailable size
is shown as `会话 —`. This is not a token context limit and does not replace official session state.

The mobile session sheet restores the official flat/grouped controls and each device view preference.
Grouped workspaces offer recent-session, workspace-name and desktop-saved display order; flat and in-group
sessions keep official update-time order. Existing pins require uniquely confirmed workspace identity.
Missing data or conflicting shortened paths disable desktop-saved order rather than guessing IDs.
CSS display order never moves Vue nodes; keyboard and screen-reader DOM order remains upstream order.
For r8, the complete official app passed the 42-case mobile appearance matrix and targeted pagination, collapse,
selection, persistence and breakpoint checks. This is historical isolated Chrome acceptance, not physical-phone testing.

Since `r8`, the launcher provides `update`, `update --check` and `update --help`; the `r7` package has no update command
and must first be upgraded manually. Updates identify the executing installation, not the current directory or default npm prefix.
Source updates require a clean official-repository main tracking origin/main, fast-forward and frozen-lockfile install.
Dirty, ahead, diverged or development branches are rejected without stash, reset or branch switching.
Recognized global/custom-prefix npm installs and simple local direct dependencies use the exact latest formal
GitHub Release tgz, retaining local production/development dependency type and updating the owner manifest/lock.
Temporary npx, links, workspaces, mixed package managers and ambiguous installations are rejected.
Updates do not change official Kimi, another installation, PATH, integration state, certificates, Web cache or sessions.
They are non-atomic: failures report the completed stage and recovery steps, without automatic rollback or restart.
Package-manager caches can change; local npm resolves the owner's dependency tree, not byte-identical unrelated packages.
Unconfirmed descendant termination retains the installation lock until the updater and descendants are confirmed stopped.
Isolated source/npm replacement with test tgz passed; Windows spaces, &, % paths and timeout/cancellation were checked.
Ubuntu CI passed real isolated source/npm replacement, npm Config/Pacote negative checks and POSIX TERM/process-group cleanup.
These checks did not update a production-user installation or install online Release assets for acceptance.

Historically, `r7` added pane-responsive desktop width, mobile session size and reliable missing message timestamps.
Its source passed lint, typecheck, 862 unit tests, 77 integration tests and test:pack before release.
It scopes container-query width rules to the main desktop pane, sharing the official reading-width variable
with the composer and synchronizing the conversation index. It retains the 760px baseline, gutters and scrollbar
compensation. The 3840px Nocturne fixture measured a 3536px pane and a net text column growing from 720px to
2121.59px, approximately 60%. Six before/after cases and real sidebar/panel/divider interactions passed 131
selected layout assertions. Mobile and a natively opened empty Side Chat kept identical geometry.
Missing main-message timestamps require official transcript time and exact message identity. Unknown history,
Side Chat, WS-only messages and responses over 1,048,576 characters are not enhanced.

`r5` keeps manual mappings and rates ahead of automatic defaults. Each model's original default catalog key
is preserved separately from manual mappings: the same key uses the updated price after refresh; if absent,
the last valid entry remains available with an old-price source label. `r4` cache recovery uses only known
built-in origins, never fuzzy suggestions for billing. The earlier `r4` refresh with 7,932 entries left
13 built-in models unpriced; a live public catalog with 7,926 entries was checked after the fix, and all
13 retained their original keys with updated rates. These checks did not access a user's actual local data.

In `2.1.1`, default `fs:read` reads only 1 MiB; a truncated PNG can still decode with an incomplete bottom.
The image guard uses the authenticated official `fs/{path}:download` endpoint for truncated base64 images.
Explicit partial reads and non-image requests retain upstream behavior. Downloads reject redirects and
validate image MIME, expected size and complete bytes, with a 32 MiB limit. Failures are explicit; the guard
never returns a partial image as a successful full preview. Page authorization, credentials and cancellation
remain intact; no image data, paths or tokens are logged or persisted.
The actual r6 tgz equivalent-image Chrome pixel matrix passed 115 assertions with 110 screenshots: opaque
2.69 MB, transparent 1.57 MB, over-10-MiB images, failures and Fit/Actual across all themes. Full RGBA and
normal transparency were correct. This pixel matrix is distinct from complete official-app acceptance.
Separately, the complete official `2.1.1` app dynamically imported the unpacked package's officialPresentation
resources. Four PNGs used native `.fp-image`, reading 1 MiB before downloading full opaque 3,148,932-byte and
transparent 1,833,306-byte files; bottom RGBA and native Fit-to-Actual-to-Fit passed.

The tab layer observes semantic click targets and adds temporary, non-intercepting Loading feedback.
It yields related same-origin transcript, file-read and category-list response delivery for a paint opportunity,
then returns control to native Loading. It does not modify the official bundle, use Vue private state,
copy official session/file state, replay clicks or replace content loaders. Rapid clicks keep only current
feedback; stale responses, errors, closing and navigation clean it up without taking over upstream generation.
The real official `2.1.1` app, with fictional API data, was checked in 14 desktop/mobile appearance groups:
56 network-path clicks reached a visible post-rAF task in 4.6–31.1 ms with native selection/route and spinner.
Slow B then fast C, category errors/retry and closing left no stale feedback or old-response overwrite.
Actual unpacked resources also passed complete-app checks in original desktop and Nocturne mobile: eight
clicks had 9.8–34.5 ms paint opportunities; slow B/fast C, failure and closing passed.
These measure paint opportunities, not operating-system display latency or physical-device acceptance.
About 2.1 MB of inline text still took 453.6 ms, and a cached 45-turn session took 152 ms; both remain blocking.
There is no public outer-layer hook to split upstream synchronous rendering, so not all tab stalls are fixed.
For the historical r6 release, lint, typecheck, 644 unit tests, 61 integration tests, test:pack and actual
package installation/startup passed; PR #22 CI was green. Physical devices and users' actual data were not tested.

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
still contains the steer path, but that steer flow has not been checked through
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

[lan-plan]: docs/plans/large-session-lan-performance-v1-plan.md
