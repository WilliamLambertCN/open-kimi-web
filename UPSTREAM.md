# Upstream tracking

Open Kimi Web serves the official Kimi Code web bundle and adds a small
launcher and presentation layer. It does not maintain a separate frontend
or a vendored transcript implementation.

## Current baseline

- Upstream: [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code).
- Inspected published package version: `2.4.1`.
- Official release tag commit: `2c73f3f50af4fa7f2540ca0d2e33b07a1408e3a7`.
- Published package integrity:
  `sha512-z0py3AxbV9ykOB3Pgh2FiycZbMy7XSAXH4Kb1yfyhhmk+l9xH8H9raakVvCGMYLVxxEQGitQLcgOh8clLVYUTw==`.
- Official npm runtime: Node `>=22.19.0`. The launcher's own minimum remains Node `>=22.0.0`.
- Server API compatibility target: `2.4.1`; no complete live protocol recapture was performed.
  `protocolBaseline` and the 0.41.0 contracts remain historical; static inspection is not live acceptance.
  Exact npm `2.4.1` backend checks are recorded in the compatibility plan and `liveTestedServerVersions`.
  This is targeted runtime evidence, not a complete protocol recapture or a source-checkout live-test claim.
- Open Kimi Web target: `2.4.1-r1`. Follow [the Release page][current-release] and
  [the 2.4.1 compatibility plan][compat241-plan] for actual backend, browser, CI, package and publication results.
  Unrecorded or pending checks are not passes. [The r2 plan][r2-plan], [r2 Release][r2-release],
  [r1 workspace/release plan][current-plan] and r1 hotfix evidence remain historical, not current acceptance.
  Existing workspace, native trust, session ownership, model confirmation, mobile model, locale, gzip,
  statistics and safe self-update boundaries remain unchanged. No user CLI upgrade or production restart is automatic.
- Machine-readable inspected versions, exact integrity values and historical contracts: `upstream.json`.

## Historical baseline records

- Historical `r8` acceptance, not an r9 or 2.4.1-r1 CI or release result:
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

## Official 2.3.2 through 2.4.1 changes

The [official changelog][official-changelog], [Tower guide][official-tower] and exact tagged source are authoritative.
These are upstream features and policy changes, not new implementations by Open Kimi Web:

- `2.3.2`: do not proactively delegate by default; AgentSwarm requires the user to explicitly enable swarm mode.
- `2.3.3`: adds a Swarm high-usage warning and updates model-switch confirmation; retain native confirmation.
- `2.4.0`: imports recent Claude Code/Codex sessions (15/30-day windows), adds provider refresh and
  `Ctrl-O` thinking-display control. Tower supports per-task models and raises default concurrency from 16 to 256.
  Plan mode requires an explicit user request and plan review before execution. Idle sessions can unload after
  30 minutes and transparently resume; this is not archive/delete. Approval/question flows share interaction frames
  and the formal interactions response API. node-pty and the unused session terminal are removed.
- `2.4.1`: Read defaults to 100,000 characters or approximately 25,000 tokens, whichever limit is reached first;
  `read.max_chars` is configurable. Built-in prompts and repeated reminders are reduced, with Web fixes.

The launcher transparently proxies the official interaction protocol; it does not maintain a conversion layer,
replace idle-session state, or claim these changes for older user-selected backends. Metadata failure now falls back
to official UI `2.4.1`. The actual selected frontend version, including explicit pins, still drives Side Chat injection;
UI >=2.3.0 retains native scrolling, while exact legacy 2.1.1/2.2.0 UI keeps its guard.
Mobile reminder keys are isolated at window capture before native document capture: Escape only closes the reminder,
Tab stays local and Enter/Space preserve default button clicks. Native shortcuts resume after closing; no hidden interaction
response is synthesized. Exact-app request-count evidence and retained driver failures are in the plan.
Reconnection that rebuilds the same pending DOM card may still show another reminder; cross-rebuild deduplication is not claimed.

## Effort presentation and Tower boundaries

