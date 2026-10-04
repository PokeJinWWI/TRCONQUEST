// The generated galaxy (src/data/galaxyGen.ts), its empires
// (src/data/generatedEmpires.ts) and the lore override (src/data/loreEmpires.ts).
//
// Run:  npx tsx tests/galaxyGen.test.ts

import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import { STARS, findStar, getStarsForNeighborhood, getSystemStars } from '../src/data/starData'
import { getAsteroidBeltsForStar } from '../src/data/asteroidBeltData'
import { PLANETS_BY_STAR, getPlanetsForStar } from '../src/scene/planetData'
import { getMoonsForPlanet } from '../src/scene/moonData'
import { COUNTRIES } from '../src/data/countryData'
import { ALL_TECHS, prerequisitesMet } from '../src/data/techData'
import { INFLUENCE_CAP } from '../src/data/colonyData'
import { DEFAULT_RESEARCHED } from '../src/state/techStore'
import { WARP_DRIVE_TECH_IDS, WARP_MK1_RADIUS_KLY } from '../src/data/warpData'
import { HUMAN_BASELINE_TIER, MAX_TECH_TIER, TECH_TIERS, techsForTier, tierOfTechs } from '../src/data/techTiers'
import {
  GALAXY_SEED,
  MAX_PLANETS_PER_STAR,
  MAX_STARS_PER_CLUSTER,
  MIN_STARS_PER_CLUSTER,
  SOLAR_NEIGHBORHOOD_ID,
  clusterOfGeneratedStar,
  findGeneratedStar,
  generateBelts,
  generateClusterStars,
  generateRawPlanets,
  generatedClusterIds,
  generatedStarsFor,
} from '../src/data/galaxyGen'
import { EMPIRE_COUNT, MAX_EMPIRES_PER_CLUSTER, MAX_EXTRA_SYSTEMS, galaxyEmpires, generateEmpires, type GalaxyEmpire } from '../src/data/generatedEmpires'
import { LORE_EMPIRES, type LoreEmpire } from '../src/data/loreEmpires'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// Sets compare by content.
const plain = (empires: GalaxyEmpire[]) => JSON.stringify(empires.map((e) => ({ ...e, researched: [...e.researched].sort() })))
const others = NEIGHBORHOODS.filter((n) => n.id !== SOLAR_NEIGHBORHOOD_ID)

console.log('\n=== 1. Our own neighbourhood is untouched ===')
{
  check('STARS is still the 8 hand-authored systems', STARS.length === 8 && STARS[0].id === 'sol')
  check('PLANETS_BY_STAR is still those 8 systems', Object.keys(PLANETS_BY_STAR).length === 8)
  check('the Solar Neighbourhood serves STARS itself', getStarsForNeighborhood(SOLAR_NEIGHBORHOOD_ID) === STARS)
  check('the home nations are unchanged', COUNTRIES.length === 5)
  check('no generated star in STARS', STARS.every((s) => !findGeneratedStar(s.id)))
}

