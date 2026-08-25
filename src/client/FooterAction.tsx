/**
 * The one SPA-side surface of dsh-schematic: a sidebar footer action that
 * opens the standalone /schematic page in a new tab. The viewer itself lives
 * on its own page; the SPA only carries the door to it.
 *
 * Rendered by the `sidebar.footer.action` list slot (owner props: `wide`).
 * Geometry follows the sidebar foot rhythm: a 42px row when the sidebar is
 * wide, the 36px rail circle when collapsed (same box as the settings
 * trigger; each occupant owns its own button chrome).
 */
import { IconShareOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

export interface FooterActionProps {
  /** Sidebar renders wide content (false = 56px rail). */
  wide: boolean
  /** Locale seat for the open action's label. */
  t: (key: 'open') => string
}

/** Minimal chrome for the footer row/rail; injected once by the entry. */
export const FOOTER_ACTION_CSS = `
.sch-foot {
  display: flex; align-items: center; gap: 8px;
  width: calc(100% + 4px); height: 42px; margin: 4px -2px;
  padding: 0 10px 0 8px; box-sizing: border-box;
  border: none; border-radius: 12px; background: transparent;
  cursor: pointer; overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-family: inherit; font-size: 14px; line-height: 22px;
}
.sch-foot:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sch-foot.rail {
  width: 36px; height: 36px; margin: 8px 0 10px;
  justify-content: center; gap: 0; padding: 0; border-radius: 50%;
}
`

export function SchematicFooterAction({ wide, t }: FooterActionProps): JSX.Element {
  return (
    <button
      type="button"
      className={wide ? 'sch-foot' : 'sch-foot rail'}
      title={t('open')}
      aria-label={t('open')}
      onClick={() => { window.open('/schematic', '_blank', 'noopener') }}
    >
      <IconShareOutline16 />
      {wide ? <span>{t('open')}</span> : null}
    </button>
  )
}
