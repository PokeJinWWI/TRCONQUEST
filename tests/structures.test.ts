// Buildings pointed at on the map (state/structureStore, scene/portStructures, defenseStore nodes): a world's auto-placed spaceports
// become structures at the nodes they already had (nothing moves), a port can be named, a new port stands where the player chose
// and only counts once the economy has built it, and a defence installation takes a chosen place and a name.
//
// Run:  npx tsx tests/structures.test.ts
import { groundKeySurface, useDefenseStore } from '../src/state/defenseStore'
import { spaceportSitesOf } from '../src/state/nationEconomy'
import { keyNamesOf } from '../src/scene/keyNames'
import { judgePortNode, placePort, reconcilePorts, renamePort, seedPorts } from '../src/scene/portStructures'
import { ensureSeeded } from '../src/scene/seedPlacementOrders'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { surfaceOf, terrainAt } from '../src/scene/planetTerrain'
import { surfaceMesh, arc, nodePoint } from '../src/scene/surfaceMesh'
import { judgeInstallationNode } from '../src/scene/defenseLogic'
import { useStructureStore } from '../src/state/structureStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { applySave, createSave } from '../src/state/saveGame'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const MARS = 'imperial-state-of-mars'
const ports = (bodyName: string) => groundKeySurface(bodyName)!.keySlots.filter((k) => k.kind === 'spaceport')

console.log('\n=== 1. Spaceports become structures where they already were ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  const before = ports('Mars').map((k) => k.node)
  const labelsBefore = [...keyNamesOf(groundKeySurface('Mars')!).values()].map((n) => n.label).sort().join('|')
  ensureSeeded('Mars')
  seedPorts('Mars')
  const list = useStructureStore.getState().ports['Mars'] ?? []
  check('Mars has spaceports to record', before.length > 1, `${before.length} ports`)
  const after = ports('Mars').map((k) => k.node)
  check('the key nodes are exactly the ones the map had', JSON.stringify([...before].sort()) === JSON.stringify([...after].sort()))
  check('every auto-placed port is recorded (the terrain\'s own is not)', list.length === spaceportSitesOf('Mars').length - ports('Mars').filter((k) => !k.site).length)
  // Seeding draws the districts, and every urban area becomes a key node of its own (scene/footprintState.withAreaKeys): those are
  // new; every node the map had keeps its name.
  const afterSurface = groundKeySurface('Mars')!
  const areaNodes = new Set(afterSurface.keySlots.filter((k) => k.area).map((k) => k.node))
  check('the names the map gave are unchanged', [...keyNamesOf(afterSurface)].filter(([node]) => !areaNodes.has(node)).map(([, n]) => n.label).sort().join('|') === labelsBefore)
  seedPorts('Mars')
  check('seeding twice records them once', (useStructureStore.getState().ports['Mars'] ?? []).length === list.length)

  console.log('\n=== 2. Naming a port ===')
  const target = list[0]
  const autoLabel = keyNamesOf(groundKeySurface('Mars')!).get(target.node)!.label
  renamePort('Mars', target.id, 'Ares Gate')
  const named = keyNamesOf(groundKeySurface('Mars')!).get(target.node)!
  check('a renamed port shows its name on the map', named.label === 'Ares Gate' && named.name === 'Ares Gate', `${autoLabel} -> ${named.label}`)
  check('...at the same node', ports('Mars').some((k) => k.node === target.node))
  renamePort('Mars', target.id, '   ')
  check('an empty name goes back to the map\'s own', keyNamesOf(groundKeySurface('Mars')!).get(target.node)!.label === autoLabel)
  renamePort('Mars', target.id, 'X'.repeat(80))
  check('names are kept short', (useStructureStore.getState().ports['Mars']?.[0].name ?? '').length <= 40)
  renamePort('Mars', target.id, 'Ares Gate')

  console.log('\n=== 3. Choosing where a new port stands ===')
  const surface = surfaceOf('Mars', 'capital')
  const mesh = surfaceMesh()
  const keyed = groundKeySurface('Mars')!
  let spot = -1
  for (let i = 0; i < mesh.count.fine && spot < 0; i += 7) {
    if (surface.landComponent[i] >= 0 && terrainAt(surface, i) === 'plains' && judgePortNode(keyed, i).ok && keyed.keySlots.every((k) => arc(nodePoint(k.node), nodePoint(i)) > 0.4)) spot = i
  }
  check('there is open plains to put a port on', spot >= 0)
  check('the sea and key sites are refused', !judgePortNode(keyed, keyed.keySlots[0].node).ok)
  for (const r of ['minerals', 'alloys', 'energy'] as const) useResourceStore.getState().setAmount(MARS, r, 100000)
  const nBefore = spaceportSitesOf('Mars').length
  const placed = placePort(MARS, 'Mars', spot, 'Port Gale')
  check('ordering it at the chosen place works', placed.ok, placed.ok ? '' : placed.reason)
  check('...the port is recorded where the player clicked, with its name', placed.ok && useStructureStore.getState().ports['Mars'].some((p) => p.node === spot && p.name === 'Port Gale' && p.chosen))
  check('...but it is not a key node until the economy has built it', spaceportSitesOf('Mars').length === nBefore && !ports('Mars').some((k) => k.node === spot))
  const refused = placePort('republic-of-venus', 'Mars', spot)
  check('a nation cannot place a port on someone else\'s world', !refused.ok)

  // A second port is ordered somewhere else and the order is cancelled: no ghost is left behind.
  let spot2 = -1
  const keyed2 = groundKeySurface('Mars')!
  for (let i = 3; i < mesh.count.fine && spot2 < 0; i += 13) {
    if (surface.landComponent[i] >= 0 && terrainAt(surface, i) === 'plains' && judgePortNode(keyed2, i).ok && arc(nodePoint(i), nodePoint(spot)) > 0.5 && keyed2.keySlots.every((k) => arc(nodePoint(k.node), nodePoint(i)) > 0.4)) spot2 = i
  }
  const second = spot2 >= 0 ? placePort(MARS, 'Mars', spot2) : { ok: false as const, reason: 'no second spot' }
  check('a second port can be ordered', second.ok, second.ok ? '' : second.reason)
  const spaceportOrder = useAbstractEconomyStore.getState().byCountry[MARS].queue.filter((o) => o.building === 'spaceport').pop()
  if (spaceportOrder) useAbstractEconomyStore.getState().cancelOrder(MARS, spaceportOrder.id)
  reconcilePorts('Mars')
  check('cancelling it leaves no ghost structure (the first, still on order, stays)', !useStructureStore.getState().ports['Mars'].some((p) => p.node === spot2) && useStructureStore.getState().ports['Mars'].some((p) => p.node === spot))

  // The economy builds it: the order leaves the queue, the count rises and the port appears where it was chosen, named.
  useAbstractEconomyStore.setState((st) => ({ byCountry: { ...st.byCountry, [MARS]: { ...st.byCountry[MARS], queue: st.byCountry[MARS].queue.filter((o) => o.building !== 'spaceport') } } }))
  useAbstractEconomyStore.setState((st) => {
    const w = st.worlds['Mars']
    return { worlds: { ...st.worlds, Mars: { ...w, buildings: { ...w.buildings, spaceport: (w.buildings.spaceport ?? 0) + 1 } } } }
  })
  const built = ports('Mars').find((k) => k.node === spot)
  check('once built it is a key node at that place, with the name', !!built && keyNamesOf(groundKeySurface('Mars')!).get(spot)!.label === 'Port Gale')

  console.log('\n=== 4. Orders that never finish do not leave a ghost port ===')
  useAbstractEconomyStore.setState((st) => {
    const w = st.worlds['Mars']
    return { worlds: { ...st.worlds, Mars: { ...w, buildings: { ...w.buildings, spaceport: (w.buildings.spaceport ?? 0) - 1 } } } }
  })
  reconcilePorts('Mars')
  check('a demolished port gives its structure up (the latest first)', !useStructureStore.getState().ports['Mars'].some((p) => p.node === spot))
  check('...and the seeded ones are untouched', useStructureStore.getState().ports['Mars'].length === list.length)

  console.log('\n=== 5. Save and load ===')
  renamePort('Mars', useStructureStore.getState().ports['Mars'][0].id, 'Kept Name')
  const file = JSON.parse(JSON.stringify(await createSave('structures')))
  resetGame()
  check('a reset forgets the structures', Object.keys(useStructureStore.getState().ports).length === 0)
  await applySave(file)
  check('they come back with a load, names and all', useStructureStore.getState().ports['Mars']?.[0].name === 'Kept Name')
  resetGame()
}

