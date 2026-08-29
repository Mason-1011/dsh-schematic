/**
 * settings.section body for dsh-schematic: two settings rows — what the
 * viewer is (with the action that opens the standalone /schematic page in a
 * new tab), and the composer-side constellation's backdrop dial. The page
 * itself is not embedded (redesign decision); settings carries the door to
 * it plus the panel's one persisted preference.
 */

import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

/** settings.section component props: the locale seat for this namespace. */
export interface SettingsSectionProps {
  t: (key: 'rowTitle' | 'rowDesc' | 'open' | 'bgTitle' | 'bgHint') => string
}

/** Row rhythm follows the app's settings cells (locale LanguageRow): 16px 0, hairline, 14/22 title. */
export const SETTINGS_SECTION_CSS = `
.sch-set { display: flex; flex-direction: column; width: 100%; }
.sch-set-row { display: flex; align-items: center; gap: 8px; padding: 16px 0; }
.sch-set-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 24px; }
.sch-set-title { font-size: 14px; font-weight: 400; line-height: 22px; color: var(--dsw-alias-label-primary); }
.sch-set-desc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.sch-set-slider { display: flex; align-items: center; gap: 8px; }
.sch-set-range { width: 140px; accent-color: var(--dsw-alias-label-primary); }
.sch-set-val { min-width: 36px; text-align: right; font: 500 12px/18px ui-monospace, monospace; color: var(--dsw-alias-label-secondary); }`

/** Backdrop dial persistence, shared with the panel ('sch.mini.bg', 0–1). */
const BG_KEY = 'sch.mini.bg'
const readBg = (): number => {
  try {
    const raw = localStorage.getItem(BG_KEY)
    const v = raw === null ? Number.NaN : Number(raw)
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v
  } catch { /* an unreadable store falls back to the default dial */ }
  return 0.88
}

/** Render the section body: viewer door + backdrop dial. */
export function SchematicSettingsSection({ t }: SettingsSectionProps): JSX.Element {
  const [bg, setBg] = useState(readBg)
  // The wheel over the live panel moves the same dial; keep the slider honest.
  useEffect(() => {
    const onBg = (e: Event): void => {
      const v = (e as CustomEvent<number>).detail
      if (typeof v === 'number' && v >= 0 && v <= 1) setBg(v)
    }
    window.addEventListener('sch-mini-bg', onBg)
    return () => window.removeEventListener('sch-mini-bg', onBg)
  }, [])
  const dial = (v: number): void => {
    setBg(v)
    try { localStorage.setItem(BG_KEY, v.toFixed(2)) } catch { /* unwritable store: the change lives for this page only */ }
    window.dispatchEvent(new CustomEvent('sch-mini-bg', { detail: v }))
  }
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
      <div className="sch-set-row">
        <div className="sch-set-text">
          <div className="sch-set-title">{t('bgTitle')}</div>
          <div className="sch-set-desc">{t('bgHint')}</div>
        </div>
        <div className="sch-set-slider">
          <input
            className="sch-set-range"
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(bg * 100)}
            onChange={(e) => { dial(Number(e.currentTarget.value) / 100) }}
          />
          <span className="sch-set-val">{Math.round(bg * 100)}%</span>
        </div>
      </div>
    </div>
  )
}
