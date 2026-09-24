// Shared fixture for tests that need ships on opposing sides. Every ship is
// owned by a nation, and hostility is purely national (see
// src/state/shipRelations.ts) — so "a player ship and a hostile ship" in a
// test means "a ship of the player's nation and a ship of a nation at war with
// it." These two test nations stand in for that, and setUpTestNations() makes
// them exactly that: the player's own nation, and an enemy at war with it.
//
// The engine sees them the same way it sees Mars and Venus: syncEngagements
// puts the player's nation on side 0 and the enemy on side 1, which is what
// lets the existing tests keep their `p.side` expectations.
import { usePlayerStore } from '../src/state/playerStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'

export const TEST_PLAYER = 'test-player-nation'
export const TEST_ENEMY = 'test-enemy-nation'
// A third nation, at peace with both of the above unless a test says
// otherwise — "someone else's ships on the same field."
export const TEST_NEUTRAL = 'test-neutral-nation'

// The owner nation a test's shorthand role stands for. Anything that isn't
// one of the shorthands is taken as a real nation id already.
export function ownerFor(role: string): string {
  if (role === 'player' || role === 'friendly') return TEST_PLAYER
  if (role === 'hostile' || role === 'enemy') return TEST_ENEMY
  if (role === 'neutral') return TEST_NEUTRAL
  return role
}

// Makes TEST_PLAYER the player's nation and puts it at war with TEST_ENEMY.
// Call once at the top of a test file (each file runs in its own process).
export function setUpTestNations(): void {
  usePlayerStore.setState({ selectedCountryId: TEST_PLAYER })
  useDiplomacyStore.getState().reset()
  useDiplomacyStore.getState().forceWar(TEST_PLAYER, TEST_ENEMY, 0)
}
