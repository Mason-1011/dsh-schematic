/**
 * settings.section body for dsh-schematic: one settings row — what the
 * viewer is, and the action that opens the standalone /schematic page in a
 * new browser tab. The page itself is not embedded (redesign decision);
 * settings carries only the door to it.
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

/** settings.section component props: the locale seat for this namespace. */
export interface SettingsSectionProps {
  t: (key: 'rowTitle' | 'rowDesc' | 'open') => string
}

/** Row rhythm follows the app's settings cells (locale LanguageRow): 16px 0, hairline, 14/22 title. */
export const SETTINGS_SECTION_CSS = `
.sch-set { display: flex; flex-direction: column; width: 100%; }
.sch-set-row { display: flex; align-items: center; gap: 8px; padding: 16px 0; }
.sch-set-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 24px; }
.sch-set-title { font-size: 14px; font-weight: 400; line-height: 22px; color: var(--dsw-alias-label-primary); }
.sch-set-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }`

/** Render the section body: description plus the open-viewer action. */
export function SchematicSettingsSection({ t }: SettingsSectionProps): JSX.Element {
  return (
    <div className="sch-set">
      <div className="sch-set-row">
        <div className="sch-set-text">
          <div className="sch-set-title">{t('rowTitle')}</div>
          <div className="sch-set-desc">{t('rowDesc')}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { window.open('/schematic', '_blank', 'noopener') }}
        >
          {t('open')}
        </Button>
      </div>
    </div>
  )
}
