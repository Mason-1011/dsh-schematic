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
- v0.2.8 — runtime activity (shipped): an SSE feed (`/schematic/events`) observes the session-event firehose in-process and attributes every turn, model reply, and tool call to its owning plugin; the viewer lights the plugin the work is currently flowing through (strong while a tool runs or the model streams, breathing-glow decay after), plus a collapsible activity timeline bar and a session selector that defaults to following the SPA's current chat (pure observer — nothing is appended to session logs)
- v0.2.9 — all-actions observability (shipped): an RPC-gateway observer wraps every apiProxy mutation method as a behavior-neutral pass-through, and live registry events (tools/change, system-prompt/change…) join the same feed — so UI actions that never touch any session log (archiving a session, renaming a workspace, changing settings) light their owning plugin and land in the timeline as action rows with duration; still a pure observer of the host process
- v0.2.10 — openable family cards + streaming-highlight fix (shipped): domains-view family cards (llm, client — same-prefix packages without a capability seam) now open like clusters, via double-click or the detail panel's open button, into the same scope view; the strong highlight after a model stream used to never decay (the llm card stayed lit forever) and now downgrades when the message completes and expires on the TTL
- v0.2.11 — journey auto-fit (shipped): the journey tab scales its stage cards so the whole message path is on screen with zero scrollbars at any window size; the +/−/fit buttons magnify past the fit scale for reading (drag-pan and scrollbars take over), and fit restores the overview
- v0.2.12 — broadcast reception (shipped): the live event bus keeps every listener record (ctx.events._hooks, attributed through the registering fiber), so the viewer can answer "who receives this broadcast" — the activity bar names the session/event listeners, each non-action timeline row carries the receiver list on hover, and every package's detail panel lists the events it listens to; a receiver's reaction still shows as its own attributed row
- v0.2.13 — service-read observability (shipped): pure-wiring packages (provide/inject only, no broadcast listeners) get their first live signal — one internal/get waterfall listener (the framework's own "a service is being read" extension point) counts every ctx.<service-key> read as (reader package, key), behavior-neutral (count-and-delegate only, values never wrapped); the timeline gains a toggleable service-read row type, both ends light up (reader and the key's provider), and each package's detail panel lists the keys it actually read with counts; one turn traces agent-loop → ctx.llm, tool-bash → ctx.shell ×3 + sandbox/shellEnv/subprocess
- v0.2.14 — radial mesh overview (shipped): the domains overview drops its column arrangement for a radial mesh — the most-connected unit (by unit-level edge count) sits at the center, everything else radiates outward on hop-distance rings with each subtree keeping its parent's angular sector; edges become border-anchored straight lines (arrowheads at the consumer), and the layout is fully deterministic. The scope view inside a cluster/family keeps its semantic columns
- v0.3 — composition edits with patch preview
- v0.4 — seam-aware market panel

## Install

Not yet on npm as a plugin. To run from a checkout against a harness dev instance, see `dev.cordis.yml` (mount by name; symlink the checkout into the profile's `node_modules` so the browser half is found).

## License

[MIT](LICENSE)
