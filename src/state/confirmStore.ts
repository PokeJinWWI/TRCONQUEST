import { create } from 'zustand'

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
}

interface ConfirmStore {
  pending: ConfirmRequest | null
  requestConfirm: (req: ConfirmRequest) => void
  resolve: (ok: boolean) => void
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  pending: null,
  requestConfirm: (req) => set({ pending: req }),
  resolve: (ok) => {
    const req = get().pending
    set({ pending: null })
    if (ok && req) req.onConfirm()
  },
}))
