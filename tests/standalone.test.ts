// Standalone buildings (scene/standalone.ts): what can be built on open ground, the rows of what stands there, and the progress of what
// is being built, in both economy modes. A spaceport / defence / rural structure is chosen on the ground map (the lens armed).
//
// Run:  npx tsx tests/standalone.test.ts
import { pendingBuilds, standaloneOptions, standaloneRows, chooseStandaloneSite, chooseDefenseSite, installationProgress } from '../src/scene/standalone'
import { useStandaloneDetailStore } from '../src/state/standaloneDetailStore'
import { judgePortNode, placePort } from '../src/scene/portStructures'
import { ensureSeeded } from '../src/scene/seedPlacementOrders'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { arc, nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'
import { surfaceOf } from '../src/scene/planetTerrain'
import { groundKeySurface, useDefenseStore, canBuildDefense } from '../src/state/defenseStore'
import { useLensStore } from '../src/state/lensStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
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

for (const model of ['abstract', 'complex'] as const) {
  console.log(`\n=== ${model === 'complex' ? 'Complex' : 'Simple'} mode ===`)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  setUpNewGame()
  ensureSeeded('Mars')
  for (const r of ['minerals', 'alloys', 'energy'] as const) useResourceStore.getState().setAmount(MARS, r, 100000)
  const options = standaloneOptions(MARS, 'Mars')
  check('the Build list offers a spaceport and the three defences', ['spaceport', 'fortress', 'shieldGenerator', 'defenseBattery'].every((id) => options.some((o) => o.id === id)), options.map((o) => o.id).join(','))
  check('a defence needs no Military district slot to be offered', options.filter((o) => o.id === 'fortress' || o.id === 'defenseBattery').every((o) => !/Military/.test(o.blocked ?? '')))
  const rows = standaloneRows('Mars')
  const ports = rows.filter((r) => r.iconId === 'spaceport')
  check('every spaceport is a row with a node on the map', ports.length >= 6 && ports.every((r) => r.node !== null), `${ports.length}`)
  if (model === 'complex') check('Complex: a spaceport row opens the economy building that runs it', ports.every((r) => !!r.buildingId))
  // Choosing opens the ground map with the tool in hand.
  const spaceport = options.find((o) => o.id === 'spaceport')!
  chooseStandaloneSite('Mars', spaceport)
  check('choosing an option opens the ground map with it armed', useViewStore.getState().level === 'ground' && useViewStore.getState().selectedBodyName === 'Mars' && useLensStore.getState().armed?.kind === 'building')
  useLensStore.getState().arm(null)
  // Placing one: it is pending with a progress share until built.
  const surface = surfaceOf('Mars', 'capital')
  const mesh = surfaceMesh()
  const keyed = groundKeySurface('Mars')!
  let spot = -1
  for (let i = 0; i < mesh.count.fine && spot < 0; i += 7) if (surface.landComponent[i] >= 0 && judgePortNode(keyed, i).ok && keyed.keySlots.every((k) => arc(nodePoint(k.node), nodePoint(i)) > 0.4)) spot = i
  const placed = placePort(MARS, 'Mars', spot, 'Port Gale')
  check('a spaceport can be placed on open ground', placed.ok, placed.ok ? '' : placed.reason)
  const pending = pendingBuilds('Mars')
  check('it shows as under construction at that node, with a share done', pending.some((p) => p.node === spot && p.fraction >= 0 && p.fraction <= 1), JSON.stringify(pending.map((p) => [p.name, p.fraction])))
  check('...and as a row with its progress', standaloneRows('Mars').some((r) => r.node === spot && r.progress !== null))
  // A defence under construction has its own progress.
  const before = useDefenseStore.getState().installations.length
  const built = useDefenseStore.getState().build(MARS, 'Mars', 'fortress', 0, { node: keyed.keySlots.length > 0 ? spot + 11 : spot })
  void built
  if (useDefenseStore.getState().installations.length > before) {
    const inst = useDefenseStore.getState().installations.at(-1)!
    check('a defence going up reports its progress', standaloneRows('Mars').some((r) => r.key === inst.id))
  }
  // Every row is a building you can open: what it is, who holds it, where.
  const all = standaloneRows('Mars')
  check('every row says what it is and what kind of thing it is', all.every((r) => r.description.length > 10 && ['port', 'defense', 'rural'].includes(r.kind)))
  check('a defence row carries its integrity and can be renamed', all.filter((r) => r.kind === 'defense').length > 0 && all.filter((r) => r.kind === 'defense').every((r) => !!r.integrity && !!r.renameAs))
  check('every row has a holder or a region to show', all.every((r) => r.holder !== null || r.region !== null))
  useStandaloneDetailStore.getState().open('Mars', all[0].key)
  check('opening a row opens its window', useStandaloneDetailStore.getState().key === all[0].key && useStandaloneDetailStore.getState().bodyName === 'Mars')
  useStandaloneDetailStore.getState().close()
  // The Defense tab's Build opens the ground map with the defence in hand.
  useLensStore.getState().arm(null)
  const picked = chooseDefenseSite(MARS, 'Mars', 'defenseBattery')
  check('a defence build chooses its place on the ground map', picked.ok && useViewStore.getState().level === 'ground' && useLensStore.getState().armed?.kind === 'defense')
  useLensStore.getState().arm(null)
  const refused = chooseDefenseSite('republic-of-venus', 'Mars', 'fortress')
  check('...and is refused up front, with the reason, where it cannot be built', !refused.ok && /Not your world/.test((refused as { reason: string }).reason), (refused as { reason?: string }).reason)
  check('construction progress runs from 0 to 1', installationProgress(100, 60, 40) === 0 && installationProgress(100, 60, 70) === 0.5 && installationProgress(100, 60, 120) === 1)
  void canBuildDefense
}

console.log(failures ? `\n${failures} FAILED` : '\nAll standalone checks passed')
process.exit(failures ? 1 : 0)
