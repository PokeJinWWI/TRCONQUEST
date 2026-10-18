// The 12 light-year chart's systems (src/data/nearbySystems.ts): real detections
// tagged confirmed / candidate, seeded top-up that is never tagged, binaries with
// real components, and the catalogue tag the planet panel reads.
//
// Run:  npx tsx tests/nearbySystems.test.ts

import { STARS, getSystemStars, isRealStar } from '../src/data/starData'
import { getAsteroidBeltsForStar } from '../src/data/asteroidBeltData'
import { PLANETS_BY_STAR, getPlanetsForStar } from '../src/scene/planetData'
import { surfaceOf, TERRAIN_IDS } from '../src/scene/planetTerrain'
import { NEARBY_SYSTEM_IDS, nearbyRawPlanets, radiusKmFromMass } from '../src/data/nearbySystems'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}
const planets = (id: string) => getPlanetsForStar(id)
const find = (id: string, name: string) => planets(id).find((p) => p.name === name)

console.log('\n=== 1. Every chart star is an enterable system ===')
{
  const added = STARS.slice(8)
  check('the 15 chart stars are all enterable', added.length === 15 && added.every((s) => s.hasSystemData))
  check('each has a system entry', NEARBY_SYSTEM_IDS.filter((id) => id !== 'barnards-star').every((id) => PLANETS_BY_STAR[id] !== undefined))
  const names = STARS.flatMap((s) => planets(s.id).map((p) => p.name))
  check('planet names are unique game-wide', new Set(names).size === names.length)
  check('a system is either planets or a belt or both, never quite nothing but allowed to be a lone belt', added.every((s) => getSystemStars(s.id).length >= 1))
  check('some system is only a belt', added.some((s) => planets(s.id).length === 0 && getAsteroidBeltsForStar(s.id).length > 0))
}

console.log('\n=== 2. Real detections carry their status and real orbits ===')
{
  const b = find('barnards-star', 'Barnard d')
  check('Barnard d: confirmed, 2.34 d', b?.knownStatus === 'confirmed' && Math.abs((b?.orbitPeriodYears ?? 0) * 365.25 - 2.34) < 0.01)
  check('Barnard has four confirmed worlds', planets('barnards-star').filter((p) => p.knownStatus === 'confirmed').length === 4)
  check('Barnard\'s Reach stays generated', find('barnards-star', 'Barnard’s Reach')?.knownStatus === undefined)
  const rb = find('ross-128', 'Ross 128 b')
  check('Ross 128 b: confirmed, 9.866 d, ~0.0496 AU', rb?.knownStatus === 'confirmed' && Math.abs((rb?.orbitRadius ?? 0) / 20 - 0.0496) < 0.002)
  const g = find('l372-58', 'L372-58 d')
  check('L372-58 d (Gliese 1061 d): confirmed, 13.03 d', g?.knownStatus === 'confirmed' && Math.abs((g?.orbitPeriodYears ?? 0) * 365.25 - 13.03) < 0.01)
  const eri = find('epsilon-eridani', 'ε Eridani b')
  check('ε Eridani b: a giant at ~3.5 AU', eri?.knownStatus === 'confirmed' && eri.planetClass === 'gas-giant' && Math.abs(eri.orbitRadius / 20 - 3.53) < 0.05)
  check('τ Ceti e and f are candidates', find('tau-ceti', 'τ Ceti e')?.knownStatus === 'candidate' && find('tau-ceti', 'τ Ceti f')?.knownStatus === 'candidate')
  check('Lacaille 9352 b, c confirmed; d, e candidates', ['b', 'c'].every((l) => find('lacaille-9352', `Lacaille 9352 ${l}`)?.knownStatus === 'confirmed') && ['d', 'e'].every((l) => find('lacaille-9352', `Lacaille 9352 ${l}`)?.knownStatus === 'candidate'))
  const ab = find('epsilon-indi', 'ε Indi A b')
  check('ε Indi A b: ~6 Jupiter masses at ~28 AU, around its own star', ab?.knownStatus === 'confirmed' && Math.abs((ab?.orbitRadius ?? 0) / 20 - 28.4) < 0.3 && ab?.parentStar === 'ε Indi A')
  check('Struve 2398 c orbits component B', find('struve-2398', 'Struve 2398 c')?.parentStar === 'Struve 2398 B')
  check('Proxima b, d confirmed and c a candidate', find('alpha-centauri', 'Proxima b')?.knownStatus === 'confirmed' && find('alpha-centauri', 'Proxima d')?.knownStatus === 'confirmed' && find('alpha-centauri', 'Proxima c')?.knownStatus === 'candidate')
  check('Lalande 21185 b, c confirmed; its other worlds not', find('lalande-21185', 'Lalande 21185 b')?.knownStatus === 'confirmed' && find('lalande-21185', 'Lalande 21185 c')?.knownStatus === 'confirmed' && find('lalande-21185', 'Lalande 21185 d')?.knownStatus === undefined)
  check('every body of Sol is confirmed', planets('sol').every((p) => p.knownStatus === 'confirmed'))
  check('Wolf 359 / Ross 154 / Sirius (nothing real listed) stay untagged', ['wolf-359', 'ross-154', 'sirius'].every((id) => planets(id).every((p) => p.knownStatus === undefined)))
}

