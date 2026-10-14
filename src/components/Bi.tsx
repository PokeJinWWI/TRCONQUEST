import { nativeOf } from '../i18n/native'
import { useThemeStore } from '../state/themeStore'
import { usePlaceNameStore } from '../state/placeNameStore'

// An English label and, in the NERV theme, its native-script label beside it (EVA style:
// SHIPYARD 造船所). `native` overrides the dictionary (a name the player gave its own subscript;
// an empty string hides it). In the Default theme it is just the English.
export function Bi({ en, native }: { en: string; native?: string | null }) {
  const nerv = useThemeStore((s) => s.theme === 'nerv')
  const script = useThemeStore((s) => s.script)
  // Labels the player typed (Alt-click) change what nativeOf returns: re-render on them.
  usePlaceNameStore((s) => s.natives)
  if (!nerv) return <>{en}</>
  const n = native === undefined || native === null ? nativeOf(en, script) : native.trim() || undefined
  // data-bi: what an Alt-click on this label edits (components/NativeAnnotator.tsx).
  return (
    <span data-bi={en}>
      {en}
      {n && (
        <span className="native" lang={script}>
          {n}
        </span>
      )}
    </span>
  )
}

// For a string-only slot (a title prop, a tooltip): the English plus, in NERV, the native.
export function useBiText(): (en: string, native?: string | null) => string {
  const nerv = useThemeStore((s) => s.theme === 'nerv')
  const script = useThemeStore((s) => s.script)
  return (en, native) => {
    if (!nerv) return en
    const n = native === undefined || native === null ? nativeOf(en, script) : native.trim() || undefined
    return n ? `${en} ${n}` : en
  }
}

// Inside SVG (charts, the tech tree), where neither <Bi>'s span nor the annotator's CSS can draw:
// the native label alone for an English one, undefined outside NERV or when there is none.
export function useNativeText(): (en: string) => string | undefined {
  const nerv = useThemeStore((s) => s.theme === 'nerv')
  const script = useThemeStore((s) => s.script)
  usePlaceNameStore((s) => s.natives)
  return (en) => (nerv ? nativeOf(en, script) : undefined)
}
