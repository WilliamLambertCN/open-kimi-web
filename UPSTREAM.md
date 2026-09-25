# Upstream tracking

Open Kimi Web serves the official Kimi Code web bundle and adds a small
launcher and presentation layer. It does not maintain a separate frontend
or a vendored transcript implementation.

## Current baseline

- Upstream: [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code).
- Inspected published package version: `2.0.2`.
- Provenance release commit: `9d07f634be94ebeb1deba2f55d247807cf729315`.
- Published package integrity:
  `sha512-JjZIwlsrUgrpnMgH1jKZAot8FJt36NWwItdWmRq/sj7ewe9RswDPWX+mBhdlGoyhSTfAEG6KjMGanhyADKTWsA==`.
- Server API compatibility target: `2.0.2`; no complete live protocol recapture was performed.
- Open Kimi Web release target: `2.0.2-r1`.
- Machine-readable version and historical contract records: `upstream.json`.

The commit comes from the resolved Git dependency in the npm provenance
attestation for `@moonshot-ai/kimi-code@2.0.2`; the integrity comes from npm
package metadata. Static inspection of that published `dist-web` confirmed
the title composer, archive selectors, provider model rows (`.pmt-grid`),
the `prompts:steer` path, and the new empty-state logo (`.empty-logo`).
The old `.empty-doodle` and `.empty-hint-text` elements are absent, so their
mobile overrides were removed. These are bundle observations, not live server
or browser interaction results.

The `2.0.2` workspace store reads `kimi-web.workspace-sort` as `manual` or
`recent`. Its recent order uses session update times and workspace
`last_opened_at`; the default script selects `recent` only when this preference
has not been set, leaving an explicit manual choice intact.

The `0.43.1` compatibility audit established that, during a running turn,
the regular `.send` control creates a queued prompt. Steering a specific new
prompt requires `POST /api/v1/sessions/{session_id}/prompts:steer` with its
`prompt_id`; `Ctrl+S` promotes the existing queue head. The `2.0.2` bundle
still contains the steer path, but this release has not been checked through
a real-browser click-through or live server protocol validation.

By default the launcher resolves the web bundle version from the target
server, with its configured fallback when metadata is unavailable.
`--web-version` / `OPEN_KIMI_WEB_VERSION` pins the official frontend version;
it does not pin or upgrade the backend. `--web-dir` / `OPEN_KIMI_WEB_DIR`
serves a prepared build without injecting the presentation layer or theme picker.

## Maintaining enhancements

Keep HTTPS and proxy behavior in the launcher, and keep presentation fixes
in `packages/launcher/src/mobile/`. When adopting another official version,
check the affected selectors and behaviors. Remove a local workaround when
the upstream version fixes the corresponding issue. Do not rebuild session
state management in DOM patches.

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
`0.43.1` or `2.0.2` coverage.
