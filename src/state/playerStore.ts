import { create } from 'zustand'

// Which country the player picked at the main menu (see MainMenu.tsx) — the
// single piece of session state that gates the whole game shell (see
// App.tsx). Plain in-memory store, no persistence, same as every other store
// here: a fresh page load always returns to the menu.
interface PlayerState {
  selectedCountryId: string | null
  selectCountry: (id: string) => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  selectedCountryId: null,
  selectCountry: (id) => set({ selectedCountryId: id }),
}))
