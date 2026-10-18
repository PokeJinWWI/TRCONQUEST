import { create } from 'zustand'
import { pairKey } from '../data/diplomacyData'
import { inContact } from '../scene/contact'

// Which nations have made first contact (scene/contact.ts, hooks/useContactResolver.ts): the
// pairs that have met, as pairKeys. A nation not in data/contactData.ts's start list is in
// contact with everyone, so this holds only what play has added.
interface ContactState {
  met: string[]
  meet: (a: string, b: string) => void
}

export const useContactStore = create<ContactState>((set, get) => ({
  met: [],
  meet: (a, b) => {
    const key = pairKey(a, b)
    if (get().met.includes(key)) return
    set((s) => ({ met: [...s.met, key] }))
  },
}))

// Whether two nations are in contact now.
export function inContactNow(a: string, b: string): boolean {
  return inContact(a, b, new Set(useContactStore.getState().met))
}
