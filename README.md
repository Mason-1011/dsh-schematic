# dsh-schematic

> Read — and rewrite — the wiring of your DeepSeek Harness.

🚧 Early development. This package currently reserves the name; the first functional release (v0.1) is in progress.

## What this is

DeepSeek Harness (dsh) composes an entire agent product from plugins: every capability — the model adapter, the tool registry, the agent loop itself — mounts onto a shared Cordis context through services, `inject` dependencies, typed events, and reversible effects.

That wiring only exists inside the running process. `dsh-schematic` draws it.

- **Topology view** — an interactive wiring diagram of the mounted plugins: who provides `ctx.fs`, who injects it, which events flow between them, where each capability seam sits. Read-only, zero-risk, rendered from the loader's own plugin tree.
- **Composition workbench** — edit the wiring: swap providers (local → sandbox → remote), toggle plugins, compose presets. Changes are previewed and validated before anything is applied.
- **Seam-aware market** — click an empty seam and see the plugins that can fill it; install them straight onto the graph. Conflicts (double-registered keys, missing providers) surface before install, not after a crash.

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

## Roadmap

- v0.0.x — name reserved, positioning docs
- v0.1 — static topology: scan a harness checkout, render the plugin dependency graph from `inject` declarations
- v0.2 — live topology (shipped): mounts as a plugin, merges the Cordis runtime × loader streams, serves the viewer at `/schematic` with a one-click EN⇄中文 whole-page switch (descriptions batch-translated by the in-process LLM, identifiers kept in English), a dsh settings section that opens the viewer in a new tab, and an ask-in-chat hand-off that prefills a fresh ungrouped conversation
- v0.2.5 — readable topology (shipped): three tabs — journey (one message's path through the runtime as eight stage cards with the ctx keys exchanged between stages), domains (family cards group same-prefix packages without a capability seam; every edge is an arrow with a hover card naming consumer, provider, and the injected ctx keys), table; live refresh every 5s with a change toast, new plugins pulse, `?tab=` deep links
- v0.3 — composition edits with patch preview
- v0.4 — seam-aware market panel

## Install

Not yet on npm as a plugin. To run from a checkout against a harness dev instance, see `dev.cordis.yml` (mount by name; symlink the checkout into the profile's `node_modules` so the browser half is found).

## License

[MIT](LICENSE)
