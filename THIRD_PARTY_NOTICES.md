# Third-Party Notices

Open Kimi Web enhances the official Kimi Code web frontend. The retired
standalone frontend, client package, and vendored transcript package are no
longer included.

## Runtime-served official web bundle

The launcher downloads and caches the prebuilt `dist-web` frontend from
[@moonshot-ai/kimi-code](https://github.com/MoonshotAI/kimi-code) under
`~/.open-kimi-web/official-web/<version>/`. The upstream npm package carries
the MIT License, Copyright (c) Moonshot AI. Its `LICENSE` is retained next to
the cached bundle, and its `boot.js` is preserved.

The launcher applies a title patch and loads this project's separate mobile
presentation stylesheet and script into HTML responses. The mobile assets
adapt the layout while retaining upstream interactions and do not rewrite
the cached upstream assets. The sidebar brand label is changed to `OPEN-KIMI-WEB`; upstream logos and
license notices are retained. The mobile presentation is
informed by the earlier public Kimi Web layout and user-provided references.

Older cached bundles may contain the equivalent official 0.41.0 `boot.js`
with an attribution comment prepended. Existing caches are not deleted by
this source cleanup.

## Runtime dependencies (direct)

- [ws](https://github.com/websockets/ws) — MIT (WebSocket proxy)
- [selfsigned](https://github.com/jfromaniello/selfsigned) — MIT (local HTTPS certificates)

Development dependencies retain their respective licenses; consult their
packages for the full notices. Historical protocol snapshots retained in
`contracts/upstream/` originate from MoonshotAI/kimi-code under the MIT
License. The full MIT text is in [`LICENSE`](LICENSE).
