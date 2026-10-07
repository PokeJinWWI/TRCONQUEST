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
//            a plan: pull the front army back while the reserve marches
//            forward to meet it, link up, then counter-attack together
//            (advance on the enemy, halting to fire whenever one is in range).
//            It is a real win — the tests run that plan — but it takes real
//            play, unit by unit, and it must start at once: once the enemy is
//            on the front army in a terrain battle it cannot break away (the
//            battle's patch is 7 cells across, and its edge is a wall).
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
  // A reserve digs in on this ground when it can (a field battle's "fall back to
  // the hills"); the scenario's battlefield is chosen to have some that far back.
  rearTerrain?: TerrainId
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
    // A real place (degrees east, north) to fight near: the nearest fitting
    // ground to it is used. Omitted: the first fitting ground on the map.
    near?: [number, number]
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
    battlefield: { bodyName: 'Earth', playerTerrain: 'plains', gapCells: 6, near: [27, -15] },
    description:
      'Two assault armies on open plains meet a marine army at 60% strength coming ashore. Left alone they win comfortably — verified with no orders at all.',
    player: [{ kind: 'assault' }, { kind: 'assault' }],
    enemy: [{ kind: 'marine', strengthFraction: 0.3 }],
  },
  {
    id: 'army-easy-dunes-patrol',
    name: 'Dunes Patrol',
    difficulty: 'easy',
    battlefield: { bodyName: 'Earth', playerTerrain: 'desert', gapCells: 6, near: [24, 23] },
    description:
      'An assault army and a marine army hold a stretch of desert against a marine army at 80% strength. Left alone they win, verified with no orders at all.',
    player: [{ kind: 'assault' }, { kind: 'marine' }],
    enemy: [{ kind: 'marine', strengthFraction: 0.3 }],
  },

  // --- Medium ------------------------------------------------------------
  {
    id: 'army-medium-split-command',
    name: 'Split Command',
    difficulty: 'medium',
    battlefield: { bodyName: 'Earth', playerTerrain: 'plains', gapCells: 6, near: [27, -15] },
    description:
      'Two assault armies against a stronger and a weaker one — but only one of yours is on the line; the other starts five cells back. Left alone the front army is destroyed and the reserve never gets into the fight. Order the reserve up to the line before the enemy arrives and the combined force wins.',
    player: [{ kind: 'assault' }, { kind: 'assault', rearCells: 5 }],
    enemy: [{ kind: 'assault' }, { kind: 'assault', strengthFraction: 0.65 }],
  },
  {
    id: 'army-medium-reserve-in-the-timber',
    name: 'Reserve in the Timber',
    difficulty: 'medium',
    battlefield: { bodyName: 'Earth', playerTerrain: 'forest', gapCells: 6, near: [14, 52] },
    description:
      'A marine army dug into forest, its twin five cells behind it, against an assault army and a weakened marine army. Left alone the front army is destroyed and the reserve never fights. Order the reserve up to the line and they win.',
    player: [{ kind: 'marine' }, { kind: 'marine', rearCells: 5 }],
    enemy: [{ kind: 'assault' }, { kind: 'marine', strengthFraction: 0.3 }],
  },

  // --- Hard --------------------------------------------------------------
  {
    id: 'army-hard-fall-back-to-the-woods',
    name: 'Fall Back to the Woods',
    difficulty: 'hard',
    battlefield: { bodyName: 'Earth', playerTerrain: 'forest', gapCells: 7, near: [19, -4] },
    description:
      'An assault army on the forest line in the Congo basin, its twin eight cells back in the woods, against two assault armies and a small marine force. Left alone the front army dies alone. Marching the reserve up to the line loses too. What works is acting at once: pull the front army back while the reserve comes forward to meet it, link up, and counter-attack together. Wait until the enemy is on top of the front army and it cannot get away.',
    player: [{ kind: 'assault' }, { kind: 'assault', rearCells: 8, rearTerrain: 'forest' }],
    enemy: [{ kind: 'assault' }, { kind: 'assault' }, { kind: 'marine', strengthFraction: 0.3 }],
  },
  {
    id: 'army-medium-outnumbered-on-the-ice',
    name: 'Outnumbered on the Ice',
    difficulty: 'medium',
    battlefield: { bodyName: 'Pluto', playerTerrain: 'tundra', gapCells: 6, near: [180, -58] },
    description:
      'An assault army and a marine army on the ice of Pluto, the marines five cells back, against two assault armies. Left alone the line falls and the reserve never gets into the fight. March the reserve up to the line before the enemy arrives and the combined force wins.',
    player: [{ kind: 'assault' }, { kind: 'marine', rearCells: 5 }],
    enemy: [{ kind: 'assault' }, { kind: 'assault' }],
  },
]

export const ARMY_SCENARIO_DIFFICULTY_LABELS: Record<ArmyScenarioDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}
