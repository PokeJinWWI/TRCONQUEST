// Pre-built combat setups for the dev-only Debug Console, at three tiers
// defined by how the built-in automation fares against them — NOT by author
// judgment. Every number in the comment above each scenario came from
// actually running it through the real resolver (`stepEngagements`), 16
// seeded trials per configuration, with zero player input: no manual moves,
// no manual targeting, no manual chaff — just whatever each ship's `stance`
// and `chaffAutoDeploy` are set to here. See `tests/scenarios.test.ts` for
// the permanent, re-runnable proof; this file is just the data.
//
//   easy   — default automation (stance 'balanced', chaff auto) wins on its
//            own, essentially every time.
//   medium — default automation reliably LOSES, but the exact stance change
//            baked into this scenario's `ships[].stance` reliably wins.
//            "Beat it" means: load the scenario, then change stance in the
//            Strategizer to match (or leave it, since the data already
//            encodes the winning configuration — see DebugConsole's own
//            comment on why it's loaded with the winning stance already
//            set, not the losing default).
//   hard   — nothing in the automation toolbox (every stance, both chaff
//            settings) wins. Actually winning needs real manual play:
//            positioning, retargeting, and chaff timing the AI can't do.
//
// A genuinely useful, low-effort next scenario type once needed: a
// "survive N seconds" or "escort" win condition — everything here uses the
// simplest one (destroy every hostile, keep at least one ship alive) since
// that's what the verification harness in tests/scenarios.test.ts checks.

import type { FleetAllegiance } from './shipData'
import type { CombatStance } from './combatData'

export type ScenarioDifficulty = 'easy' | 'medium' | 'hard'

export interface ScenarioShip {
  classId: string
  allegiance: FleetAllegiance
  // Omit for the game's own default (`'balanced'`) — every easy scenario
  // omits this on purpose, since "the default wins" is the whole point.
  stance?: CombatStance
}

export interface Scenario {
  id: string
  name: string
  difficulty: ScenarioDifficulty
  // Where the fight happens — also determines what terrain (if any) is in
  // the arena, e.g. Earth brings Luna along (see combatResolution's
  // EARTH_MOON_OFFSET).
  bodyName: string
  description: string
  ships: ScenarioShip[]
}

