// Areas (scene/areas.ts): every connected patch of ONE district kind is one place. Towns that grow into each other merge, touching
// ground of different kinds stays apart, and on a live world every urban area is a key node and has exactly one municipal hall.
//
// Run:  npx tsx tests/areas.test.ts
import { groupAreas, areaAtNode } from '../src/scene/areas'
import { withSettlementHalls } from '../src/scene/civic'
import { areaKeySlots, bodyAreas } from '../src/scene/footprintState'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { ensureSeeded, syncCivicHalls } from '../src/scene/seedPlacementOrders'
import { zoneBase } from '../src/scene/zoneOrders'
import { developmentView } from '../src/scene/territoryView'
import { groundKeySurface } from '../src/state/defenseStore'
import { useCivicStore } from '../src/state/civicStore'
import { usePlayerStore } from '../src/state/playerStore'
import type { BodySurface } from '../src/scene/planetTerrain'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. Grouping (pure) ===')
{
  // A line of cells 0-1-2-...-9.
  const neighbors = Array.from({ length: 10 }, (_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < 10))
  const seeds = [
    { id: 'b#settlement-1', kind: 'settlement' as const, node: 0, rank: 2 },
    { id: 'b#settlement-0', kind: 'settlement' as const, node: 3, rank: 1 },
    { id: 'b#industrial-0', kind: 'industrial' as const, node: 5, rank: 2 },
    { id: 'b#settlement-2', kind: 'settlement' as const, node: 8, rank: 2 },
  ]
  const fps = [
    { siteId: 'b#settlement-1', cells: [0, 1, 2] },
    { siteId: 'b#settlement-0', cells: [3, 4] },
    { siteId: 'b#industrial-0', cells: [5, 6] },
    { siteId: 'b#settlement-2', cells: [7, 8] },
  ]
  const areas = groupAreas(seeds, fps, neighbors)
  const city = areas.find((a) => a.seedIds.includes('b#settlement-1'))!
  check('two towns whose ground touches are one area', city.seedIds.length === 2 && city.cells.length === 5)
  check('...named and placed by the better seed (a map city beats a plain town)', city.id === 'b#settlement-0' && city.node === 3)
  check('touching ground of another kind stays its own area (option B)', areas.length === 3 && areas.some((a) => a.kind === 'industrial' && a.seedIds.length === 1))
  check('a town cut off by other ground is its own area', areas.some((a) => a.id === 'b#settlement-2' && a.seedIds.length === 1))
  check('a node is found in the area that covers it', areaAtNode(areas, 6)?.kind === 'industrial')
  const split = groupAreas(seeds, fps.map((f) => (f.siteId === 'b#settlement-0' ? { ...f, cells: [4] } : f)), neighbors)
  check('when the link is gone the towns split back apart', split.filter((a) => a.kind === 'settlement').length === 3)
  // Halls: one per urban area, none twice.
  const halls = withSettlementHalls([], areas, () => true, (id) => id)
  check('one municipal hall per urban area', halls.length === 2 && halls.every((h) => h.kind === 'cityHall'))
  const withKeyHall = withSettlementHalls([{ id: 'key-3-hall', kind: 'cityHall', name: 'x', description: '', place: 'x', role: '', node: 3, siteId: 'b#settlement-0' }], areas, () => true, (id) => id)
  check('an area that already holds a key-node hall gets no second one, even through its other town', withKeyHall.length === 2 && !withKeyHall.some((h) => h.siteId === 'b#settlement-1' || h.id === 'hall-b#settlement-1'))
  // Key nodes.
  const base = { bodyName: 'b', keySlots: [{ node: 4, kind: 'city' }] } as unknown as BodySurface
  const slots = areaKeySlots(base, areas, {})
  check('an urban area holding a map city gets no extra key node; another urban area gets one', slots.length === 1 && slots[0].node === 8 && slots[0].kind === 'city')
}

console.log('\n=== 2. Earth in a real game ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'imperial-state-of-mars', sandbox: false, economyModel: 'abstract' })
  setUpNewGame()
  for (const body of ['Earth', 'Mars']) {
    ensureSeeded(body)
    syncCivicHalls(body)
    const areas = bodyAreas(body, zoneBase(body)!)
    const urban = areas.filter((a) => a.kind === 'settlement')
    const surface = groundKeySurface(body)!
    const civic = useCivicStore.getState().civic[body] ?? []
    const keyed = urban.filter((a) => surface.keySlots.some((k) => (k.kind === 'capital' || k.kind === 'city' || k.kind === 'outpost') && a.cells.concat(a.node ?? -1).includes(k.node)))
    check(`${body}: every urban area is a key node`, keyed.length === urban.length, `${keyed.length}/${urban.length}`)
    const hallsPer = urban.map((a) => civic.filter((c) => (c.kind === 'cityHall' || c.kind === 'seat' || c.kind === 'outpostStation') && c.siteId && a.seedIds.includes(c.siteId)).length)
    check(`${body}: every urban area has its hall (or the seat / an outpost station)`, hallsPer.every((n) => n >= 1), hallsPer.join(','))
    const view = developmentView(body, 'imperial-state-of-mars')
    check(`${body}: the Development view lists areas, each with a name`, view.areas.length === areas.length && view.areas.every((a) => a.name.length > 0))
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nAll area checks passed')
process.exit(failures ? 1 : 0)
