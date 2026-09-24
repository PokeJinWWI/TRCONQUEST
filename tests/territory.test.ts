// Territory: per-body borders, occupation, and system claims (see
// src/scene/territory.ts and src/state/territoryStore.ts).
//
// Run:  npx tsx tests/territory.test.ts

import { bodyStarId, controllerOf, isOccupied, seedBodyOwners, systemBodies, systemClaim } from '../src/scene/territory'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useEconomyStore, worldByName } from '../src/state/economyStore'

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
const ORION = 'orion-republic'
const LALANDE = 'kingdom-of-lalande'

console.log('\n=== 1. Starting borders come from the authored body data ===')
{
  const owners = seedBodyOwners()
  check('Mars owns Mars', owners['Mars'] === MARS)
  check('...and its moons Phobos and Deimos', owners['Phobos'] === MARS && owners['Deimos'] === MARS)
  check('...and Luna (a moon of a planet it does NOT own)', owners['Luna'] === MARS)
  check('Venus owns Venus', owners['Venus'] === VENUS)
  check('Earth is unclaimed', owners['Earth'] === undefined)
  check('Orion owns Arcadia', owners['Arcadia'] === ORION)
  check('Lalande owns its homeworld', owners['Lalande 21185 d'] === LALANDE)
  check('a moon knows which system it is in', bodyStarId('Luna') === 'sol' && bodyStarId('Arcadia') === 'alpha-centauri')
  check("a system's bodies include its planets' moons", systemBodies('sol').includes('Luna') && systemBodies('sol').includes('Titan'))
}

console.log('\n=== 2. System claims: "every claimed body", not "every body" ===')
{
  const owners = seedBodyOwners()
  const sol = systemClaim('sol', owners)
  check('Sol is contested between Mars and Venus', sol.kind === 'contested' && sol.countryIds.includes(MARS) && sol.countryIds.includes(VENUS) && sol.countryIds.length === 2)
  const ac = systemClaim('alpha-centauri', owners)
  check('Orion owns Alpha Centauri outright, despite its unclaimed dwarf planets', ac.kind === 'owned' && ac.countryId === ORION)
  check("Lalande owns its home system", (() => {
    const c = systemClaim('lalande-21185', owners)
    return c.kind === 'owned' && c.countryId === LALANDE
  })())
  check("Barnard's Star, with no claimed bodies, is unclaimed", systemClaim('barnards-star', owners).kind === 'unclaimed')
}

console.log('\n=== 3. Occupation is control, not ownership ===')
{
  useTerritoryStore.getState().reset()
  const store = useTerritoryStore.getState()
  store.occupyBody('Venus', MARS)
  let { bodyOwner, bodyController } = useTerritoryStore.getState()
  check('an occupied body keeps its owner', bodyOwner['Venus'] === VENUS)
  check('...but its controller is the occupier', controllerOf('Venus', bodyOwner, bodyController) === MARS)
  check('...and it reads as occupied', isOccupied('Venus', bodyOwner, bodyController))
  check("occupation doesn't redraw the system claim — Sol is still contested", systemClaim('sol', bodyOwner).kind === 'contested')
  check('an unoccupied body is controlled by its owner', controllerOf('Mars', bodyOwner, bodyController) === MARS && !isOccupied('Mars', bodyOwner, bodyController))

  useTerritoryStore.getState().occupyBody('Venus', VENUS)
  ;({ bodyOwner, bodyController } = useTerritoryStore.getState())
  check('its owner taking it back simply ends the occupation', !isOccupied('Venus', bodyOwner, bodyController) && !('Venus' in bodyController))

  useTerritoryStore.getState().occupyBody('Venus', MARS)
  useTerritoryStore.getState().liberateBody('Venus')
  check('liberateBody ends an occupation too', !isOccupied('Venus', useTerritoryStore.getState().bodyOwner, useTerritoryStore.getState().bodyController))
}

console.log('\n=== 4. Cession transfers ownership — and the world economy with it ===')
{
  useTerritoryStore.getState().reset()
  const venusWorldBefore = worldByName(useEconomyStore.getState().worlds, 'Venus')
  check('setup: Venus is an inhabited world owned by Venus in the economy', venusWorldBefore?.ownerId === VENUS)

  useTerritoryStore.getState().occupyBody('Venus', MARS)
  useTerritoryStore.getState().cedeBody('Venus', MARS)
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  check('the ceded body now belongs to the new owner', bodyOwner['Venus'] === MARS)
  check('...and is no longer "occupied" — the occupier owns it outright', !isOccupied('Venus', bodyOwner, bodyController))
  check('with Venus gone, Mars now claims all of Sol', (() => {
    const c = systemClaim('sol', bodyOwner)
    return c.kind === 'owned' && c.countryId === MARS
  })())
  check("the world's economy transferred with it", worldByName(useEconomyStore.getState().worlds, 'Venus')?.ownerId === MARS)

  useTerritoryStore.getState().cedeBody('Titan', MARS)
  check('ceding an uninhabited body works without touching the economy', useTerritoryStore.getState().bodyOwner['Titan'] === MARS)
}

console.log('\n=== 5. Front lines on the planetary map ===')
{
  useTerritoryStore.getState().reset()
  const t = () => useTerritoryStore.getState()
  t().paintNodes('Venus', { 10: MARS, 11: MARS })
  t().paintNodes('Phobos', { 3: VENUS })
  check('taken nodes are recorded per body', t().nodeHolders['Venus']?.[10] === MARS && t().nodeHolders['Phobos']?.[3] === VENUS)
  t().paintNodes('Venus', { 11: null })
  check('handing a node back removes it (only differences are stored)', !(11 in (t().nodeHolders['Venus'] ?? {})) && t().nodeHolders['Venus'][10] === MARS)
  t().paintNodes('Venus', { 10: null })
  check('a body with nothing left drops out entirely', !('Venus' in t().nodeHolders))
  t().paintNodes('Venus', { 10: MARS })
  t().paintNodes('Titan', { 5: ORION })
  t().clearPaintBetween(MARS, VENUS)
  check('peace between two nations clears their fronts on each other', !('Venus' in t().nodeHolders) && !('Phobos' in t().nodeHolders))
  check("...but not a third party's", t().nodeHolders['Titan']?.[5] === ORION)
  t().paintNodes('Venus', { 7: MARS })
  t().cedeBody('Venus', MARS)
  check('a ceded body starts with a clean map', !('Venus' in t().nodeHolders))
  t().paintNodes('Deimos', { 1: VENUS })
  t().occupyBody('Deimos', VENUS)
  t().liberateBody('Deimos')
  check('a liberated body starts with a clean map', !('Deimos' in t().nodeHolders))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
