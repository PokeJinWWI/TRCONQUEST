// Quitting to the empire-select screen: put every piece of game state back the
// way it was when the page loaded, so the next nation picked starts a fresh
// game. Each store hands back its own initial state (zustand's
// getInitialState), so nothing here needs to know what's inside them. The
// player's display settings are the one thing kept — they're preferences, not
// game state.
import { resetFightPace } from '../hooks/fightPace'
import { resetDynamicCountries } from '../data/countryData'
import { cancelEconomyFlight } from '../state/economyStore'
import { STORE_REGISTRY } from '../state/gameStores'

export function resetGame(): void {
  // An economy month still being worked out belongs to the old game.
  cancelEconomyFlight()
  for (const { store } of STORE_REGISTRY) store.setState(store.getInitialState() as never, true)
  resetFightPace()
  resetDynamicCountries()
}