console.log('\n=== 2. Every other cluster has 6-12 stars ===')
{
  check('320 other clusters', others.length === 320 && generatedClusterIds().length === 320)
  const counts = others.map((n) => getStarsForNeighborhood(n.id).length)
  check(`each has ${MIN_STARS_PER_CLUSTER}-${MAX_STARS_PER_CLUSTER} stars`, counts.every((c) => c >= MIN_STARS_PER_CLUSTER && c <= MAX_STARS_PER_CLUSTER), `${Math.min(...counts)}-${Math.max(...counts)}, ${counts.reduce((a, b) => a + b, 0)} in all`)
  check('both ends of the range occur', counts.includes(MIN_STARS_PER_CLUSTER) && counts.includes(MAX_STARS_PER_CLUSTER))
  const all = others.flatMap((n) => getStarsForNeighborhood(n.id))
  const ids = new Set([...all, ...STARS].map((s) => s.id))
  const names = new Set([...all, ...STARS].map((s) => s.name))
  check('star ids are unique game-wide', ids.size === all.length + STARS.length)
  check('star names are unique game-wide', names.size === all.length + STARS.length)
  check('every star has a mass, a radius and a system', all.every((s) => s.massKg > 0 && s.radiusKm > 0 && s.hasSystemData && s.position.every(Number.isFinite)))
  check('a star is found by id, with its cluster', findStar(all[0].id) === all[0] && clusterOfGeneratedStar(all[0].id) === others[0].id)
  check('...and renders as one star at the centre', getSystemStars(all[0].id).length === 1 && getSystemStars(all[0].id)[0].name === all[0].name)

  const planets = all.flatMap((s) => getPlanetsForStar(s.id))
  const perStar = all.map((s) => getPlanetsForStar(s.id).length)
  check(`planets: 0-${MAX_PLANETS_PER_STAR} a star`, Math.min(...perStar) === 0 && Math.max(...perStar) === MAX_PLANETS_PER_STAR, `${planets.length} in all`)
  const authored = Object.values(PLANETS_BY_STAR).flat()
  const authoredNames = [...authored.map((p) => p.name), ...authored.flatMap((p) => getMoonsForPlanet(p.name).moons.map((m) => m.name))]
  const bodyNames = new Set([...planets.map((p) => p.name), ...authoredNames])
  check('body names are unique game-wide', bodyNames.size === planets.length + authoredNames.length)
  check('planets are well-formed', planets.every((p) => p.radius > 0 && p.massKg > 0 && p.orbitRadius > 0 && p.orbitPeriodYears > 0 && !p.ownerId))
  check('orbits widen outward', all.every((s) => getPlanetsForStar(s.id).every((p, i, list) => i === 0 || p.orbitRadius > list[i - 1].orbitRadius)))
  check('the same planet list each time (built once)', getPlanetsForStar(all[0].id) === getPlanetsForStar(all[0].id))
  const belts = all.map((s) => getAsteroidBeltsForStar(s.id))
  check('belts: none or one, outside the planets', belts.every((b) => b.length <= 1 && b.every((x) => x.outerAU > x.innerAU)) && belts.some((b) => b.length === 1) && belts.some((b) => b.length === 0))
  check('our own belts are unchanged', getAsteroidBeltsForStar('sol').length === 2)
}

console.log('\n=== 3. Deterministic ===')
{
  const cluster = others[17]
  const a = generateClusterStars(GALAXY_SEED, cluster)
  const b = generateClusterStars(GALAXY_SEED, cluster)
  check('the same seed gives the same stars', JSON.stringify(a) === JSON.stringify(b))
  check('...which are the ones served', JSON.stringify(a) === JSON.stringify(generatedStarsFor(cluster.id)))
  check('a different seed gives different stars', JSON.stringify(generateClusterStars(GALAXY_SEED + 1, cluster)) !== JSON.stringify(a))
  // Order of generation doesn't matter: a late cluster first, then an early one.
  const late = JSON.stringify(generateClusterStars(GALAXY_SEED, others[300]))
  generateClusterStars(GALAXY_SEED, others[3])
  check('a cluster does not depend on which was generated first', late === JSON.stringify(generatedStarsFor(others[300].id)))
  check('planets and belts repeat too', JSON.stringify(generateRawPlanets(GALAXY_SEED, a[0])) === JSON.stringify(generateRawPlanets(GALAXY_SEED, a[0])) && JSON.stringify(generateBelts(GALAXY_SEED, a[1])) === JSON.stringify(generateBelts(GALAXY_SEED, a[1])))
  check('empires repeat', plain(generateEmpires(GALAXY_SEED)) === plain(generateEmpires(GALAXY_SEED)))
  check('...and change with the seed', plain(generateEmpires(GALAXY_SEED + 1)) !== plain(generateEmpires(GALAXY_SEED)))
}

function checkEmpires(label: string, empires: GalaxyEmpire[]) {
  check(`${label}: exactly ${EMPIRE_COUNT}, one per slot`, empires.length === EMPIRE_COUNT && empires.every((e, i) => e.slot === i))
  const perCluster = new Map<string, number>()
  for (const e of empires) perCluster.set(e.clusterId, (perCluster.get(e.clusterId) ?? 0) + 1)
  check(`${label}: at most ${MAX_EMPIRES_PER_CLUSTER} in a cluster`, [...perCluster.values()].every((n) => n <= MAX_EMPIRES_PER_CLUSTER), `${perCluster.size} clusters hold them, ${320 - perCluster.size} hold none`)
  check(`${label}: none in the Solar Neighbourhood`, empires.every((e) => e.clusterId !== SOLAR_NEIGHBORHOOD_ID && !STARS.some((s) => e.ownedStarIds.includes(s.id))))
  const owned = empires.flatMap((e) => e.ownedStarIds)
  check(`${label}: no system has two owners`, new Set(owned).size === owned.length)
  check(`${label}: every system exists, in the empire's own cluster`, empires.every((e) => e.ownedStarIds.every((id) => clusterOfGeneratedStar(id) === e.clusterId)))
  check(`${label}: the home system is owned, listed first`, empires.every((e) => e.ownedStarIds[0] === e.homeStarId))
  check(`${label}: ids and names are unique`, new Set(empires.map((e) => e.id)).size === EMPIRE_COUNT && new Set(empires.map((e) => e.name)).size === EMPIRE_COUNT)
}

