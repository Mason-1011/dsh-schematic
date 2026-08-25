/**
 * Browser half of dsh-schematic: registers the topology viewer as a section
 * of the dsh web SPA's settings surface. The section hosts the same
 * framework-free engine as the standalone /schematic page (engine.ts) and
 * reads its data from the host half's same-origin endpoints.
 *
 * Bundle: scripts/build-client.mjs emits dist/client.js as a lazy-CJS
 * factory artifact — the format packages/client/tsdown.client.ts produces
 * in-repo (window.__ModuleLoader__.load({ id, factory })).
 */

import { SchematicSection } from './SchematicSection.tsx'

/** Locale dictionary namespace owned by this plugin. */
const NS = 'settings.schematic'

const zh = { section: '插件拓扑' }
const en = { section: 'Plugin topology' }

export const inject = ['slots', 'locale']

/** Contribute the section once the settings shell declares `settings.section`. */
export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-schematic: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'schematic',
    order: 90,
    label: () => t('section'),
    locale: NS,
    inject: () => ({}),
  }, SchematicSection))
}
