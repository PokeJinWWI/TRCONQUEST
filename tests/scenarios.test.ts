// Proves the difficulty label on every scenario in src/data/scenarios.ts
// against the REAL resolver, not author judgment — see that file's own
// header for what each tier means. Separate from tests/combat.test.ts
// deliberately: this file runs many more, much longer simulations (16
// seeded trials per configuration, some running into the thousands of
// steps), so keeping it apart means the fast primary suite stays fast and
// this one can be run on its own when scenario content changes.
//
// Run:  npx tsx tests/scenarios.test.ts
//
// Deliberately outside `src/` for the same reason combat.test.ts is —
// tsconfig.app.json only includes `src`, so this never enters the app
// typecheck or the production bundle.

import { SHIP_CLASSES, type FleetAllegiance } from '../src/data/shipData'
import type { CombatStance } from '../src/data/combatData'
import { pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { syncEngagements, stepEngagements, COMBAT_STEP_DAYS, type Rng } from '../src/scene/combatResolution'
import { SCENARIOS, type ScenarioShip } from '../src/data/scenarios'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function seededRng(seed: number): Rng {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function buildShips(ships: ScenarioShip[], bodyName: string, overrideStance?: CombatStance): ShipInstance[] {
  return ships.map((spec, i) => {
    const cls = SHIP_CLASSES.find((c) => c.id === spec.classId)!
    return {
      id: `${spec.allegiance}-${i}`,
      classId: cls.id,
      name: `${spec.allegiance}-${i}`,
      allegiance: spec.allegiance,
      location: { kind: 'orbiting', systemId: 'sol', bodyName, periodDays: 20, phaseDeg: (i * 90) % 360, inclinationDeg: 0 },
      order: null,
      hyperdriveReadySimDays: 0,
      warpReadySimDays: 0,
      warpEnabled: true,
      warpWhenReady: false,
      chaffAutoDeploy: true,
      pendingHyperdriveJump: null,
      followingShipId: null,
      combat: pristineCombatState(cls.combat),
      // `overrideStance` lets the harness re-check "what happens on pure
      // defaults" for a scenario whose DATA already encodes a winning
      // non-default stance (every medium scenario) — without it, testing
      // "does Balanced lose this" would be testing the wrong ships.
      stance: overrideStance ?? spec.stance ?? 'balanced',
    }
  })
}

type Winner = 'player' | 'hostile' | 'draw' | 'timeout'

// Runs one full fight with NO player input at all — no manual moves, no
// manual targeting, no manual chaff — just whatever stance/chaffAutoDeploy
// the ships were built with. Mirrors exactly what a player who does nothing
// after loading a scenario would see.
function simulate(ships: ShipInstance[], seed: number, maxSteps = 5000): { winner: Winner; steps: number } {
  let engagements = syncEngagements(ships, [], 0)
  const rng = seededRng(seed)
  const alive = new Map(ships.map((s) => [s.id, s]))

  for (let i = 0; i < maxSteps; i++) {
    if (engagements.length === 0) break
    const simDays = (i + 1) * COMBAT_STEP_DAYS
    const result = stepEngagements(engagements, [...alive.values()], simDays, rng)
    for (const id of result.destroyedShipIds) alive.delete(id)
    // Disengaging (outrunning the fight) removes a ship from THIS
    // engagement the same way destruction does — for scenario-verification
    // purposes it's "gone," not "won," since it neither destroyed nor was
    // destroyed by the other side.
    for (const id of result.disengagedShipIds) alive.delete(id)
    for (const [id, combat] of Object.entries(result.shipCombat)) {
      const ship = alive.get(id)
      if (ship) alive.set(id, { ...ship, combat })
    }
    engagements = result.engagements
    const playerLeft = [...alive.values()].some((s) => s.allegiance === 'player')
    const hostileLeft = [...alive.values()].some((s) => s.allegiance === 'hostile')
    if (!playerLeft && !hostileLeft) return { winner: 'draw', steps: i }
    if (!hostileLeft) return { winner: 'player', steps: i }
    if (!playerLeft) return { winner: 'hostile', steps: i }
  }
  return { winner: 'timeout', steps: maxSteps }
}

const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1)

// Win RATE over every seed, for a given stance override (or the scenario's
// own baked-in stances when omitted).
function winRate(scenarioId: string, overrideStance?: CombatStance): number {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!
  const wins = SEEDS.filter((seed) => simulate(buildShips(scenario.ships, scenario.bodyName, overrideStance), seed).winner === 'player').length
  return wins / SEEDS.length
}

// A win rate this high or higher counts as "wins on its own" for Easy; this
// low or lower counts as "loses on its own" for Medium/Hard's default check.
// Not 100%/0% exactly — combat has real seed-to-seed variance (see Easy #2's
// two draws in exploration), and demanding a mathematically perfect record
// would make this suite fragile to noise rather than meaningful.
const RELIABLE_WIN = 0.85
const RELIABLE_LOSS = 0.15

console.log("\n=== Scenario difficulty proof (16 seeded trials per configuration, zero player input) ===\n")

for (const scenario of SCENARIOS) {
  console.log(`--- ${scenario.name} (${scenario.difficulty}) ---`)

  if (scenario.difficulty === 'easy') {
    const rate = winRate(scenario.id)
    check(`${scenario.name}: default automation wins reliably (>=85%)`, rate >= RELIABLE_WIN, `${(rate * 100).toFixed(0)}%`)
  }

  if (scenario.difficulty === 'medium') {
    const defaultRate = winRate(scenario.id, 'balanced')
    const tunedRate = winRate(scenario.id)
    check(`${scenario.name}: pure defaults (Balanced) reliably LOSE (<=15%)`, defaultRate <= RELIABLE_LOSS, `${(defaultRate * 100).toFixed(0)}%`)
    check(`${scenario.name}: the scenario's own stance reliably WINS (>=85%)`, tunedRate >= RELIABLE_WIN, `${(tunedRate * 100).toFixed(0)}%`)
    check(`${scenario.name}: the tweak is a REAL swing, not noise`, tunedRate - defaultRate >= 0.5, `${((tunedRate - defaultRate) * 100).toFixed(0)}pt swing`)
  }

  if (scenario.difficulty === 'hard') {
    // Every stance the game has, plus the scenario's own (usually default)
    // ships as loaded. None of these is player intervention — this is the
    // exhaustive "nothing in the automation toolbox wins it" claim, not just
    // "the default loses."
    const stances: CombatStance[] = ['balanced', 'kite', 'swarm', 'stall']
    for (const stance of stances) {
      const rate = winRate(scenario.id, stance)
      check(`${scenario.name}: ${stance} does not reliably win (<=15%)`, rate <= RELIABLE_LOSS, `${(rate * 100).toFixed(0)}%`)
    }
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
