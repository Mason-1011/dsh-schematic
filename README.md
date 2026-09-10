# dsh-schematic

> Read — and rewrite — the wiring of your DeepSeek Harness.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-schematic.svg)](https://www.npmjs.com/package/dsh-schematic)
[![CI](https://github.com/Mason-1011/dsh-schematic/actions/workflows/ci.yml/badge.svg)](https://github.com/Mason-1011/dsh-schematic/actions/workflows/ci.yml)
[![Built for](https://img.shields.io/badge/built%20for-DeepSeek%20Harness-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)

**English** | [简体中文](README.zh.md)

See which plugin provides each service, handles each runtime event, and consumes the time behind a DeepSeek Harness turn — then edit that wiring on the graph itself.

```sh
dsh plugin --profile web add dsh-schematic
```

![dsh-schematic: inspect the live topology, find a plugin, and turn the graph into an editor](docs/assets/dsh-schematic-demo.gif)

## Status

**v0.5.0 is available now.** `/schematic` is a full-screen System / Blueprints / Activity application. Blueprints have a capability-grouped editor, local drafts, safe switching, and an explicit switch for mounting Schematic itself; activity bursts are coalesced so host churn stays readable.

## What this is

DeepSeek Harness (dsh) composes an entire agent product from plugins: every capability — the model adapter, the tool registry, the agent loop itself — mounts onto a shared Cordis context through services, `inject` dependencies, typed events, and reversible effects.

That wiring only exists inside the running process. `dsh-schematic` draws it.

- **Topology view** — an interactive wiring diagram of the mounted plugins: who provides `ctx.fs`, who injects it, which events flow between them, where each capability seam sits. Rendered from the loader's own plugin tree.
- **Composition workbench** (v0.3.0) — edit the wiring **on the graph itself**: toggle plugins, edit an entry's config, swap a seam's provider (local → sandbox → remote). Every change is previewed as ghost nodes plus a YAML diff, dry-run through the same composition the boot performs, backed up, and applied through the harness's own hot reload — reversible with one click.
- **Blueprint workbench** — save the wiring you like as a named blueprint and switch the whole optional layer in one previewed batch. A blueprint is a positive member list, not a tree snapshot, so it survives harness upgrades; switching is materialization against the live tree (the same ops the workbench speaks, through the same preview → Apply drawer). Protected core plugins are not governed except for the blueprint-level Schematic mount switch, and post-save newcomers require an explicit decision. Blueprints export/import as YAML — a shareable recipe — and blueprint save/list/switch are also available to dsh's model as tools.
- **Seam-aware market** *(planned)* — the supply side of the graph: click an empty seam and see the plugins that can fill it, with conflicts surfaced before install.

## Features

Shipped so far (details per version in the [changelog](CHANGELOG.md)):

**Topology viewer** — served at `/schematic` once mounted.
- Three tabs: **journey** (one message's path through the runtime as stage cards with the ctx keys exchanged), **domains** (radial mesh; family/cluster/core-spine cards open into scope views; group scatter with ⊕ and expand-all; edges drawn provider → consumer with hover cards), **table**.
- Live refresh every 5 s with a change toast; new plugins pulse; `?tab=` and `?expand=all` deep links.
- Failures surface at the unit level: a FAILED internal child fiber fails the entry's whole unit on the graph (with the clipped reason in its panel), and recovery clears it at the next settle.
- One-click EN ⇄ 中文 whole-page switch — descriptions machine-translated in-process, identifiers kept in English. The 中文 side needs a working model route: when it is unavailable the switch says so instead of silently staying English (no model route mounted, no API key stored for the route, or the route's own error — the last one verbatim), and clicking that notice opens the settings popover to pick another route the harness already knows and store its key (the key goes to the host's own credential store — the same place the Models page writes — never into plugin config, never echoed back). Saving a key probes it with one real translation call; there is deliberately no "test key" button, because model discovery answers catalog routes from its built-in registry and would pass a bogus key.

**Runtime activity** — watch the work flow.
- Every turn, model reply, tool call, workflow run, registry change, host action, background job, and service read is attributed to its owning plugin; the graph lights up while the work flows through it (strong glow during tool runs and model streaming, breathing decay after) and a collapsible timeline names who did what, when, and how long it took. A burst of identical registry events folds into one counting row ("tools/change ×N") — even under a host-side event storm the timeline stays readable, and the bystander never amplifies the storm itself (the attribution rebuild rides a trailing debounce).
- **Structure changes are events too** (v0.3.1) — a plugin mounted or unmounted, a seam's provider swapped, a key falling unresolved, a unit flipping into or out of failure: each settled structural change lands as a timeline row and a journal record, so "what did the wiring do when I applied that" stays answerable after the fact.
- A session selector defaults to following the chat you are looking at; subagent/background filtering included.
- **Replay** — the timeline's replay toggle pages back through the session's durable log (over the host's own read-only history RPC), re-attributing each event through the same live fold and merging the journal's live-only rows: who did what from before the viewer was ever open.
- **Stats** — a per-plugin monitoring table over this instance's live window: rows, tool calls and failures, tool time (sum + max), LLM completions, and what each plugin has in flight right now.

**Composer-side star map** — a miniature of the expanded mesh floating beside the chat input.
- One star per package in a deterministic force-relaxed galaxy, with a sparse curved gravity skeleton instead of the full edge hairball. Hover reveals that package's one-hop constellation.
- Real service access lights the exact consumer → provider lane, sends one photon along it, then leaves a short frequency-weighted afterglow; events without a trustworthy second endpoint light only their owning star.
- Free placement (drag anywhere, re-docks beside the card), free resizing (viewport is the only ceiling), theme-aware glass sky with a live opacity dial (mouse wheel or Settings).

**Composition workbench** (v0.3.0) — the ✎ toggle in the header, **off by default**: off, the page is exactly the read-only viewer; on, the graph becomes the editor.
- **Preview everything first.** Queued edits render as ghosts on the graph (strikethrough + fade for what goes, dashed + `?` for what arrives), the drawer shows a per-entry diff, the exact managed-block YAML before/after as a line diff, and structure-aware warnings (a service key losing its only provider, a config field your edit drops, a `!!js` expression that a whole-config replace would freeze into a literal).
- **Dry-run before write.** Every apply re-runs the same offline composition the harness boot performs; invalid batches are refused (422) and nothing touches the file. Duplicate entry ids are rejected at plan time — the loader would refuse the whole tree.
- **Toggle & config.** A plugin's detail panel gains its source layer, a protection badge, an enable/disable switch, and an inline config editor prefilled with the entry's current YAML (dropped fields are named; `!!js` values warn before a replace freezes them).
- **Swap providers per seam.** A cluster card lists every registered provider of the seam and the alternatives (in-tree, installed, or catalog) — swapping disables the old and inserts the new in one batch. For packages that are not installed, the install command is offered as copyable text (v0.3.0 does not install for you).
- **Applied safely.** Writes go only to a versioned managed block inside the profile's `cordis.patch.yml` (bytes outside it are preserved verbatim); each apply first takes a timestamped full-file backup and refuses to clobber if the file changed under it (409). The harness hot-reloads the file in ~1–2 s; a reload the harness rejects keeps the old tree running, raises a banner with the error, and offers one-click rollback. Disabling schematic itself is danger-tier: it needs the entry id typed in, and the banner carries the manual-recovery steps.
- **Clear** drops every schematic-made change in one action (the whole managed block, markers included), restoring the file byte-for-byte.

**Blueprint workspace** — one of the app's three primary spaces, alongside System and Activity. Its three columns are the blueprint library, a capability-grouped member/config editor, and the pending changeset.
- **Save, switch, share.** Start from the running system, an existing blueprint, or protected core only. Simple scalar and nested config fields get forms; arrays, `!!js`, and unusual mappings remain editable as YAML. Drafts stay local per profile and blueprint until Save. Import works by picker or drag-and-drop; export is plain YAML. Files live under `~/.dsh/schematic/blueprints/`.
- **Desktop writes, mobile reads.** Below 768 px the system, blueprints, and activity remain browsable, while every mutation is disabled with an explanation.
- **Switching is materialization, not restoration.** Switching diffs the blueprint against the live tree and queues one batch of the same ops the workbench speaks — disable enabled non-members, enable/insert members, refresh drifted member configs — into the same preview drawer. Nothing writes without the drawer's Apply, and the whole write path (backup, staleness check, hot reload, rollback) is exactly the one every other edit uses.
- **Honest edges.** Protected core plugins never join a blueprint and are never disabled by a switch, except for the dedicated Schematic mount switch. Entries that appeared after a save require an explicit keep/disable/adopt decision. Member ids now bound to a different package are reported and left alone. A missing package refuses the whole batch with the install command.
- **Divergence is an empty materialization.** compose.json carries a `blueprint` field computed by the same rule: zero ops ⇔ the tree is on the blueprint. The chip accents the moment the tree drifts; a successful Apply moves the current-blueprint pointer with the tree, and any manual op queued after a materialization cancels the attribution.

**Opened to dsh's model** (v0.4.1) — four `schematic_*` tools on the host's tool registry, so a user can have a conversation do the curation:
- `schematic_plugins` lists the full composition tree (`{id, package, disabled, protected, provides, inject}`) — the ground the model picks members from; `schematic_blueprint_list` lists blueprints plus the current pointer's divergence.
- `schematic_blueprint_save` `{name, desc?, memberIds?}` is the same implementation as the page's save (no `memberIds` = capture current); `schematic_blueprint_switch` `{id?|name?}` runs the exact pipeline the browser's Apply runs (materialize → preview → base freeze → backup → atomic write → hot reload) and then watches the reload outcome for ~3 s — if the harness rejects the reload, the previous tree keeps running and the result carries the reason and the rollback path.
- The stance is the `schematic` ctx service's: a capability, not an observation edge — calls attribute to this plugin through the host's existing activity system. Deletion is deliberately not offered, and with `config.edit.enabled=false` none of the four register.

**dsh integration**
- A Settings → *Plugin topology* section (custom Steam-style three-node nav icon) that opens the viewer in a new tab and exposes the backdrop slider.
- *Ask in chat* hand-off: from the viewer, send "explain this plugin" into a fresh Ungrouped conversation — the first question is sent for you through the RPC gateway.

### What it writes — and what it never touches

All observation remains read-only by construction: the plugin never writes to session logs (no custom event types), never wraps or intercepts service return values, and adds no topology edges for its own observers. It does provide one real ctx service — `schematic`, handing out the same live graph the viewer renders (`ctx.schematic.graph()`). That is a capability, not an observation edge: a consumer that injects it shows up on the graph, honestly, as wired to the viewer.

The workbench (v0.3.0) writes exactly two things, both in plainly named places:
- the **managed block** inside the profile's `cordis.patch.yml` — the rows between `# >>> dsh-schematic v1` and `# <<< dsh-schematic v1`; every byte outside those markers is preserved verbatim, and the block is never written without a full-file timestamped backup taken first;
- the plugin's own files under `~/.dsh/schematic/` — the observation journal, those patch backups, and (v0.4.0) the blueprint files plus their `.current.json` pointer under `blueprints/`.

It never writes session logs, the manifest, bundle layers, `dsh.profile.bundles`, or the profile root `cordis.yml` (the `dsh plugin` command's territory). Composition editing is off by default and can be killed entirely from the plugin's own config (`config.edit.enabled=false`); every workbench write rides the harness's own patch-file hot reload, so a rejected reload keeps the old tree running and one click rolls the file back.

## Why nobody else covers this layer

| Layer | Projects | What they show |
|---|---|---|
| Config | [dsh-blueprint](https://www.npmjs.com/package/dsh-blueprint) | booted config + overlay validation; since its v0.6.0 also writes a managed-block overlay |
| Market | [zat-dsh-engine](https://github.com/mishibeikejie/zat-dsh-engine), [dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) | install / manage plugins |
| Session | [dsh-synapse](https://github.com/liangmianya/dsh-synapse), dsh-flowglass | conversation canvases, tool-call flows |
| **Topology** | **dsh-schematic** | **how plugins wire together — and structure-aware editing of that wiring on the live graph** |

Toggling plugins and writing managed-block overlays are solved problems; what nobody else does is treat the graph as the editor — swap a seam's provider where you can see both ends, with ghost previews and a dry-run composition before anything is written.

dsh runs on Cordis, and the Cordis paper [*A Programming Paradigm for Spatiotemporal Composability*](https://github.com/cordiverse/paper) proves a resting-state theorem: no matter how a system rewires itself at runtime, its settled state always equals some one-shot static assembly. dsh-schematic is the UI for that theorem — it renders the static equivalent of whatever the running system currently is.

The agent already has its own "creative mode" (self-modification tools that inspect and remount plugins mid-run). dsh-schematic is the same capability, for the human.

## Non-goals

- Not another generic marketplace, and not an installer — installation rides on the official `dsh plugin` command; a missing package is named with its install command, and the market (planned) will be the supply panel of the graph.
- Not a ComfyUI-style dataflow canvas — dsh composition is sockets-and-wires dependency injection, not dataflow; a node canvas would be the wrong metaphor.
- Not a conversation-replay canvas — the timeline's replay is plugin attribution ("who did what"), not a way to read conversations; message-level replay belongs to dsh-synapse and dsh-flowglass.

## Requirements

| Component | Supported |
|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `>=0.1.0-rc.8` (verified through `0.1.1-rc.2`), web profile |
| `@deepseek-ai/cordis` | `^4.0.1` |
| `@deepseek-ai/cordis-plugin-include` | `^1.0.6` |
| Browser | Current Chromium, Firefox, or Safari (`light-dark()`, `EventSource`) |
| Node.js | `>=22.19` with npm, only when building from source; CI covers Node 22 and 24 |

## Install

Published on npm. The package declares itself as a dsh bundle, so installing it also registers the plugin — no hand-editing of profile configs.

1. Install into your web profile (needs [`dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) and `pnpm` on PATH):
   ```sh
   dsh plugin --profile web add dsh-schematic
   ```
   That runs `pnpm add dsh-schematic` inside the profile (`~/.dsh/profiles/web`) and adds the package to the profile's bundle layers.
2. (Re)start the web profile and open the viewer:
   ```sh
   dsh web    # then visit http://127.0.0.1:3080/schematic
   ```
3. That's it. You get the viewer at `/schematic`, a **Plugin topology** section in the SPA's Settings, and the composer-side star map — the browser bundle ships inside the package.

Other profiles work the same way (`dsh plugin --profile tui add dsh-schematic`). Upgrading is `dsh plugin --profile web update dsh-schematic`; removing is `dsh plugin --profile web remove dsh-schematic`.

To uninstall cleanly, also drop the `schematic` row from `dsh.profile.bundles` (the reconcile does that automatically on `remove`).

**From source** (maintainers): clone the [public repository](https://github.com/Mason-1011/dsh-schematic), then build with `npm install && npm run build`. Either symlink the checkout into the profile's `node_modules/dsh-schematic` (mount by name; keep the package's own bundle layer or your manual insert — never both, duplicate loader entry ids fail the tree), or run the worked example [`dev.cordis.yml`](dev.cordis.yml) — port 3081 against a harness checkout (`node --import tsx/esm apps/cli/src/bin.ts --profile web --patch dev.cordis.yml`); the dev instance's session root is isolated to `~/.dsh-schematic-dev/`, so dev restarts and kills never touch your live sessions.

## Usage

- **Viewer** (`/schematic`) — a full-screen app with **System / Blueprints / Activity** as its primary navigation. System switches between topology and inventory; Activity owns the live event stream and journey; the first-run guide can be reopened from `?`.
- **Star map** — drag the panel anywhere; drag the bottom-right grip to resize; scroll the mouse wheel over it to tune the backdrop (0 = fully transparent); hover a star for its card and one-hop lanes; double-click, or focus it and press Enter/Space, to open the viewer fully expanded.
- **Settings** → *Plugin topology* — opens the viewer; the backdrop slider two-way syncs with the wheel.
- **Timeline** — the replay toggle pages back through the selected session's history; the stats toggle swaps in the per-plugin count table (polled only while open).
- **System editing** — selecting a node opens its contextual controls for enable/disable, config, provider replacement, and adding it to a blueprint. Every change still goes through the preview drawer; danger moves require the related entry id. Below 768 px the same surfaces remain browseable but all writes are disabled.
- **Blueprints** — the dedicated three-column workspace holds the blueprint list, capability-grouped editor, and changeset. Create from the running system, an existing blueprint, or protected core only; scalar and nested config use forms while arrays and `!!js` stay in advanced YAML. Drafts are local until **Save blueprint**. Import by file picker or drop, export as YAML, and explicitly decide how every post-save unmanaged plugin should be treated before switching.
- **Blueprints in conversation** — tell dsh's model "save me a lean wiring and switch to it": the model picks members with `schematic_plugins`, saves via `schematic_blueprint_save`, and switches with `schematic_blueprint_switch` (the same write pipeline as the page, reporting the hot-reload outcome).
- **Ask in chat** — in the viewer, a package's panel offers to ask about it in a fresh conversation, question sent for you.

## How it works

Two halves in one package:

- **Host half** (`src/index.ts`, `src/activity/`, `src/graph.ts`, `src/compose/`, `src/tools.ts`, `src/service.ts`) — a Cordis plugin that reads the loader's plugin tree, subscribes in-process to the session-event firehose, agent status, registry callbacks, and the internal service-read waterfall, then serves `/schematic` (viewer page), `/schematic/events` (SSE), `/schematic/mini.json` (polled miniature feed), `/schematic/history` (paged replay), `/schematic/stats.json` (live-window per-plugin counters), and the workbench routes (`/schematic/compose.json` GET + `/compose/preview|apply|rollback|clear` POST; `/schematic/blueprints` GET + `/blueprints/save|update|materialize|current|delete|import` POST + `/blueprints/export` GET) from the harness web server; `src/service.ts` additionally provides the live graph as the `schematic` ctx service (`ctx.schematic.graph()`) for sibling plugins that inject it; `src/tools.ts` registers blueprint save/list/switch as `schematic_*` model tools on the host's tool registry (sharing `saveBlueprintCore`/`materializeCore` with the HTTP routes — one implementation). The workbench derives the profile's patch file from the loader tree, dry-runs candidate edits through `@deepseek-ai/dsh-app-boot`'s own composition, and writes only the managed block (all YAML round-tripping through `@deepseek-ai/cordis-plugin-include`'s dialect, so `!!js` expressions survive verbatim; resolved from the profile at runtime and declared as peer dependencies, alongside type-only `@deepseek-ai/dsh-tools`).
- **Browser half** (`src/client/`, bundled to `dist/client.js`) — loads inside the dsh web SPA: contributes the Settings section, dresses the nav icon, mounts the composer-side star map, and handles the ask-in-chat hand-off. The standalone viewer (`dist/engine.js`) is self-booting and talks only to the host routes above.

## Development

```sh
npm run build    # esbuild bundles both browser artifacts
```

`tools/scan.mjs` renders a static graph from a harness checkout (the pre-live v0.1 approach; still handy without a running instance). Internal positioning and naming decisions live in [`DECISIONS.md`](DECISIONS.md).

## Contributing

Issues, compatibility reports, and focused pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), and include your DSH version, profile, reproduction steps, and relevant browser/host logs in bug reports.

## Roadmap

- Next — seam-aware market panel (the supply side of the graph; conflicts surfaced before install) and install hand-off for missing packages
- v0.4 — blueprint workbench: compose named wiring blueprints and switch between them ✅ shipped

Shipped history, version by version, is in the [changelog](CHANGELOG.md).

## Acknowledgments

Built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [Cordis](https://github.com/cordiverse/cordis); the resting-state theorem from the Cordis [paper](https://github.com/cordiverse/paper) is why a live wiring diagram can be read as a stable schematic at all.

## License

[MIT](LICENSE)
