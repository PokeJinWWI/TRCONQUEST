import { Bi } from './Bi'
import { CRT_KEYS, CRT_LABELS, SCRIPT_LABELS, THEME_IDS, THEME_LABELS, useThemeStore, type CrtEffects, type ScriptId } from '../state/themeStore'
import { MODERN_PALETTE_IDS, MODERN_PALETTE_LABELS, modernPaletteOf } from '../scene/modernPalette'
import { PHOSPHOR_LABELS, phosphorOf, type PhosphorId } from '../scene/phosphor'

// The CRT switches (curved glass, scanlines, glow, noise, flicker), Terminal's and NERV's own sets.
function ScreenEffects({ crt, set }: { crt: CrtEffects; set: (key: keyof CrtEffects, on: boolean) => void }) {
  return (
    <div className="inspect-row">
      <span className="inspect-label"><Bi en="Screen effects" /></span>
      <span className="inspect-value combat-density-row">
        {CRT_KEYS.map((k) => (
          <button key={k} type="button" className={`combat-density-btn${crt[k] ? ' active' : ''}`} onClick={() => set(k, !crt[k])} title={k === 'flicker' ? 'Off whenever Reduce motion is on' : undefined}>
            {CRT_LABELS[k]}
          </button>
        ))}
      </span>
    </div>
  )
}

// The UI theme choice (state/themeStore.ts), shown in Settings and on the main menu. The script
// row only matters for NERV; Ichor and Yesteryear have only the motion row (their window fade).
export function ThemePicker() {
  const theme = useThemeStore((s) => s.theme)
  const script = useThemeStore((s) => s.script)
  const reduceMotion = useThemeStore((s) => s.reduceMotion)
  const phosphor = useThemeStore((s) => s.phosphor)
  const hue = useThemeStore((s) => s.phosphorHue)
  const modernPalette = useThemeStore((s) => s.modernPalette)
  const modernHue = useThemeStore((s) => s.modernHue)
  const crt = useThemeStore((s) => s.crt)
  const nervCrt = useThemeStore((s) => s.nervCrt)
  const t = useThemeStore.getState()
  return (
    <>
      <div className="inspect-row">
        <span className="inspect-label"><Bi en="UI Theme" /></span>
        <span className="inspect-value combat-density-row">
          {THEME_IDS.map((id) => (
            <button key={id} type="button" className={`combat-density-btn${theme === id ? ' active' : ''}`} onClick={() => t.setTheme(id)}>
              {THEME_LABELS[id]}
            </button>
          ))}
        </span>
      </div>
      {theme === 'terminal' && (
        <>
          <div className="inspect-row">
            <span className="inspect-label"><Bi en="Phosphor" /></span>
            <span className="inspect-value combat-density-row">
              {(Object.keys(PHOSPHOR_LABELS) as PhosphorId[]).map((id) => (
                <button key={id} type="button" className={`combat-density-btn${phosphor === id ? ' active' : ''}`} onClick={() => t.setPhosphor(id)}>
                  {PHOSPHOR_LABELS[id]}
                </button>
              ))}
            </span>
          </div>
          {phosphor === 'custom' && (
            <div className="inspect-row">
              <span className="inspect-label"><Bi en="Hue" /></span>
              <span className="inspect-value combat-density-row">
                <input type="range" min={0} max={359} value={hue} onChange={(e) => t.setPhosphorHue(Number(e.target.value))} title={`Hue ${hue}°`} style={{ accentColor: `hsl(${phosphorOf('custom', hue).h} 100% 60%)` }} />
              </span>
            </div>
          )}
          <ScreenEffects crt={crt} set={t.setCrt} />
          <div className="inspect-row">
            <span className="inspect-label"><Bi en="Reduce motion" /></span>
            <span className="inspect-value combat-density-row">
              <button type="button" className={`combat-density-btn${reduceMotion ? ' active' : ''}`} onClick={() => t.setReduceMotion(!reduceMotion)} title="Turns the flicker off">
                {reduceMotion ? 'On' : 'Off'}
              </button>
            </span>
          </div>
        </>
      )}
      {theme === 'modernterminal' && (
        <>
          <div className="inspect-row">
            <span className="inspect-label"><Bi en="Colours" /></span>
            <span className="inspect-value combat-density-row">
              {MODERN_PALETTE_IDS.map((id) => {
                const p = modernPaletteOf(id, modernHue)
                return (
                  <button key={id} type="button" className={`combat-density-btn${modernPalette === id ? ' active' : ''}`} onClick={() => t.setModernPalette(id)} title={`${MODERN_PALETTE_LABELS[id]}: rules ${p.accent}, selection ${p.select}`}>
                    <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, marginRight: 6, background: p.accent, outline: `1px solid ${p.select}` }} />
                    {MODERN_PALETTE_LABELS[id]}
                  </button>
                )
              })}
            </span>
          </div>
          {modernPalette === 'custom' && (
            <div className="inspect-row">
              <span className="inspect-label"><Bi en="Hue" /></span>
              <span className="inspect-value combat-density-row">
                <input type="range" min={0} max={359} value={modernHue} onChange={(e) => t.setModernHue(Number(e.target.value))} title={`Hue ${modernHue}°`} style={{ accentColor: modernPaletteOf('custom', modernHue).accent }} />
              </span>
            </div>
          )}
        </>
      )}
      {theme === 'nerv' && (
        <>
          <ScreenEffects crt={nervCrt} set={t.setNervCrt} />
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
      {(theme === 'ichor' || theme === 'yesteryear' || theme === 'modernterminal') && (
        <div className="inspect-row">
          <span className="inspect-label"><Bi en="Reduce motion" /></span>
          <span className="inspect-value combat-density-row">
            <button type="button" className={`combat-density-btn${reduceMotion ? ' active' : ''}`} onClick={() => t.setReduceMotion(!reduceMotion)} title="No window fades">
              {reduceMotion ? 'On' : 'Off'}
            </button>
          </span>
        </div>
      )}
    </>
  )
}