console.log('\n=== 4. Twenty empires, thinly spread ===')
{
  const empires = galaxyEmpires()
  checkEmpires('generated', empires)
  check('with no lore entries, all are generated', LORE_EMPIRES.length > 0 || empires.every((e) => !e.lore))
  check(`each holds its home and up to ${MAX_EXTRA_SYSTEMS} more`, empires.every((e) => e.ownedStarIds.length >= 1 && e.ownedStarIds.length <= 1 + MAX_EXTRA_SYSTEMS))
  check('sizes vary', new Set(empires.map((e) => e.ownedStarIds.length)).size > 1)
  // ...plus Warp Drive Mk I for the ones near the galactic core (section 4c).
  const tierTechs = (e: GalaxyEmpire) => new Set([...techsForTier(e.techTier), ...(e.coreDistanceKly <= WARP_MK1_RADIUS_KLY ? [WARP_DRIVE_TECH_IDS[0]] : [])])
  check('tech is a researched set like a nation\'s, exactly what its tier gives', empires.every((e) => e.researched instanceof Set && e.researched.size === tierTechs(e).size && [...tierTechs(e)].every((t) => e.researched.has(t))))
  const known = new Set(ALL_TECHS.map((t) => t.id))
  check('...of real techs', empires.every((e) => [...e.researched].every((t) => known.has(t))))
  // Every tech beyond the starting ones has its prerequisites in the set.
  check('...each with its prerequisites', empires.every((e) => ALL_TECHS.filter((t) => e.researched.has(t.id)).every((t) => prerequisitesMet(t, e.researched))))
  check('tech progress varies', new Set(empires.map((e) => e.researched.size)).size > 3)

  console.log('\n=== 4b. Tech tiers ===')
  const tiers = empires.map((e) => e.techTier)
  check('tiers are whole numbers within 1..the top tier', tiers.every((t) => Number.isInteger(t) && t >= 1 && t <= MAX_TECH_TIER))
  check('tiers vary across the 20 (at least 4 distinct)', new Set(tiers).size >= 4, [...new Set(tiers)].sort().join(','))
  const above = tiers.filter((t) => t > HUMAN_BASELINE_TIER).length
  check('most empires are above the human baseline', above > 10, `${above} above`)
  check('a few are at or below it', tiers.length - above >= 2 && tiers.length - above <= 7, `${tiers.length - above} at or below`)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const xs = empires.map((e) => -e.coreDistanceKly)
  const [mx, my] = [mean(xs), mean(tiers)]
  const r = xs.reduce((n, x, i) => n + (x - mx) * (tiers[i] - my), 0) / Math.sqrt(xs.reduce((n, x) => n + (x - mx) ** 2, 0) * tiers.reduce((n, t) => n + (t - my) ** 2, 0))
  check('tier rises toward the galactic core (correlation with closeness)', r > 0.5, `r = ${r.toFixed(2)}`)
  check('...but is not a pure gradient (some far empire out-tiers a nearer one)', empires.some((a) => empires.some((b) => a.coreDistanceKly > b.coreDistanceKly + 1 && a.techTier > b.techTier)))
  check('core distance is the neighbourhood\'s real distance', empires.every((e) => { const n = NEIGHBORHOODS.find((x) => x.id === e.clusterId)!; return Math.abs(e.coreDistanceKly - Math.hypot(n.position[0], n.position[1])) < 1e-9 }))
  const baseline = techsForTier(HUMAN_BASELINE_TIER)
  check('the human baseline tier covers what the nations start with (bar Hyper Comms, a nation-only starting tech)', DEFAULT_RESEARCHED.every((t) => baseline.has(t) || t === 'hyper-comms' || t === 'quantum-mechanics'))
  check('every tier is closed under prerequisites (nothing out of order)', TECH_TIERS.every((_, t) => { const set = techsForTier(t); return ALL_TECHS.filter((x) => set.has(x.id)).every((x) => prerequisitesMet(x, set)) }))
  const all = TECH_TIERS.flat()
  check('every tier tech exists, none twice, none locked', new Set(all).size === all.length && all.every((id) => ALL_TECHS.some((x) => x.id === id && !x.locked)))
  check('a tier maps back from its techs', TECH_TIERS.every((_, t) => tierOfTechs(techsForTier(t)) === t))
  check('influence is on the nations\' scale', empires.every((e) => e.influence >= 0 && e.influence <= INFLUENCE_CAP) && new Set(empires.map((e) => e.influence)).size > 10)
  check('not one of the four nations', empires.every((e) => !COUNTRIES.some((c) => c.id === e.id || c.name === e.name)))
}