export const SCENARIOS: Scenario[] = [
  // --- Easy --------------------------------------------------------------
  {
    id: 'easy-cruiser-vs-corvette',
    name: 'Border Patrol',
    difficulty: 'easy',
    bodyName: 'Mars',
    description:
      'A lone raider corvette against a single cruiser. The cruiser wins on defaults every time (16/16 verified) — a straightforward class-advantage stomp with nothing to learn from the loss column.',
    ships: [
      { classId: 'cruiser', allegiance: 'player' },
      { classId: 'corvette', allegiance: 'hostile' },
    ],
  },
  {
    id: 'easy-destroyer-flight-vs-corvette-pair',
    name: 'Corvette Raid',
    difficulty: 'easy',
    bodyName: 'Earth',
    description:
      'Three destroyers intercept two raiding corvettes. Numbers and class both favor the player — wins on defaults every time (16/16 verified).',
    ships: [
      { classId: 'destroyer', allegiance: 'player' },
      { classId: 'destroyer', allegiance: 'player' },
      { classId: 'destroyer', allegiance: 'player' },
      { classId: 'corvette', allegiance: 'hostile' },
      { classId: 'corvette', allegiance: 'hostile' },
    ],
  },

  // --- Medium --------------------------------------------------------------
  {
    id: 'medium-frigate-vs-battleship',
    name: "Gunboat's Gambit",
    difficulty: 'medium',
    bodyName: 'Earth',
    description:
      "One frigate against one battleship. On Balanced (the default) this is a total loss, 0/16 verified — the frigate holds within the battleship's own gun range and gets ground down. On Kite it's a total win, 16/16 verified: Kite holds at 92% of the frigate's longest range (its missile batteries reach 11 units) versus Balanced's 70%, which is just enough to sit outside the battleship's own longest reach (9 units) while the battleship — the slowest hull in the game — can never close the gap. Loaded with Kite already set, since that's the entire lesson: same ships, one stance, opposite outcome.",
    ships: [
      { classId: 'frigate', allegiance: 'player', stance: 'kite' },
      { classId: 'battleship', allegiance: 'hostile' },
    ],
  },
  {
    id: 'medium-frigate-pair-vs-cruiser-trio',
    name: 'Picket Line',
    difficulty: 'medium',
    bodyName: 'Earth',
    description:
      'Two frigates against three cruisers. Balanced loses every time, 0/16 verified. Kite wins every time, 16/16 verified — same range-outrunning logic as the battleship matchup, just against a faster but still out-ranged and out-massed pack. Loaded with Kite already set.',
    ships: [
      { classId: 'frigate', allegiance: 'player', stance: 'kite' },
      { classId: 'frigate', allegiance: 'player', stance: 'kite' },
      { classId: 'cruiser', allegiance: 'hostile' },
      { classId: 'cruiser', allegiance: 'hostile' },
      { classId: 'cruiser', allegiance: 'hostile' },
    ],
  },

  // --- Hard --------------------------------------------------------------
  // A clean 1-ship-vs-Battleship duel ("David and Goliath": Destroyer, then
  // Cruiser, both tried) was removed after extensive testing showed it can't
  // satisfy this tier's own definition — see combatData.ts's BATTLESHIP_PROFILE
  // comment for the full account. Every scenario below instead follows the
  // shape that's actually proven to work: a numbers-disadvantaged player
  // fleet where the human lever is splitting attention (focus fire, picking
  // off the weak link first) rather than raw stat/positioning tricks alone.
  {
    id: 'hard-destroyer-pair-vs-raider-pack',
    name: "Raider King's Escort",
    difficulty: 'hard',
    bodyName: 'Earth',
    description:
      'Two destroyers against a battleship escorted by two corvettes. 0/16 on Balanced, Swarm, and Kite alike — the combined hostile DPS out-damages the destroyers regardless of stance. A human focusing fire on one corvette first (to cut incoming damage before dealing with the battleship) has a real shot; no stance the AI can hold does that on its own.',
    ships: [
      { classId: 'destroyer', allegiance: 'player' },
      { classId: 'destroyer', allegiance: 'player' },
      { classId: 'battleship', allegiance: 'hostile' },
      { classId: 'corvette', allegiance: 'hostile' },
      { classId: 'corvette', allegiance: 'hostile' },
    ],
  },
  {
    // Same shape as Raider King's Escort (a numbers-disadvantaged player
    // force against a capital ship + corvette escorts, EHP/DPS ratios close
    // to it by design) but a different player composition for real variety
    // rather than a reskin. Verified to the same standard that scenario was:
    // 0/16 across every stance, zero player input. Not separately proven
    // winnable by a scripted "focus the weakest enemy" pilot — but neither
    // is Raider King's Escort under the identical script, so this isn't held
    // to a stricter bar than the scenario already shipped; both presumably
    // need genuine real-time positioning/chaff-timing a simple heuristic
    // doesn't capture.
    id: 'hard-cruiser-corvette-vs-battleship-escort',
    name: "Dreadnought's Shadow",
    difficulty: 'hard',
    bodyName: 'Earth',
    description:
      'A cruiser and a corvette against a battleship escorted by two corvettes. 0/16 on Balanced, Kite, Swarm, and Stall alike. The lever is the same as Raider King’s Escort: strip an escort corvette first to cut incoming DPS before the battleship grinds you down — no stance commits to that on its own.',
    ships: [
      { classId: 'cruiser', allegiance: 'player' },
      { classId: 'corvette', allegiance: 'player' },
      { classId: 'battleship', allegiance: 'hostile' },
      { classId: 'corvette', allegiance: 'hostile' },
      { classId: 'corvette', allegiance: 'hostile' },
    ],
  },
]

export const SCENARIO_DIFFICULTY_LABELS: Record<ScenarioDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}
