# Upstream tracking

Open Kimi Web serves the official Kimi Code web bundle and adds a small
launcher and presentation layer. It does not maintain a separate frontend
or a vendored transcript implementation.

## Current baseline

- Upstream: [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code).
- Inspected published package version: `0.42.0`.
- Provenance release commit: `6954d2c8bf94a5c7fc29cc6ae35b15d042cc4dcb`.
- Server API compatibility target: `0.42.0`; no complete live protocol recapture was performed.
- Open Kimi Web release target: `0.42.0-r1`.
- Machine-readable version and historical contract records: `upstream.json`.

The provenance commit comes from the npm provenance attestation for
`@moonshot-ai/kimi-code@0.42.0`. The published bundle was also inspected for
the archive selectors, official locale storage, permanent deletion request,
and Rive WebAssembly assets used by this compatibility update.

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
run. The 0.42.0 deletion route was checked separately, but the full artifacts
were not recaptured, so these snapshots do not claim 0.42.0 coverage.