Only the presentation of existing choices is ordered:
`none -> minimal -> low -> medium -> high -> xhigh -> max`. Unknown entries remain stable before the final Max;
Auto/Off/On retain each control's native semantics. Do not rewrite `supportEfforts`, add supported values, change the
current selection or official fallback/default derivation, or reorder saved arrays. The r2 new-model defaults below remain.
The reproduced cause was Set insertion order: existing `low, medium, max` followed by appended `high, xhigh`
reaches native pickers in that order. Old tests supplied already-sorted arrays and missed this append path.
Keyboard selection must follow the displayed order, not just a CSS reorder;
current verification belongs in [the plan][compat241-plan].

Tower is not an account/provider entitlement. The Web entry requires `GET /api/v1/meta` to return
`experimental_flags.tower === true`; the experiment defaults off. The per-feature
`KIMI_CODE_EXPERIMENTAL_TOWER` environment override takes precedence over configuration, then the global experimental flag.
The actual backend's inherited environment and `KIMI_CODE_HOME` matter, not a different shell, home or config file.
A session chip additionally requires Tower mode on and a non-Side-Chat composer. No chip does not establish absence;
Side Chat intentionally has no Tower entry.

If a backend starts with Tower off, a live config change to true can expose the entry without assembling the Tower tools:
those tools are assembled at startup. The user must restart the actual backend with the intended environment/home,
not only refresh a page or restart an independent proxy. Follow [the official guide][official-tower]; after choosing to
accept the experimental behavior, the user can set `KIMI_CODE_EXPERIMENTAL_TOWER=true` in the backend's launch environment.
README includes shell examples. The launcher neither forces the flag nor automatically restarts production;
entry visibility and per-session activation remain distinct, and no paid prompt is needed to check visibility.

## Historical 2.3.1 changes and adaptation

The exact [official 2.3.1 Release][official-231-release] and tagged source are authoritative for this patch.
It fixes workspace trust when Git Bash is absent and stale POSIX session ownership after crashes, and improves holder-client
names and retry/takeover dialogs. This does not remove the Windows shell prerequisite or authorize automatic takeover.
Official 2.3.0 introduced cloud-config-controlled model-switch confirmation, Remote Control compression/100 MiB handling,
and archive restoration. These are upstream features, not new launcher features or unconditional confirmation guarantees.
Keep native trust, ownership locks, retry/takeover and model-confirmation flows; do not disable locks or auto-trust workspaces.
The selected `officialWebVersion`, including explicit frontend pins, controls Side Chat compatibility, not the backend version.
At that release, metadata failure fell back to official UI `2.3.1`; old 2.1.1/2.2.0 UI kept its scroll guard.

Official 2.3.1 previews PNG/JPG/GIF/WEBP/BMP/ICO/AVIF and PDF using authenticated download/Blob paths.
SVG and older UIs can still use `fs:read`, so `imagePreviewGuard.js` remains. Its 32 MiB limit applies only to the enhanced
truncated-base64 fallback, not all native 2.3.1 previews. Partial reads and unrelated requests retain official behavior.
Historical r1 source and runtime checks passed dual-device workspace submission, native trust confirmation
and restart persistence,
plus exact-2.3.1 cron read-only enforcement and isolated official npm installation/CLI/PTY/authenticated Web checks.
The complete official app passed functional assertions with fictional REST/WS; this is not all-visual acceptance.
Mobile preview opacity, subagent wording and mobile workspace identity/locale fixes passed focused browser/visual checks.
Original and affected atmosphere themes retain native preview geometry; trust/retry/takeover/model dialogs remain reachable.
Standard lint/typecheck/UT/pack and a standalone standard IT run passed with unchanged 70% line/branch gates.
The initial concurrent UT/IT/pack run had four IT timeouts; targeted single-worker and independent standard IT passed unchanged.
Counts, coverage, retained first-failure logs and physical-device/platform limits are in [the r1 plan][current-plan].
These remain r1 evidence; each later release requires its own CI and publication records, not local or historical checks.

