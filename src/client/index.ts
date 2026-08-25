/**
 * Browser half of dsh-schematic: one sidebar footer action in the dsh web
 * SPA that opens the standalone /schematic page (served by the host half)
 * in a new tab. The viewer page itself is not embedded — the SPA carries
 * only the door to it.
 *
 * Bundle: scripts/build-client.mjs emits dist/client.js as a lazy-CJS
 * factory artifact — the format packages/client/tsdown.client.ts produces
 * in-repo (window.__ModuleLoader__.load({ id, factory })).
 */

import { SchematicFooterAction, FOOTER_ACTION_CSS } from './FooterAction.tsx'

/** Locale dictionary namespace owned by this plugin. */
const NS = 'schematic'

const zh = { open: '插件拓扑' }
const en = { open: 'Plugin topology' }

export const inject = ['slots', 'locale']

/** Contribute the footer action once ui-sidebar declares `sidebar.footer.action`. */
export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-schematic: dictionaries')
  const t = ctx.locale.bind(NS)
  if (document.querySelector('style[data-schematic-foot-css]') === null) {
    const tag = document.createElement('style')
    tag.dataset.schematicFootCss = ''
    tag.textContent = FOOTER_ACTION_CSS
    document.head.appendChild(tag)
  }
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'schematic',
    order: 10,
    label: () => t('open'),
    locale: NS,
  }, SchematicFooterAction))
}
