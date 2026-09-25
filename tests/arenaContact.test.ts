// Contact with ships in the combat arena, army colours, and a guard against the
// render crash that blanked the combat view.
//
// Run:  npx tsx tests/arenaContact.test.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PIRATES_ID, FRIENDLY_ROGUE_ID, NEUTRAL_ROGUE_ID } from '../src/data/countryRoster'
import { RELATION_COLORS } from '../src/data/shipData'
import { inDirectContact, playerCommsDelayToShip, queueStance } from '../src/scene/commsVisual'
import { syncEngagements } from '../src/scene/combatResolution'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { useCombatStore } from '../src/state/combatStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { usePlayerStore } from '../src/state/playerStore'
import { relationColorOf } from '../src/state/shipRelations'
import { useShipStore } from '../src/state/shipStore'
import { useViewStore } from '../src/state/viewStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'

console.log('\n=== 1. Direct contact inside the combat arena, comms delay outside it ===')
{
  useDiplomacyStore.getState().reset()
  usePlayerStore.getState().selectCountry(MARS)
  useShipStore.setState({ ships: [] })
  useGameTimeStore.setState({ simDays: 0 })
  // A Mars ship at another star, fighting pirates there — far from the capital.
  const mine = spawnOwnedShip('cruiser', MARS, 'alpha-centauri', 'Arcadia')!
  spawnOwnedShip('corvette', PIRATES_ID, 'alpha-centauri', 'Arcadia')
  const ships = useShipStore.getState().ships
  const ship = ships.find((s) => s.id === mine)!
  const engagements = syncEngagements(ships, [], 0)
  useCombatStore.setState({ engagements })

  useViewStore.setState({ level: 'system', combatEngagementId: null })
  const outside = playerCommsDelayToShip(ship, 0)
  check('out on the map, a ship at another star is behind comms delay', outside > 0, `${outside.toFixed(1)} days`)
  check('...and not in direct contact', !inDirectContact(ship))
  queueStance(ship, 'kite')
  const queued = useShipStore.getState().ships.find((s) => s.id === mine)!
  check('a stance ordered from the map queues behind the delay', queued.pendingStance?.stance === 'kite' && queued.stance !== 'kite')
  useShipStore.getState().setPendingStance(mine, null)

  useViewStore.setState({ level: 'combat', combatEngagementId: engagements[0].id })
  check('inside the arena it is in direct contact', inDirectContact(ship))
  check('...with no comms delay at all', playerCommsDelayToShip(ship, 0) === 0)
  queueStance(ship, 'swarm')
  check('a stance ordered from inside the arena applies at once', useShipStore.getState().ships.find((s) => s.id === mine)!.stance === 'swarm')

  // Only the arena the player is looking at.
  spawnOwnedShip('cruiser', MARS, 'sol', 'Mars')
  const elsewhere = useShipStore.getState().ships.find((s) => s.location.kind === 'orbiting' && s.location.bodyName === 'Mars')!
  check("a ship that isn't in that arena isn't in direct contact", !inDirectContact(elsewhere))
  useViewStore.setState({ level: 'system', combatEngagementId: null })
  useCombatStore.setState({ engagements: [] })
  useShipStore.setState({ ships: [] })
}

console.log('\n=== 2. Armies are coloured by alliance, not nation ===')
{
  useDiplomacyStore.getState().reset()
  usePlayerStore.getState().selectCountry(MARS)
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  check('your own are green', relationColorOf(MARS) === RELATION_COLORS.own)
  check('a nation at war with you is red', relationColorOf(VENUS) === RELATION_COLORS.enemy)
  check('pirates are red', relationColorOf(PIRATES_ID) === RELATION_COLORS.enemy)
  check('friendly irregulars are blue', relationColorOf(FRIENDLY_ROGUE_ID) === RELATION_COLORS.allied)
  check('a nation at peace with you is yellow', relationColorOf('orion-republic') === RELATION_COLORS.neutral)
  check('neutral traders are yellow', relationColorOf(NEUTRAL_ROGUE_ID) === RELATION_COLORS.neutral)
  const wars = useDiplomacyStore.getState().wars
  useDiplomacyStore.getState().endWar(wars[0].id, 10)
  check('...and colours follow the diplomacy: peace turns a former enemy yellow', relationColorOf(VENUS) === RELATION_COLORS.neutral)
  // Nations don't have colours of their own here: two different peaceful
  // nations look the same.
  check('two different neutral nations share one colour', relationColorOf('orion-republic') === relationColorOf(VENUS))
}

console.log('\n=== 3. No component calls a hook after an early return ===')
{
  // A hook after `if (...) return null` runs a different number of hooks on the
  // renders where the condition holds — React throws "rendered fewer hooks
  // than expected". CombatShipMarker did exactly this and blanked the combat
  // view the moment a ship in it was destroyed. This is a source-level scan of
  // every component: top-level `if (...) return` at function indent, then a
  // hook call at the same indent later in the same function.
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) files.push(p)
    }
  }
  walk('src')
  const offenders: string[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    let earlyReturnAt = 0
    lines.forEach((line, i) => {
      if (line === '}' || /^(export )?(default )?function /.test(line)) earlyReturnAt = 0
      if (/^  if \(.*\) return( null|;|<|\b)/.test(line) && !line.includes('{')) earlyReturnAt = i + 1
      else if (earlyReturnAt && /^  (const .* = |let .* = )?use[A-Z]\w*\(/.test(line)) offenders.push(`${file}:${i + 1} (early return at line ${earlyReturnAt})`)
    })
  }
  check('no hook follows a top-level early return', offenders.length === 0, offenders.join('; '))
  check('the scan covers the combat markers', files.some((f) => f.endsWith('CombatShipMarker.tsx')))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