console.log('\n=== 5. A lore empire takes its slot ===')
{
  const base = generateEmpires(GALAXY_SEED)

  // Named only: it keeps the slot's generated home, tech and influence.
  const named: LoreEmpire = { slot: 4, id: 'lore-test', name: 'The Test Imperium', color: '#123456' }
  const withNamed = generateEmpires(GALAXY_SEED, [named])
  checkEmpires('lore (named)', withNamed)
  check('the lore entry replaces slot 4', withNamed[4].id === 'lore-test' && withNamed[4].name === 'The Test Imperium' && withNamed[4].color === '#123456' && withNamed[4].lore === true)
  check('...inheriting the slot\'s territory, tech and influence', withNamed[4].homeStarId === base[4].homeStarId && JSON.stringify(withNamed[4].ownedStarIds) === JSON.stringify(base[4].ownedStarIds) && withNamed[4].influence === base[4].influence && withNamed[4].researched.size === base[4].researched.size)
  check('the other 19 are untouched', plain(withNamed.filter((e) => e.slot !== 4)) === plain(base.filter((e) => e.slot !== 4)))

  // With its own territory, taken from another empire's home.
  const stolen = base[9].homeStarId
  const neighbour = generatedStarsFor(base[9].clusterId).find((s) => s.id !== stolen)!.id
  const landed: LoreEmpire = { slot: 2, id: 'lore-landed', name: 'The Landed League', color: '#abcdef', homeStarId: stolen, ownedStarIds: [stolen, neighbour], researched: ['warp-theory'], influence: 5000 }
  const withLanded = generateEmpires(GALAXY_SEED, [landed])
  checkEmpires('lore (with territory)', withLanded)
  check('it lives where it says', withLanded[2].homeStarId === stolen && withLanded[2].ownedStarIds.length === 2 && withLanded[2].clusterId === base[9].clusterId)
  check('its stars are never given to a generated empire', withLanded.filter((e) => e.slot !== 2).every((e) => !e.ownedStarIds.includes(stolen) && !e.ownedStarIds.includes(neighbour)))
  check('its own tech and influence win (influence capped)', withLanded[2].researched.size === 1 && withLanded[2].influence === INFLUENCE_CAP)
  // Slot 9 lost its home to the lore empire, so it moved; nobody else did.
  check('the empire whose home it took lives elsewhere', withLanded[9].homeStarId !== stolen)
  check('every other slot is unchanged', plain(withLanded.filter((e) => e.slot !== 2 && e.slot !== 9)) === plain(base.filter((e) => e.slot !== 2 && e.slot !== 9)))

  const byTier = generateEmpires(GALAXY_SEED, [{ slot: 6, id: 'lore-tier', name: 'The Tiered', color: '#222222', techTier: 1 }])
  check('a lore empire can state a tier instead of techs', byTier[6].techTier === 1 && byTier[6].researched.size === techsForTier(1).size)
  check('...and its techs win over a tier', withLanded[2].techTier === tierOfTechs(new Set(['warp-theory'])) && withLanded[2].techTier === 0)
  check('a lore entry that says nothing about tech keeps the slot\'s tier', withNamed[4].techTier === base[4].techTier)
  check('tiers of the other slots are untouched by a lore entry', byTier.filter((e) => e.slot !== 6).every((e) => e.techTier === base[e.slot].techTier))

  const bad = generateEmpires(GALAXY_SEED, [{ slot: 99, id: 'x', name: 'Nowhere', color: '#000000' }, { slot: 1, id: 'lost', name: 'The Lost', color: '#111111', homeStarId: 'no-such-star' }])
  checkEmpires('lore (bad entries)', bad)
  check('a slot out of range is ignored', !bad.some((e) => e.id === 'x'))
  check('a home that does not exist falls back to the slot\'s territory', bad[1].id === 'lost' && bad[1].homeStarId === base[1].homeStarId)
  check('two lore empires can share the galaxy', generateEmpires(GALAXY_SEED, [named, landed]).filter((e) => e.lore).length === 2)
}

console.log(failures === 0 ? '\nAll galaxy checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
