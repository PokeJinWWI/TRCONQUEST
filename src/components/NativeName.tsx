import { useState } from 'react'
import { Bi } from './Bi'
import { forScript } from '../i18n/hanzi'
import { usePlaceNameStore } from '../state/placeNameStore'
import { SCRIPT_LABELS, useThemeStore } from '../state/themeStore'

// The subscript of something the player can rename, in the current script: the player's own
// (blank = hidden, ''), else the built-in one (traditional characters, converted), else undefined
// (Bi then falls back to the dictionary). Always undefined outside the NERV theme.
export function useNativeName(nativeKey: string, builtIn?: string): string | undefined {
  const nerv = useThemeStore((s) => s.theme === 'nerv')
  const script = useThemeStore((s) => s.script)
  const own = usePlaceNameStore((s) => s.natives[nativeKey]?.[script])
  if (!nerv) return undefined
  if (own !== undefined) return own.trim()
  return builtIn ? forScript(builtIn, script) : undefined
}

// A renamable thing's name with its own subscript.
export function NamedBi({ en, nativeKey, builtIn }: { en: string; nativeKey: string; builtIn?: string }) {
  const native = useNativeName(nativeKey, builtIn)
  return <Bi en={en} native={native} />
}

// The subscript field shown beside a rename box, in the NERV theme only: edits the subscript for
// the current script (Japanese, Traditional or Simplified Chinese). Empty = back to the default;
// a single space hides it.
export function NativeNameInput({ nativeKey, builtIn, onKeyDown }: { nativeKey: string; builtIn?: string; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void }) {
  const nerv = useThemeStore((s) => s.theme === 'nerv')
  const script = useThemeStore((s) => s.script)
  const own = usePlaceNameStore((s) => s.natives[nativeKey]?.[script])
  if (!nerv) return null
  const shown = own ?? (builtIn ? forScript(builtIn, script) : '')
  return (
    <input
      className="ground-key-name-input native-name-input"
      lang={script}
      value={shown}
      maxLength={40}
      placeholder={SCRIPT_LABELS[script]}
      title={`Its ${SCRIPT_LABELS[script]} label beside the name. Empty goes back to the default; a single space hides it.`}
      onChange={(e) => usePlaceNameStore.getState().setNative(nativeKey, script, e.target.value)}
      onKeyDown={onKeyDown}
    />
  )
}

// A name the player can change: shown with its subscript and a pencil; the pencil opens the name box
// (and, in NERV, the subscript box beside it). Enter or ✓ saves, Esc cancels; an empty name keeps the old one.
export function RenameField({ name, nativeKey, onRename, canRename = true }: { name: string; nativeKey: string; onRename: (name: string) => void; canRename?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  if (!editing) {
    return (
      <span className="rename-field">
        <NamedBi en={name} nativeKey={nativeKey} />
        {canRename && (
          <button
            type="button"
            className="ground-key-rename"
            title="Rename"
            onClick={(e) => {
              e.stopPropagation()
              setDraft(name)
              setEditing(true)
            }}
          >
            ✎
          </button>
        )}
      </span>
    )
  }
  const commit = () => {
    if (draft.trim()) onRename(draft)
    setEditing(false)
  }
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }
  return (
    <span className="rename-field" onClick={(e) => e.stopPropagation()}>
      <input className="ground-key-name-input" autoFocus value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} />
      <NativeNameInput nativeKey={nativeKey} onKeyDown={keys} />
      <button type="button" className="ground-key-rename" onClick={commit} title="Save">
        ✓
      </button>
    </span>
  )
}
