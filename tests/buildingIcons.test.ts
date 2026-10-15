// Every building has an icon (components/planet/PlanetIcons.buildingIconId), in every list: Simple's roster, Complex's recipes (by group),
// the defences and the standalone buildings. Nothing falls back to the empty square.
//
// Run:  npx tsx tests/buildingIcons.test.ts
import React from 'react'
;(globalThis as unknown as { React: typeof React }).React = React
const { buildingIconId, hasPlanetIcon } = await import('../src/components/planet/PlanetIcons')
const { RECIPES, buildingGroup } = await import('../src/economy/recipes')
const { SIMPLE_BUILDING_DEFS } = await import('../src/data/simplisticEconomyData')
const { DEFENSE_KINDS } = await import('../src/data/defenseData')

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const missingSimple = Object.keys(SIMPLE_BUILDING_DEFS).filter((b) => !hasPlanetIcon(b))
check('every Simple building has its own icon', missingSimple.length === 0, missingSimple.join(', '))
const missingGroups = [...new Set(Object.values(RECIPES).map((r) => buildingGroup(r.id)))].filter((g) => !hasPlanetIcon(g))
check('every Complex building group has an icon', missingGroups.length === 0, missingGroups.join(', '))
check('every Complex recipe resolves to a real icon', Object.values(RECIPES).every((r) => hasPlanetIcon(buildingIconId(r.id))))
check('every defence has its own icon', DEFENSE_KINDS.every((k) => hasPlanetIcon(k)))
check('the standalone and transport buildings have their own', ['spaceport', 'seaport', 'roadNetwork', 'spaceElevatorAnchor', 'fortress', 'defenseBattery', 'shieldGenerator'].every((id) => hasPlanetIcon(buildingIconId(id)) && buildingIconId(id) === id))
check('something that is not a building falls back to the civic icon, never to nothing', hasPlanetIcon(buildingIconId('no-such-building')))
console.log(failures ? `\n${failures} FAILED` : '\nAll building icon checks passed')
process.exit(failures ? 1 : 0)
