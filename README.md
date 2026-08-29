# dsh-schematic

> Read — and rewrite — the wiring of your DeepSeek Harness.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Stage](https://img.shields.io/badge/stage-early%20development-orange)](#status)
[![Built for](https://img.shields.io/badge/built%20for-DeepSeek%20Harness-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)

**English** | [简体中文](README.zh.md)

## Status

🚧 Early development — but already useful. The **live topology viewer** (v0.2.x) is shipped and in daily use against a real harness instance; the composition workbench and market panel (v0.3/v0.4) are next. Published to npm as [`dsh-schematic@0.2.27`](https://www.npmjs.com/package/dsh-schematic) — one-command install (see [Install](#install)). The GitHub repository is not public yet.

## What this is

DeepSeek Harness (dsh) composes an entire agent product from plugins: every capability — the model adapter, the tool registry, the agent loop itself — mounts onto a shared Cordis context through services, `inject` dependencies, typed events, and reversible effects.

That wiring only exists inside the running process. `dsh-schematic` draws it.

- **Topology view** — an interactive wiring diagram of the mounted plugins: who provides `ctx.fs`, who injects it, which events flow between them, where each capability seam sits. Read-only, rendered from the loader's own plugin tree.
- **Composition workbench** *(planned, v0.3)* — edit the wiring: swap providers (local → sandbox → remote), toggle plugins, compose presets. Changes are previewed and validated before anything is applied.
- **Seam-aware market** *(planned, v0.4)* — click an empty seam and see the plugins that can fill it; install them straight onto the graph. Conflicts (double-registered keys, missing providers) surface before install, not after a crash.

## Features

Shipped so far (details per version in the [changelog](CHANGELOG.md)):

**Topology viewer** — served at `/schematic` once mounted.
- Three tabs: **journey** (one message's path through the runtime as stage cards with the ctx keys exchanged), **domains** (radial mesh; family/cluster/core-spine cards open into scope views; group scatter with ⊕ and expand-all; edges drawn provider → consumer with hover cards), **table**.
- Live refresh every 5 s with a change toast; new plugins pulse; `?tab=` and `?expand=all` deep links.
- One-click EN ⇄ 中文 whole-page switch — descriptions machine-translated in-process, identifiers kept in English.

**Runtime activity** — watch the work flow.
- Every turn, model reply, tool call, registry change, host action, background job, and service read is attributed to its owning plugin; the graph lights up while the work flows through it (strong glow during tool runs and model streaming, breathing decay after) and a collapsible timeline names who did what, when, and how long it took.
- A session selector defaults to following the chat you are looking at; subagent/background filtering included.

**Composer-side star map** — a miniature of the expanded mesh floating beside the chat input.
- One dot per package in a deterministic force-relaxed galaxy; dots light with the viewed conversation's real activity; hover raises a plugin card, double-click opens the full viewer.
- Free placement (drag anywhere, re-docks beside the card), free resizing (viewport is the only ceiling), starfield tints by module hash, deep-space backdrop with a live opacity dial (mouse wheel or Settings).

**dsh integration**
- A Settings → *Plugin topology* section (custom Steam-style three-node nav icon) that opens the viewer in a new tab and exposes the backdrop slider.
- *Ask in chat* hand-off: from the viewer, send "explain this plugin" into a fresh Ungrouped conversation — the first question is sent for you through the RPC gateway.

### Pure observer, by construction

The plugin never writes to session logs (no custom event types), never wraps or intercepts service return values, and adds no topology edges for its own observers. Everything it shows is read from the host process's own signals — session-event broadcasts, status changes, registry callbacks, and the framework's service-read extension point.

## Why nobody else covers this layer

| Layer | Projects | What they show |
|---|---|---|
| Config | [dsh-blueprint](https://www.npmjs.com/package/dsh-blueprint) | booted config + overlay validation |
| Market | [zat-dsh-engine](https://github.com/mishibeikejie/zat-dsh-engine), [dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) | install / manage plugins |
| Session | [dsh-synapse](https://github.com/liangmianya/dsh-synapse), dsh-flowglass | conversation canvases, tool-call flows |
| **Topology** | **dsh-schematic** | **how plugins wire together** |

dsh runs on Cordis, and the Cordis paper [*A Programming Paradigm for Spatiotemporal Composability*](https://github.com/cordiverse/paper) proves a resting-state theorem: no matter how a system rewires itself at runtime, its settled state always equals some one-shot static assembly. dsh-schematic is the UI for that theorem — it renders the static equivalent of whatever the running system currently is.

The agent already has its own "creative mode" (self-modification tools that inspect and remount plugins mid-run). dsh-schematic is the same capability, for the human.

## Non-goals

- Not another generic marketplace — installation rides on the official `dsh plugin` mechanism; the market here is only the supply panel of the graph.
- Not a ComfyUI-style dataflow canvas — dsh composition is sockets-and-wires dependency injection, not dataflow; a node canvas would be the wrong metaphor.
- Not a session replay UI — dsh-synapse and dsh-flowglass own that.

## Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with the web profile (developed against rc.8).
- A current Chromium / Firefox / Safari (uses `light-dark()`, `EventSource`).
- Node ≥ 20 with npm — only to build the browser bundle.

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

**From source** (maintainers; the GitHub repo is not public yet): build with `npm install && npm run build`, then either symlink the checkout into the profile's `node_modules/dsh-schematic` (mount by name; keep the package's own bundle layer or your manual insert — never both, duplicate loader entry ids fail the tree), or run the worked example [`dev.cordis.yml`](dev.cordis.yml) — port 3081 against a harness checkout (`node --import tsx/esm apps/cli/src/bin.ts --profile web --patch dev.cordis.yml`).

## Usage

- **Viewer** (`/schematic`) — switch tabs or deep-link with `?tab=journey|domains|table`; expand every group at once with `?expand=all`; toggle EN/中文 from the header.
- **Star map** — drag the panel anywhere; drag the bottom-right grip to resize; scroll the mouse wheel over it to tune the backdrop (0 = fully transparent); hover a dot for the plugin's card; double-click to open the viewer fully expanded.
- **Settings** → *Plugin topology* — opens the viewer; the backdrop slider two-way syncs with the wheel.
- **Ask in chat** — in the viewer, a package's panel offers to ask about it in a fresh conversation, question sent for you.

## How it works

Two halves in one package:

- **Host half** (`src/index.ts`, `src/activity/`, `src/graph.ts`) — a Cordis plugin that reads the loader's plugin tree, subscribes in-process to the session-event firehose, agent status, registry callbacks, and the internal service-read waterfall, then serves `/schematic` (viewer page), `/schematic/events` (SSE), and `/schematic/mini.json` (polled miniature feed) from the harness web server.
- **Browser half** (`src/client/`, bundled to `dist/client.js`) — loads inside the dsh web SPA: contributes the Settings section, dresses the nav icon, mounts the composer-side star map, and handles the ask-in-chat hand-off. The standalone viewer (`dist/engine.js`) is self-booting and talks only to the host routes above.

## Development

```sh
npm run build    # esbuild bundles both browser artifacts
```

`tools/scan.mjs` renders a static graph from a harness checkout (the pre-live v0.1 approach; still handy without a running instance). Internal positioning and naming decisions live in [`DECISIONS.md`](DECISIONS.md).

## Roadmap

- v0.3 — composition edits with patch preview
- v0.4 — seam-aware market panel

Shipped history, version by version, is in the [changelog](CHANGELOG.md).

## Acknowledgments

Built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [Cordis](https://github.com/cordiverse/cordis); the resting-state theorem from the Cordis [paper](https://github.com/cordiverse/paper) is why a live wiring diagram can be read as a stable schematic at all.

## License

[MIT](LICENSE)