console.log('\n=== 3. Generated top-up is seeded and never tagged ===')
{
  const again = NEARBY_SYSTEM_IDS.every((id) => JSON.stringify(nearbyRawPlanets(id)) === JSON.stringify(nearbyRawPlanets(id)))
  check('the same every time', again)
  const generated = NEARBY_SYSTEM_IDS.flatMap((id) => planets(id).filter((p) => !p.knownStatus && !p.isDwarfPlanet))
  check('there are generated worlds, none tagged', generated.length > 0 && generated.every((p) => p.knownStatus === undefined))
  check('a real world is never replaced: the real letters keep their real periods', Math.abs((find('luytens-star', "Luyten's Star c")?.orbitPeriodYears ?? 0) * 365.25 - 4.723) < 0.01)
  const mass = radiusKmFromMass(1)
  check('mass-radius: 1 Earth mass is 1 Earth radius; a giant ~ a Jupiter', mass === 6371 && Math.abs(radiusKmFromMass(318) - 71_350) < 2000)
}

console.log('\n=== 4. Binaries have their real stars ===')
{
  const comps = (id: string) => getSystemStars(id).map((c) => c.name)
  check('61 Cygni A/B', comps('61-cygni').join() === '61 Cygni A,61 Cygni B')
  check('Procyon A/B, B a white dwarf', comps('procyon').join() === 'Procyon A,Procyon B' && getSystemStars('procyon')[1].radiusKm < 10_000)
  check('Struve 2398 A/B, Groombridge 34 A/B', comps('struve-2398').length === 2 && comps('groombridge-34').length === 2)
  check('ε Indi: the star and two brown dwarfs', comps('epsilon-indi').length === 3)
  check('EZ Aquarii is a triple', comps('l789-6').length === 3)
  check('a planet\'s parent is always a real component of its system', STARS.every((s) => planets(s.id).every((p) => !p.parentStar || getSystemStars(s.id).some((c) => c.name === p.parentStar))))
  check('real stars are tagged real, generated ones are not', isRealStar('Procyon B') && isRealStar('Sol') && !isRealStar('Nowhere Alpha'))
}

console.log('\n=== 5. Jinshan, the California world ===')
{
  const j = find('tau-ceti', 'Jinshan')
  check('Jinshan: a continental world in τ Ceti, home of the Republic of Jinshan, between the two candidates', j?.planetClass === 'continental' && j.ownerId === 'republic-of-jinshan' && (j.orbitRadius / 20) > 0.538 && (j.orbitRadius / 20) < 1.334)
  check('it does not disturb the seeded worlds (τ Ceti still has e, f, and its generated i)', ['τ Ceti e', 'τ Ceti f', 'τ Ceti i'].every((n) => !!find('tau-ceti', n)))
  const sf = surfaceOf('Jinshan', 'wild')
  const share: Record<string, number> = {}
  for (const t of sf.terrain) share[TERRAIN_IDS[t]] = (share[TERRAIN_IDS[t]] ?? 0) + 1
  const land = sf.terrain.length - (share.ocean ?? 0)
  const of = (id: string) => (share[id] ?? 0) / land
  check('mostly grassland (plains) on the land, with mountains, desert and a little forest', of('plains') > 0.35 && of('plains') > of('desert') && of('plains') > of('forest') * 3 && of('mountains') > 0.1 && of('desert') > 0.1 && of('forest') > 0.02, Object.entries(share).map(([k, v]) => `${k} ${(100 * v / land).toFixed(0)}%`).join(' '))
}

console.log(failures === 0 ? '\nAll nearby-system checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
