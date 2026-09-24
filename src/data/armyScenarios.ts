// Pre-built ground battles, for the sandbox and the dev Debug Console — the
// army counterpart of the ship scenarios in ./scenarios.ts, at the same three
// tiers, but defined by what ORDERS it takes to win rather than by which
// automation setting does. Nothing here is author judgment: every claim in a
// description came from running the scenario through the real ground
// resolver (`stepGroundWar`) — see tests/armyScenarios.test.ts for the
// permanent, re-runnable proof; this file is just the data. The ground war has
// no randomness, so one run per configuration is the whole answer (the ship
// scenarios need 16 seeded trials; these need one).
//
// What the player's units do by default is nothing: they hold where they
// stand, dig in, and fire on whatever comes into range (the ground AI drives
// every nation's units but the player's — see groundAI.ts). The enemy is
// given its first move, a march on the player's line (armyScenario.ts), and
// holds wherever it meets resistance.
//
//   easy   — leaving your army alone wins. Nothing to learn from the loss
//            column: this is just a stronger force on the ground.
//   medium — leaving your army alone loses (the front army is destroyed and
//            the reserve, out of range, never fights), but ONE order wins:
//            bring the reserve up to the front line before the enemy arrives.
//   hard   — leaving it alone loses, and so does that one order. Winning takes
//            a plan: fall back onto the reserve, link up, then counter-attack
//            together (advance on the enemy, halting to fire whenever one is
//            in range). It is a real win — the tests run that plan — but it
//            takes real play, unit by unit.
//
// Every battle is on Earth: continental ground with plains, forest, desert,
// tundra and mountains, and nobody's territory in either a normal game or the
// sandbox, so a scenario is a field battle and never a war for a world.
import type { ArmyKind } from './armyData'
import type { TerrainId } from './groundData'

export type ArmyScenarioDifficulty = 'easy' | 'medium' | 'hard'

export interface ArmyScenarioForce {
  kind: ArmyKind
  // Share of full strength (default 1).
  strengthFraction?: number
  // Starts this many map cells back from the line, away from the enemy — a
  // reserve. Omitted: it stands on the line.
  rearCells?: number
}

export interface ArmyScenario {
  id: string
  name: string
  difficulty: ArmyScenarioDifficulty
  battlefield: {
    bodyName: string
    // The terrain the player's line stands on.
    playerTerrain: TerrainId
    // How many map cells away the enemy starts.
    gapCells: number
  }
  description: string
  // The player's forces (owned by the player's nation, or in the sandbox the
  // player's own faction) and the enemy's.
  player: ArmyScenarioForce[]
  enemy: ArmyScenarioForce[]
}

export const ARMY_SCENARIOS: ArmyScenario[] = [
  // --- Easy --------------------------------------------------------------
  {
    id: 'army-easy-landing-party',
    name: 'Landing Party',
    difficulty: 'easy',
    battlefield: { bodyName: 'Earth', playerTerrain: 'plains', gapCells: 6 },
    description:
      'Two assault armies on open plains meet a marine army at 60% strength coming ashore. Left alone they win comfortably — verified with no orders at all.',
    player: [{ kind: 'assault' }, { kind: 'assault' }],
    enemy: [{ kind: 'marine', strengthFraction: 0.6 }],
  },
  {
    id: 'army-easy-dunes-patrol',
    name: 'Dunes Patrol',
    difficulty: 'easy',
    battlefield: { bodyName: 'Earth', playerTerrain: 'desert', gapCells: 6 },
    description:
      'An assault army and a marine army hold a stretch of desert against a marine army at 80% strength. Left alone they win, verified with no orders at all.',
    player: [{ kind: 'assault' }, { kind: 'marine' }],
    enemy: [{ kind: 'marine', strengthFraction: 0.8 }],
  },

  // --- Medium ------------------------------------------------------------
  {
    id: 'army-medium-split-command',
    name: 'Split Command',
    difficulty: 'medium',
    battlefield: { bodyName: 'Earth', playerTerrain: 'plains', gapCells: 6 },
    description:
      'Two assault armies against two — but only one is on the line; the other starts five cells back. Left alone the front army is destroyed and the reserve never gets into the fight. Order the reserve up to the line before the enemy arrives and the combined force wins.',
    player: [{ kind: 'assault' }, { kind: 'assault', rearCells: 5 }],
    enemy: [{ kind: 'assault' }, { kind: 'assault' }],
  },
  {
    id: 'army-medium-reserve-in-the-timber',
    name: 'Reserve in the Timber',
    difficulty: 'medium',
    battlefield: { bodyName: 'Earth', playerTerrain: 'forest', gapCells: 6 },
    description:
      'A marine army dug into forest, its twin five cells behind it, against an assault army and a marine army. Left alone the front army is destroyed and the reserve never fights. Order the reserve up to the line and they win.',
    player: [{ kind: 'marine' }, { kind: 'marine', rearCells: 5 }],
    enemy: [{ kind: 'assault' }, { kind: 'marine' }],
  },

  // --- Hard --------------------------------------------------------------
  {
    id: 'army-hard-fall-back-to-the-woods',
    name: 'Fall Back to the Woods',
    difficulty: 'hard',
    battlefield: { bodyName: 'Earth', playerTerrain: 'forest', gapCells: 6 },
    description:
      'An assault army on the forest line, its twin seven cells back, against two assault armies. Left alone the front army dies alone. Marching the reserve up to the line loses too. What works is falling back onto the reserve, linking up, and counter-attacking together.',
    player: [{ kind: 'assault' }, { kind: 'assault', rearCells: 7 }],
    enemy: [{ kind: 'assault' }, { kind: 'assault' }],
  },
  {
    id: 'army-hard-outnumbered-on-the-ice',
    name: 'Outnumbered on the Ice',
    difficulty: 'hard',
    battlefield: { bodyName: 'Earth', playerTerrain: 'tundra', gapCells: 6 },
    description:
      'An assault army and a marine army against three assault armies, the marines five cells back. Left alone the line falls, and bringing the reserve up doesn’t save it. A plan that wins: fall back onto the reserve, link up, and counter-attack together.',
    player: [{ kind: 'assault' }, { kind: 'marine', rearCells: 5 }],
    enemy: [{ kind: 'assault' }, { kind: 'assault' }, { kind: 'assault' }],
  },
]

export const ARMY_SCENARIO_DIFFICULTY_LABELS: Record<ArmyScenarioDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}
