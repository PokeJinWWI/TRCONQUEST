import { Bi } from './Bi'
import { SCRIPT_LABELS, THEME_LABELS, useThemeStore, type ScriptId, type ThemeId } from '../state/themeStore'

// The UI theme choice (state/themeStore.ts), shown in Settings and on the main menu. The script
// and motion rows only matter for NERV, so they show only with it on.
export function ThemePicker() {
  const theme = useThemeStore((s) => s.theme)
  const script = useThemeStore((s) => s.script)
  const reduceMotion = useThemeStore((s) => s.reduceMotion)
  const t = useThemeStore.getState()
  return (
    <>
      <div className="inspect-row">
        <span className="inspect-label"><Bi en="UI Theme" /></span>
        <span className="inspect-value combat-density-row">
          {(Object.keys(THEME_LABELS) as ThemeId[]).map((id) => (
            <button key={id} type="button" className={`combat-density-btn${theme === id ? ' active' : ''}`} onClick={() => t.setTheme(id)}>
              {THEME_LABELS[id]}
            </button>
          ))}
        </span>
      </div>
      {theme === 'nerv' && (
        <>
          <div className="inspect-row">
            <span className="inspect-label"><Bi en="Native labels" /></span>
            <span className="inspect-value combat-density-row">
              {(Object.keys(SCRIPT_LABELS) as ScriptId[]).map((id) => (
                <button key={id} type="button" lang={id} className={`combat-density-btn${script === id ? ' active' : ''}`} onClick={() => t.setScript(id)}>
                  {SCRIPT_LABELS[id]}
                </button>
              ))}
            </span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label"><Bi en="Reduce motion" /></span>
            <span className="inspect-value combat-density-row">
              <button type="button" className={`combat-density-btn${reduceMotion ? ' active' : ''}`} onClick={() => t.setReduceMotion(!reduceMotion)} title="No flicker, flashing alerts or scanlines">
                {reduceMotion ? 'On' : 'Off'}
              </button>
            </span>
          </div>
        </>
      )}
    </>
  )
}