## Historical provider defaults and release 2.3.1-r2

The user explicitly requested r2 for normal updates and restored new-model defaults under [the r2 plan][r2-plan].
Only `video_in` and `image_out` default to unchecked. `image_in`, `tool_use`, `thinking` and `always_thinking` default to checked,
as do all six efforts (`none`, `low`, `medium`, `high`, `xhigh`, `max`) and `adaptive_thinking`.
Display and POST/PUT/save-reopen behavior must agree. Existing explicit arrays, including empty arrays, unknown values and false
must not be automatically rewritten. Retain r1's discovery/select controls, unique-visible-form scope, row identity checks
and independently edited-field metadata merging; ambiguous or unmatched forms must retain native behavior.

These defaults express user preference, not service capability. Prior authorized environment-key checks completed with low,
reproduced HTTP 400 with xhigh and completed after the fix with thinking:on without an explicit effort.
Medium/high/max were not individually tested. No new paid calls, real-user configuration access or production changes
are in scope.
Actual r2 acceptance and publication are recorded in its plan; r1 tests, CI and online checks do not establish r2 results.
After formal r2 publication, existing r1 installations use normal `update --check`/`update`, then manual restart and page refresh.
Source updates still require a clean main tracking origin/main and a fast-forward. Publication must create a new tag/Release,
without moving r1 or replacing its assets. Historical same-r1 reinstall instructions below apply only to that republication.

## Provider discovery hotfix for 2.3.1-r1

The exact official 2.3.1 model field uses `div.pf-label`, including a model count and its native fetch button.
The previous label-only field lookup prevented the enhanced discovery/select/add controls from mounting.
The native fetch button appends all returned model IDs to the draft; it is not the enhanced selective picker.
The compatibility fix accepts both semantic heading forms and adds a localized accessible name for the candidate select.
Native rows, bulk fetch and formal provider POST/PUT saving remain upstream-owned; discovery alone does not save configuration.
Focused complete-app QA also reproduced a hidden preset/manual save-scope error. The old enhancement declared every capability
and six effort levels for unknown models and wrote them back even when untouched, rather than preserving native metadata.
Authorized environment-key tests confirmed direct Coding HTTP 200 and unmodified 2.3.1 completion with low effort;
changing only the declared effort to xhigh with the same old enhanced metadata reproduced `400 Invalid request Error`.
This establishes a reproducible unsupported-parameter failure, not proof of the user's unread production configuration.
Existing persisted metadata requires explicit correction; a package replacement must not silently rewrite user configuration.
Old tests used the earlier label shape and missed this regression. Exact DOM tests and focused complete-app checks are tracked in
[the hotfix and same-r1 republication plan](docs/plans/provider-model-discovery-r1-hotfix-v1-plan.md).

The user authorized replacing only v2.3.1-r1 using an exact old-tip lease, not rewriting shared branch history or other releases.
Initial-publication hashes and acceptance above remain historical. The updater compares npm versions and skips equal versions;
existing one-click users must rerun their matching installer with the same home, while manual npm users must replace their actual
installation from the refreshed package. Source users can fast-forward their clean main checkout. Restart remains manual.