console.log('\n=== 6. A defence installation at a chosen place ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  useGameTimeStore.getState().setPaused?.(true)
  const keyed = groundKeySurface('Mars')!
  const existing = useDefenseStore.getState().installations
  check('a key site is not a place for it', !judgeInstallationNode(keyed, existing, keyed.keySlots[0].node).ok)
  const sea = (() => {
    for (let i = 0; i < keyed.landComponent.length; i++) if (keyed.landComponent[i] !== keyed.mainland) return i
    return -1
  })()
  check('...nor ground off the mainland', sea < 0 || !judgeInstallationNode(keyed, existing, sea).ok)
  let spot = -1
  for (let i = 0; i < keyed.landComponent.length && spot < 0; i += 11) if (judgeInstallationNode(keyed, existing, i).ok) spot = i
  check('there is a place for one', spot >= 0)
  for (const r of ['minerals', 'alloys', 'energy', 'exoticMatter'] as const) useResourceStore.getState().setAmount(MARS, r, 100000)
  const made = useDefenseStore.getState().build(MARS, 'Mars', 'fortress', 0, { node: spot, name: '  Iron Wall  ' })
  const inst = useDefenseStore.getState().installations.find((i) => i.name === 'Iron Wall')
  check('a fortress goes up at the chosen place, with its name', made.ok && inst?.node === spot, made.ok ? '' : made.reason)
  const crowd = useDefenseStore.getState().build(MARS, 'Mars', 'fortress', 0, { node: spot })
  check('a second one cannot crowd it', !crowd.ok)
  if (inst) {
    useDefenseStore.getState().renameInstallation(inst.id, 'Granite Wall')
    check('it can be renamed, and un-named', useDefenseStore.getState().installations.find((i) => i.id === inst.id)?.name === 'Granite Wall')
    useDefenseStore.getState().renameInstallation(inst.id, '')
    check('...an empty name removes it', useDefenseStore.getState().installations.find((i) => i.id === inst.id)?.name === undefined)
  }
  void useTerritoryStore
}

console.log(failures ? `\n${failures} FAILED` : '\nAll structure checks passed')
process.exit(failures ? 1 : 0)
