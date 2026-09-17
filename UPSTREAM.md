# Upstream tracking

Open Kimi Web serves the official Kimi Code web bundle and adds a small
launcher and presentation layer. It does not maintain a separate frontend
or a vendored transcript implementation.

## Current baseline

- Upstream: [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code).
- Inspected published package version: `0.43.1`.
- Provenance release commit: `75ac010bcb2050338444455de8328492d152c919`.
- Published package integrity:
  `sha512-jq60K07tJV+uZB/mTN7rgb99WU5z6PtUeLybywGhXpF5QybaehIWsWudZ9HR8hEEmc7pppB+GAA92RDqOOKnRg==`.
- Server API compatibility target: `0.43.1`; no complete live protocol recapture was performed.
- Open Kimi Web release target: `0.43.1-r1`.
- Machine-readable version and historical contract records: `upstream.json`.

The provenance commit comes from the npm provenance attestation for
`@moonshot-ai/kimi-code@0.43.1`. Static inspection of the published bundle
confirmed the title composer, archive and dock selectors, `kimi-locale`, the
archived-session wire shape, and the official permanent-deletion request.
The settings archive page still exposes Restore only, so the local permanent
delete enhancement does not duplicate an official button. Rive now ships as
JavaScript chunks instead of a separate WebAssembly asset; the launcher's
general static-file behavior needs no compatibility change for that update.

During a running turn, the regular `.send` control in official `0.43.1` only
creates a queued prompt. Injecting a specified prompt requires a separate
`POST /api/v1/sessions/{session_id}/prompts:steer` request with its `prompt_id`.
The bundle maps `Ctrl+S` to `steerQueued(0)`, which promotes the existing queue
head. A custom "Send now" control therefore cannot synthesize `Ctrl+S` when it
must steer the newly submitted draft.
This was a static compatibility audit, not a real-browser click-through or live
server protocol validation.

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
`0.43.1` coverage.