The hotfix is published at the same r1 Release. [PR #31](https://github.com/WilliamLambertCN/open-kimi-web/pull/31) and
[main CI](https://github.com/WilliamLambertCN/open-kimi-web/actions/runs/40299735039) passed the unchanged standard gates.
The tag now points to `5b626e3fa94c5016c0c8d6d3ff248ed514b491ca`; refreshed asset 677671621 has 131 files and 8,414,834 bytes.
Online tgz bytes, immutable installer entries and the real latest-release lookup match the verified release.
Focused save/reopen, default metadata and rename checks plus their retained driver failure are recorded in the hotfix plan.
These checks do not establish physical-phone, all-platform installation or unread production-configuration acceptance.

## Unified navigation and search

Navigation, mobile official-index search and Hyper-V fixes shipped in [the historical r1 scope][current-plan].
Earlier implementation evidence remains in [the scheduled-task/navigation plan](docs/plans/scheduled-tasks-management-v1-plan.md).
Desktop and mobile use the same upper-left action order: new session, new workspace, scheduled tasks, search and usage.
Both search controls call the official paginated `/api/v1/search` index.
Results open the owning session, not a claimed turn anchor.
Both workspace controls use the same existing-directory form and official API without leaving the current session or draft.
Input is trimmed and one matching pair of outer quotes is removed. Paths name existing absolute directories on the Kimi host,
not browser-local folders; the launcher neither creates directories nor grants trust.

The version-limited task panel lists original sessions, saved tasks and recorded trigger history. Exact 2.1.1/2.2.0 retains
native create/remove after explicit restoration and confirmation. It keeps the original home and backend without another engine,
live-log edits or an AI CRUD proxy. The modified-backend experiment and its dedicated-data chain remain withdrawn.
Managed `kimi web --scheduled-tasks` explicitly opts in; ordinary startup remains disabled. External `serve --target`
does not expose this capability. Exact 2.3.1 and 2.4.1 only support read-only tasks/history; WRITE remains exact 2.1.1/2.2.0.
Unknown versions, including unlisted adjacent versions, reject. The inspected 2.4.1 cron/debug core matches 2.3.1;
this does not authorize writes. Historical 2.3.1 dual-backend QA found that a formal prompt returns HTTP 200/code 40931
while another process holds the session lock. Direct debug cron add/remove/flush instead returns code 0 with initially
memory-only changes. Normal close of backend B can persist pending changes while A still holds the lock;
direct debug can also persist after the stale gate returns 40932. No atomic management entry guarantees ownership,
freshness and a durable receipt together; code 0 is not such a guarantee.
The implemented transport and route gates reject read-only-version create/remove before debug mutation.
The UI shows English/Chinese read-only reasons, hides restore/new and disables remove;
read-only browsing never wakes a cold session.
Historical exact-2.3.1 tests and real createLauncher QA passed: read=true/write=false, create/remove 409 read-only-version
with no mutation or outcomeUnknown; the session stayed cold and wire bytes were identical. Raw # RC GET/POST returned 404
without upstream calls. Users may still explicitly open the original session. Those results remain in [the r1 plan][current-plan];
current exact-2.4.1 backend/UI verification, CI and publication must be established in [the 2.4.1 plan][compat241-plan].
Canonical and encoded debug paths are blocked before proxy dispatch; opt-in also blocks the whole Remote Control namespace.
Native RC connects directly to the origin, so it cannot run with this mode. State checks and unsafe shutdown are fail-closed
protection, not an atomic cross-process lock or a sandbox against authorized host execution. Real relay isolation is untested.

Inventory pages use the formal v2 index plus bounded read-only main wire projection; history uses real origin/turn events
and separately identified server submissions. Cold browsing does not restore sessions. Missing, damaged, changed or limited
records remain explicitly incomplete; recent history is limited to 100 entries and has no pagination. Initial cold reads
still scan journal bytes; there is no task index or durable cache. Models show live/saved session aliases and exact historical
request models where available, not an independent per-task setting. Native completed turns do not prove business success.
Native cron edit, pause/resume and independent cron task-model settings are not implemented or simulated through delete/recreate.
Tower per-task model support does not add those cron capabilities.

Final public-protocol QA used actual superviseWeb/registry/token/guard/frontend with isolated homes for both versions:
20+2 real paginated sessions including archived entries, cold reads, explicit restore, CRUD and same task ID after close/restore.
Both shut down normally with zero model calls and no process/listener leaks. Only the spawn port was substituted to avoid
production. The 2.2.0 backend used the 2.1.1 static UI; complete 2.2.0 UI, migration/fork, physical devices and other platforms
are not covered. Runtime RC failure uses targeted UT/TCP IT, not a real RC enablement test. Those historical UI and standard
results remain in the earlier plan. The current release authorization supersedes that stage's no-publication restriction,
not its version limits. Production restart, old release/tag/asset deletion and upgrades of users' actual Kimi remain out of scope.

Address advertising and certificate SAN enumeration now retain Hyper-V/vEthernet adapters while keeping existing
internal, loopback, IPv6 link-local and other virtual-adapter filters. This does not change operating-system networking.

## Compatibility-first installation

The `2.4.1-r1` installation target prepares fixed official Kimi `2.4.1` only when discovery confirms no usable
installation exists. An explicit reuse message distinguishes official Kimi from the installer source, Node runtime and
launcher Release; reuse does not download or upgrade that official CLI, although launcher/runtime downloads may be needed.
Broken, unsupported or ambiguous candidates are errors, not missing installations that authorize another download.
Historical r10/r1/r2 results remain in [the installation plan](docs/plans/one-click-install-v1-plan.md),
[the r10 record][r10-plan], [the r1 plan][current-plan] and [the r2 plan][r2-plan].
Current real-entry, runtime, CI and asset results belong only to [the 2.4.1 plan][compat241-plan].

The README starts with two online commands for Windows PowerShell >=5.1 and macOS/Linux sh, for use after publication.
They resolve `v2.4.1-r1` through GitHub's commit API, validate its full 40-hex SHA and download the thin entry at that SHA.
Only a successful download is executed, with the same `--revision` and fixed `--version 2.4.1-r1`.
Missing tags, invalid SHAs or failed downloads stop without version fallback; the raw entry never uses a mutable tag or main URL.
PowerShell uses a script block and sh uses `sh -c`; there is no streamed curl pipe or manual script download.
The entry downloads the complete coordinator/helpers from that same immutable revision. HTTPS is not signature verification.
No future SHA is invented. Historical r10 pinned `97160c92d3c5d4dcbe97c4b07cfb83aa11f66eaf` and launcher `2.1.1-r10`;
initial r1 publication used `c9a3e0ce2a71037f510d794303e84ce6bed69209`. Neither supplies this release's source or acceptance.
The same-r1 republication and r2 evidence remain historical; old tags and assets are not moved or replaced.

A complete matching local checkout can use its adjacent `scripts/install.mjs` and `scripts/install/` helpers.
Both entries consume `--revision` themselves to select the complete immutable archive; it is not forwarded to the coordinator.
A standalone entry without a revision resolves main once, which does not establish matching thin-entry provenance.
These entries install a formal GitHub Release tgz, not development dependencies, without requiring preinstalled Node, npm,
Corepack, pnpm, Git or official Kimi. Network access and standard PATH curl/tar remain prerequisites.
Prefer Node >=22.19.0 with adjacent npm; otherwise SHA-256 check fixed official Node `22.23.3` before extraction into
`runtime/node-v22.23.3-<platform>`. The executable is `node.exe` on Windows and `bin/node` on POSIX.
Custom OPEN_KIMI_WEB_HOME must be absolute and unlinked. Its `official` prefix is separate from launcher `npm`, runtime and bin.

Discovery preserves explicit override/registered-integration priority and normal PATH order. Additional bounded candidates
include official default bin locations, `KIMI_INSTALL_DIR/bin`, uv/XDG/default local bin locations, Windows APPDATA/npm,
read-only persisted Machine/User PATH and standard commands beside the selected Node. Windows HOME and USERPROFILE default
bins are both considered and deduplicated, without inventing priority. This is not an unbounded disk scan.
Boundedly recognized standard legacy POSIX Python/uv console entries still require real version and Web capability probes;
a matching module-name substring alone is not sufficient. Unknown scripts and wrappers remain rejected.
Candidates with no unambiguous priority require an explicit override; unknown PowerShell functions, scripts and argument-taking
wrappers are not executed as guessed CLI commands. Discovery does not modify persisted PATH to search it.
Working supported native/npm/recognized legacy console installations are reused without overwrite. Only confirmed absence
prepares the verified `@moonshot-ai/kimi-code@2.4.1` tarball with fixed SHA-512 integrity.
Exact owned 2.3.1 and 2.1.1 remain reusable only with their
known version/integrity, package identity and unchanged entry/shim digests. Altered ownership records and partial installs reject.
Default ignore-scripts avoids official postinstall migration of old Python commands. Unowned dedicated prefixes are not resumed.
Windows canonical npm shims validate JS targets for selected-Node checks and retain the cmd-aware runtime/takeover path;
Windows PATH environment keys are normalized. CLI/Web health alone does not validate shell readiness.

Official 2.4.1 has no node-pty dependency. Its exact supported npm identity requires a real Node `child_process` shell probe,
not a missing-PTY success assumption or reintroduction of node-pty. Legacy owned 2.3.1/2.1.1 still require real PTY probes.
Ownership is recorded only after the appropriate probe succeeds; repeats probe again, and damaged owned installations reject
without automatic rebuild. Non-owned native/npm installs are not rebuilt. Linux Python 3, C/C++ and make requirements apply
only to an audited legacy rebuild, not unconditionally to new 2.4.1 installs. The legacy rebuild audits fixed node-pty 1.1.0
and node-addon-api 7.1.1, scopes npm rebuild to the absolute node-pty directory, and does not run root migration or other scripts.
It audits noexcept.gypi and filters MAKE-prefix/FLAGS controls. No sudo/apt or automatic full toolchain preparation is attempted.
Legacy Linux uses forkpty; spawn-helper is a macOS build target.
Historical missing-make failures do not establish a 2.4.1 failure.

Official Kimi still requires Git Bash on Windows. Existing working Git Bash is reused; only absence prepares strictly verified
user-directory portable Git without replacing system Git. The SFX preserves the executable module and 7z payload and replaces
only its configuration with `RunProgram=usr\bin\true.exe`; default git-bash.exe/post-install.bat do not run.
Audited allowlisted initialization follows explicitly. Unknown KIMI_SHELL_PATH rejects. Historical portable-Git artifact QA
and the full missing-Git coordinator are separate, not combined acceptance for this version.
No administrator/sudo, login, real-session access or model calls are required. No production service starts automatically.
Release assets retain matching SHA-256 checks. Actual platform checks and limits remain in the current plan;
this is not an all-platform claim.

PowerShell forwards the coordinator's double-dash options unchanged, for example:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 --version 2.4.1-r1 --no-integrate
```

`--version` selects the formal launcher Release, not the script revision or official Kimi version.
`--no-integrate` installs the package without establishing, changing or removing takeover.
`--switch-installation` opts into switching a recognized source/prefix, without deleting it; unknown/partial
integration and version downgrade still reject. Existing users should normally use the launcher's `update`.
Both thin entries handle `--help`, including a valid optional revision, before bootstrap: no Node, network or install writes.
Invalid arguments also fail before runtime preparation. Coordinator `--help` only prints usage.
Wrapper ownership and persistent PATH must be checked, not inferred from package installation or status exit alone.
The installer verifies the actual shell rc independently. r9 status still diagnoses the first existing rc and may warn
incorrectly for zsh with multiple rc files; verify the target and real new-shell commands before repairing or switching.
Bash preflight checks `.bash_profile` first, or `.bash_login` only if the former is absent, before Release/npm work.
The existing profile must contain only blank lines, full-line comments and unconditional `source` or `.` lines loading `.bashrc`.
Accepted targets are `~/.bashrc`, `"$HOME/.bashrc"` or `"${HOME}/.bashrc"`. The profile is preserved, never rewritten.
Empty, comment-only, conditional or unknown complex profiles reject; use `--no-integrate` or arrange manual sourcing and retry.
This rejection never reports successful takeover. Native WSL bash `--login -ic` passed with a supported source-only profile.
Unsupported shell persistence or System PATH shadowing must be reported without claiming integration succeeded.
An installed wrapper may use its recorded private Node even if the shell's `node` command is absent or outdated.
On Windows, the installer's private Node User PATH entry remains after r9 integrate uninstall; remove it manually when unused.
Uninstalling takeover does not remove the private runtime or dedicated npm prefix, official Kimi or other installations.
The dedicated prefix retains standard npm-global identity for `update`; the updater searches adjacent npm before PATH.
Package-only users must execute that prefix's launcher with the selected absolute Node path, rather than a bare node,
default npm root or an older PATH command. The installer prints absolute Node/launcher commands, with `&` for PowerShell.
Regular upgrades do not require rerunning the installer or switching locations.

Previous acceptance covers the old scope only: real Node 22.23.3 download/digest checks and r9 package-only installation on
native Windows x64 PowerShell 5.1 and WSL Ubuntu 22.04 x64 glibc, plus Linux bash/zsh takeover, new shells, repeat and uninstall.
Official Kimi was a fixture; Windows takeover used User PATH mocks. This is not new official-npm or portable-Git acceptance.
The first Windows installation lacked a raw User PATH baseline, so full raw before/after equality is not claimed.
Machine PATH was unchanged and no QA path was persisted. macOS/arm64 and real Windows registry/new-shell takeover
remain unverified. The older standard suite and IT gate closure remain in the installation plan; coverage keeps its 70% gates.
New-scope stage evidence is recorded separately: real official 2.1.1 installation and actual r9 wrappers on Windows x64 and
native WSL Ubuntu 22.04 x64 passed CLI/Web health checks. Windows takeover uses registry seams, not real registry/new terminals.
Windows real Git Bash PTY and x64 portable QA passed. The early unchanged Linux ignore-scripts install lacked a native binding
and failed real PTY; a verified same-version native fallback also failed with missing pty.node. These failures remain historical.
The audited targeted rebuild now passes actual PTY with existing standard tools, not on tool-free Linux.
Read `.cache/one-click-official-qa/pty-rebuild-real-report.json`: Node 22.23.3, real preparation/rebuild, PTY, Web, record, owned
reuse and cleanup all passed in existing Docker golang 1.26 bookworm tools. This helper QA is not a complete r9 coordinator rerun.
Windows actual PTY and repeated ownership-loss rejection IT passed.
The historical `.cache/one-click-official-qa/final-scenario-report.json` separately records full actual entry scenarios:
Windows x64 installed verified official 2.1.1 and online r9, exercised actual cmd wrappers/managed Web, reuse and uninstall.
User/Machine raw PATH byte-value equality passed; integration still uses registry seams, not persistent real-registry takeover.
Linux x64 in existing golang 1.26 bookworm tools passed full paired sh/r9, audited rebuild, real PTY, new login bash,
actual wrapper/managed Web, reuse and uninstall. Bare WSL exits 1 for missing make; C++ is also absent, so full did not pass.
Portable Git artifact QA and full Windows coordinator QA are separate, not a combined missing-Git scenario.
The review fix audits noexcept.gypi and filters all MAKE-prefix and FLAGS build controls.
The pty-review-boundary report passes real audit/tamper/missing/link rejection and GNU make isolation;
this narrow check uses simulated PTY state, not a new full PTY/coordinator run. Empty-Linux delivery remains unresolved.
The expanded2 suite is historical. Final3 lint/typecheck/UT/IT/pack passed after the PTY/UI/i18n edits, without lowering
70% coverage gates; results are centralized in [the install plan](docs/plans/one-click-install-v1-plan.md).
The local r9 pack is not a release and excludes root installer scripts. Git Bash is not native POSIX or macOS acceptance.

## Mobile subagent model and locale (r10)

Follow [the mobile subagent model plan](docs/plans/mobile-subagent-model-v1-plan.md), including the mixed-language request.
The independent API/View/control/CSS are included in r10.
Existing source, complete-app and standard checks are retained without repetition, not across all platforms;
publication and asset verification follow the actual records in [the release plan][r10-plan].
The exact official 2.1.1 MobileSettingsSheet lacks Subagent fields and has no confirmed public action opening full Settings.
The control reads official config/models and POSTs only `secondary_model` to `/api/v1/config`, merging the existing model pool.
Main model, permissions and other configuration are preserved, without Vue private state, breakpoint tricks or localStorage.
Auto legitimately submits `defaultEffort: ''`, following global thinking settings/model default. A configured model still
cannot be cleared to follow-main through this API: empty/null models are invalid and omitted merge fields do not clear values.
The new UI follows official ModelPicker semantics: a bottom sheet, search, provider chips, two-line model rows/check marks
and segmented thinking controls, with identity details collapsed by default rather than numbered native selects.
Official 2.1.1 does not export ModelPicker or a secondary-target mount action; scoped declarations/tokens are reused,
not a private Vue instance or a temporary main-model write. Same-provider/name collisions show a front-loaded unique
fragment of the real alias while saving its full value. Segmented density now matches official Settings.
The 64 targeted UT and followup complete-app 199/199 assertions passed, with 23 images; the parent inspected seven.
Seven appearance samples cover 320/390/640. Standard lint/typecheck/1430 UT/308 IT/pack passed, with two native POSIX
IT tests skipped on Windows. These are local checks, not publication, physical-phone or delivery-package UI acceptance.
The old native-select focused 108 assertions/28 images and explicit Auto/pool/readback checks remain historical evidence,
not acceptance of the replacement UI. Their representative screenshots were inspected before this replacement.
The earlier full command failed in its harness after 98 passing assertions, followed by a 51-pass interaction supplement;
retain those and the earlier seven-theme matrix as history, not a current all-theme rerun.
Physical phones/disk persistence remain unverified. The 108 focused assertions do not cover dynamic subagent locale switching.

Shared locale now follows official kimi-locale, with navigator fallback, rather than treating root lang as authoritative.
Fixed bilingual theme labels, mounted-copy staleness and Chinese-only usage copy are corrected for English mode;
themes/presentation/session/usage/provider and related enhancement system text/title/aria/placeholder use English.
Chinese user model/provider content is preserved. Shared same-tab refresh preserves input/drafts without new backend requests.
Exact official-app locale QA passed 41 assertions/25 images plus provider 2 assertions/1 image using fictional REST/WS.
The parent inspected 320 Original and 390 Nocturne English theme images. Earlier scoped checks passed 13 files/176 UT,
5 asset IT, lint and typecheck. Subagent native same-tab language switches now verify copy, drafts, errors/readback and no extra
requests. The bare-official comparison confirms no visual-anchor regression, without a product patch; the original six
strict absolute-scrollTop failures remain unchanged, not an all-pass report. Details are in the mobile plan;
final standard counts/coverage/pack are in the install plan.
Neither complete English/all-platform acceptance nor publication is inferred from these results.

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

The historical `@moonshot-ai/kimi-code@2.1.1` tag resolved to
[`f67e6398`](https://github.com/MoonshotAI/kimi-code/commit/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f);
its integrity came from npm package metadata. Static inspection of the
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
server, falling back to `2.4.1` when metadata is unavailable. The selected frontend version drives compatibility injection.
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
`0.43.1`, `2.0.2`, `2.1.1`, `2.3.1` or `2.4.1` coverage.

[lan-plan]: docs/plans/large-session-lan-performance-v1-plan.md
[r10-plan]: docs/plans/one-click-install-r10-release-v1-plan.md
[r10-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.1.1-r10
[current-plan]: docs/plans/kimi-code-2.3.1-workspace-release-v1-plan.md
[r2-plan]: docs/plans/provider-defaults-r2-release-v1-plan.md
[r2-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.3.1-r2
[compat241-plan]: docs/plans/kimi-code-2.4.1-compatibility-v1-plan.md
[current-release]: https://github.com/WilliamLambertCN/open-kimi-web/releases/tag/v2.4.1-r1
[official-231-release]: https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai/kimi-code%402.3.1
[official-changelog]: https://www.kimi.com/code/docs/en/kimi-code-cli/release-notes/changelog.html
[official-tower]: https://www.kimi.com/code/docs/en/kimi-code-cli/guides/tower.html
