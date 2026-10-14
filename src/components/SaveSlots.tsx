import { Bi } from './Bi'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCountry } from '../data/countryData'
import { applySave, createSave } from '../state/saveGame'
import { DAYS_PER_YEAR, START_YEAR, useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'
import { deleteSlot, downloadSave, listSlots, readSaveFile, readSlot, writeSlot, type SlotInfo } from '../state/saveStorage'

// Save slots and save files: shown in the Escape menu (can save and load) and on
// the main menu (load only). Loading replaces the running game.
function describeGame(): string {
  const { selectedCountryId, economyModel } = usePlayerStore.getState()
  const nation = (selectedCountryId && getCountry(selectedCountryId)?.name) || 'Sandbox'
  const year = Math.floor(START_YEAR + useGameTimeStore.getState().simDays / DAYS_PER_YEAR)
  return `${nation} · ${economyModel === 'complex' ? 'Complex' : 'Simple'} · ${year}`
}

export function SaveSlots({ canSave, onLoaded }: { canSave: boolean; onLoaded: () => void }) {
  const [slots, setSlots] = useState<SlotInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    listSlots().then(setSlots, (e: Error) => setMessage(e.message))
  }, [])
  useEffect(refresh, [refresh])

  const run = async (what: string, job: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await job()
      setMessage(what)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const load = async (file: Parameters<typeof applySave>[0]) => {
    await applySave(file)
    const capital = getCountry(usePlayerStore.getState().selectedCountryId ?? '')?.capitalStarId
    if (capital) useViewStore.getState().enterSystem(capital)
    onLoaded()
  }

  const save = (id: string) => run('Saved.', async () => writeSlot(id, await createSave(describeGame())))

  return (
    <div className="save-slots">
      {canSave && (
        <button type="button" className="confirm-btn confirm-btn-go" disabled={busy} onClick={() => save(`slot-${Date.now()}`)}>
          Save to a new slot
        </button>
      )}
      <ul className="save-slot-list">
        {slots.length === 0 && <li className="confirm-effect">No saved games yet.</li>}
        {slots.map((slot) => (
          <li key={slot.id} className="save-slot">
            <span className="save-slot-name" title={slot.savedAt}>
              {slot.label || slot.id} <small>{new Date(slot.savedAt).toLocaleString()} · {(slot.bytes / 1024).toFixed(0)} KB</small>
            </span>
            <button type="button" className="confirm-btn" disabled={busy} onClick={() => run('Loaded.', async () => load(await readSlot(slot.id)))}>
              <Bi en="Load" />
            </button>
            {canSave && (
              <button type="button" className="confirm-btn" disabled={busy} title="Overwrite this slot with the game now" onClick={() => save(slot.id)}>
                <Bi en="Overwrite" />
              </button>
            )}
            <button type="button" className="confirm-btn" disabled={busy} onClick={() => run('Exported.', async () => downloadSave(await readSlot(slot.id), slot.label || slot.id))}>
              <Bi en="Export" />
            </button>
            <button type="button" className="confirm-btn confirm-btn-cancel" disabled={busy} onClick={() => run('Deleted.', () => deleteSlot(slot.id))}>
              <Bi en="Delete" />
            </button>
          </li>
        ))}
      </ul>
      <div className="save-slot-files">
        {canSave && (
          <button type="button" className="confirm-btn" disabled={busy} onClick={() => run('Exported.', async () => downloadSave(await createSave(describeGame()), describeGame()))}>
            <Bi en="Export this game to a file" />
          </button>
        )}
        <button type="button" className="confirm-btn" disabled={busy} onClick={() => fileInput.current?.click()}>
          Load from a file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.json,application/gzip,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) run('Loaded.', async () => load(await readSaveFile(file)))
          }}
        />
      </div>
      {message && <div className="confirm-body save-slot-message">{message}</div>}
    </div>
  )
}
