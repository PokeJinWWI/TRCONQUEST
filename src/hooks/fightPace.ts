import type { TimeMode } from '../state/gameTimeStore'

// What the two fight-following clocks (space combat → tactical,
// useCombatResolver; ground combat → operational, useGroundCombatResolver)
// need to know about each other. The pace only ever moves DOWN on its own:
// strategic → operational for a ground fight, strategic or operational →
// tactical for a space fight, and a ground fight never pulls a tactical clock
// up to operational. When a fight ends, the pace falls back to the slowest
// one still needed — so a space fight ending mid ground battle lands on
// operational — and once NO fight is left it goes back to strategic,
// whichever pace it was on (however it got there).
export const fightPace = {
  spaceLive: false,
  // True from a ground fight starting until a couple of days after its last
  // shot (see GROUND_FIGHT_COOLDOWN_DAYS), so a moment's lull isn't an end.
  groundLive: false,
}

// The pace after a space fight ends.
export function paceAfterSpaceFight(): TimeMode {
  return fightPace.groundLive ? 'operational' : 'normal'
}
