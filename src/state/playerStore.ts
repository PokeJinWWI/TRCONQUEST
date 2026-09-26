import { create } from 'zustand'
import { SANDBOX_PLAYER_ID } from '../data/countryRoster'

// Which country the player picked at the main menu (see MainMenu.tsx) — the
// single piece of session state that gates the whole game shell (see
// App.tsx). Plain in-memory store, no persistence, same as every other store
// here: a fresh page load always returns to the menu.
//
// Sandbox mode picks no country at all: the player is a no-nation faction
// (SANDBOX_PLAYER_ID), so `selectedCountryId` is still set — that's what
// gates the shell and marks which ships and armies are the player's — but it
// names no entry in COUNTRIES, and `sandbox` tells the rest of the game to
// leave nations, territory, economy and AI switched off.
// Which economic model drives this game — chosen at the main menu, fixed for the
// session (the two models have entirely different state shapes, so it can't be
// switched mid-game). 'complex' is Complex mode, the deep Vic3-style simulation
// (`src/economy/*`, economyStore); 'abstract' is Simple mode, the macro
// national model (Stellaris/HOI4/TNO-inspired, `src/economy-abstract/*`). Default 'complex' so nothing changes unless the
// player opts in.
export type EconomyModel = 'complex' | 'abstract'

interface PlayerState {
  selectedCountryId: string | null
  sandbox: boolean
  economyModel: EconomyModel
  setEconomyModel: (m: EconomyModel) => void
  selectCountry: (id: string) => void
  startSandbox: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  selectedCountryId: null,
  sandbox: false,
  economyModel: 'complex',
  setEconomyModel: (m) => set({ economyModel: m }),
  selectCountry: (id) => set({ selectedCountryId: id, sandbox: false }),
  startSandbox: () => set({ selectedCountryId: SANDBOX_PLAYER_ID, sandbox: true }),
}))

// Whether this session is the sandbox (no nations, no economy, no AI).
export function isSandbox(): boolean {
  return usePlayerStore.getState().sandbox
}

// Which economic model this game runs.
export function economyModel(): EconomyModel {
  return usePlayerStore.getState().economyModel
}
export function isAbstractEconomy(): boolean {
  return usePlayerStore.getState().economyModel === 'abstract'
}
