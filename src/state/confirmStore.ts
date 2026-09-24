import { create } from 'zustand'
import { useGameTimeStore } from './gameTimeStore'

// A pending confirmation request: what the player is about to do, what it will
// cost/gain, and the action to run if they confirm. Used to gate every
// impactful button behind a "here's what happens — proceed?" dialog.
export interface ConfirmRequest {
  title: string
  body?: string
  // Bullet list of consequences (gains/losses/effects).
  effects: string[]
  confirmLabel?: string
  onConfirm: () => void
  // Runs if the player declines (Cancel, or clicking away).
  onCancel?: () => void
  // The decision arrived on its own rather than from something the player
  // clicked (an AI's peace offer), so the game holds still until it's made.
  // The clock resumes afterwards only if this request was what stopped it.
  pausesGame?: boolean
}

interface ConfirmStore {
  pending: ConfirmRequest | null
  requestConfirm: (req: ConfirmRequest) => void
  resolve: (ok: boolean) => void
}

// Whether the clock was running until the pending request paused it.
let pausedByRequest = false

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  pending: null,
  requestConfirm: (req) => {
    pausedByRequest = false
    if (req.pausesGame && !useGameTimeStore.getState().paused) {
      useGameTimeStore.getState().togglePause()
      pausedByRequest = true
    }
    set({ pending: req })
  },
  resolve: (ok) => {
    const req = get().pending
    set({ pending: null })
    if (pausedByRequest) {
      pausedByRequest = false
      if (useGameTimeStore.getState().paused) useGameTimeStore.getState().togglePause()
    }
    if (!req) return
    if (ok) req.onConfirm()
    else req.onCancel?.()
  },
}))
