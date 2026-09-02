// Pure-function verification of the ship builder (see src/data/hullChassis.ts,
// src/data/shipModules.ts, src/state/shipDesignStore.ts,
// src/state/shipClassResolver.ts).
//
// Run:  npx tsx tests/shipDesigns.test.ts
//
// Deliberately its own file, same reasoning as scenarios.test.ts being split
// from combat.test.ts — this exercises a separate system end to end (module
// catalog -> chassis -> design -> resolver -> real combat step) rather than
// individual combat mechanics, and keeping it apart lets the primary suite
// stay focused.

import {
  HULL_CHASSES,
  buildCombatProfile,
  designToShipClass,
  emptyLoadout,
  type ShipDesign,
} from '../src/data/hullChassis'
import {
  ARMOR_MODULES,
  DEFENSE_MODULES,
  MODULE_CATALOG,
  SHIELD_MODULES,
  UPGRADE_MODULES,
  WEAPON_MODULES,
  moduleFitsSlot,
  modulesForSlot,
} from '../src/data/shipModules'
import { useShipDesignStore } from '../src/state/shipDesignStore'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { SHIP_CLASSES } from '../src/data/shipData'
import { pristineCombatState, type ShipInstance } from '../src/state/shipStore'
import { syncEngagements, stepEngagements, shipCombatProfile, COMBAT_STEP_DAYS } from '../src/scene/combatResolution'
import { useCombatStore } from '../src/state/combatStore'
import { pointDistance } from '../src/scene/combatArena'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

console.log('\n=== 1. Slot fit rules: down-fit allowed, up-fit refused ===')
{
  check('a small module fits a small slot', moduleFitsSlot('small', 'small'))
  check('a small module fits a large slot (down-fit)', moduleFitsSlot('small', 'large'))
  check('a large module does NOT fit a small slot (no up-fit)', !moduleFitsSlot('large', 'small'))
  check('an X module only fits an X slot', moduleFitsSlot('x', 'x') && !moduleFitsSlot('x', 'large'))

  const forSmallSlot = modulesForSlot('weapon', 'small')
  check(
    'modulesForSlot(weapon, small) returns only small weapon modules',
    forSmallSlot.length > 0 && forSmallSlot.every((m) => m.slotSize === 'small'),
  )
  const forXSlot = modulesForSlot('weapon', 'x')
  check(
    'modulesForSlot(weapon, x) returns every weapon module (every size down-fits an X slot)',
    forXSlot.length === WEAPON_MODULES.length,
  )
}

console.log('\n=== 2. Chassis catalog: six chassis, real slot budgets ===')
{
  check('six hull chassis exist', HULL_CHASSES.length === 6)
  for (const chassis of HULL_CHASSES) {
    const totalSlots = Object.values(chassis.slots).reduce((sum, arr) => sum + arr.length, 0)
    check(`${chassis.name} has a positive slot count (${totalSlots} total)`, totalSlots > 0)
  }
  // Warships get every category; the Civilian Hull deliberately has NO
  // weapon or defense (point-defense/flak) slots — matches
  // CIVILIAN_COMBAT_PROFILE's own unarmed-by-design civilian hulls.
  const civilianHull = HULL_CHASSES.find((c) => c.id === 'civilian-hull')!
  check('the Civilian Hull cannot be armed — no weapon slots', civilianHull.slots.weapon.length === 0)
  check('the Civilian Hull cannot mount point defense/flak either', civilianHull.slots.defense.length === 0)
  for (const chassis of HULL_CHASSES.filter((c) => c.role === 'warship')) {
    check(`${chassis.name} (warship) has at least one slot in every category`, Object.values(chassis.slots).every((arr) => arr.length > 0))
  }
  const battleshipHull = HULL_CHASSES.find((c) => c.id === 'battleship-hull')!
  check('the battleship chassis is X-sized and actually has an X weapon slot', battleshipHull.sizeClass === 'x' && battleshipHull.slots.weapon.includes('x'))
}

console.log('\n=== 3. buildCombatProfile: empty slots contribute nothing ===')
{
  const chassis = HULL_CHASSES.find((c) => c.id === 'frigate-hull')!
  const design: ShipDesign = { id: 'test-empty', name: 'Bare Hull', chassisId: chassis.id, equipped: emptyLoadout(chassis) }
  const profile = buildCombatProfile(chassis, design)
  check('no weapons equipped -> empty weapons array', profile.weapons.length === 0)
  check('no armor equipped -> 0 armor HP', profile.defenses.armorHp === 0)
  check('no shields equipped -> 0 shield HP and regen', profile.defenses.shieldHp === 0 && profile.defenses.shieldRegenPerSecond === 0)
  check('no defense modules -> 0 point defense and flak', profile.defenses.pointDefenseRating === 0 && profile.defenses.flakRating === 0)
  check('no upgrades -> 0 evasion, base speed unchanged', profile.defenses.evasion === 0 && profile.maneuverUnitsPerSecond === chassis.baseMotion.maneuverUnitsPerSecond)
  check('the chassis size class carries through to the built profile', profile.sizeClass === chassis.sizeClass)
  check('base component pools carry through unchanged', profile.components.core === chassis.baseComponents.core)
}

console.log('\n=== 4. buildCombatProfile: equipped modules sum correctly ===')
{
  const chassis = HULL_CHASSES.find((c) => c.id === 'cruiser-hull')!
  const loadout = emptyLoadout(chassis)
  // Fill every weapon/armor/shield slot with the first module that fits it.
  loadout.weapon = chassis.slots.weapon.map((size) => modulesForSlot('weapon', size)[0]?.id ?? null)
  loadout.armor = chassis.slots.armor.map((size) => modulesForSlot('armor', size)[0]?.id ?? null)
  loadout.shield = chassis.slots.shield.map((size) => modulesForSlot('shield', size)[0]?.id ?? null)
  loadout.defense = chassis.slots.defense.map((size) => modulesForSlot('defense', size)[0]?.id ?? null)
  loadout.upgrade = chassis.slots.upgrade.map((size) => modulesForSlot('upgrade', size)[0]?.id ?? null)
  const design: ShipDesign = { id: 'test-full', name: 'Fully Kitted Cruiser', chassisId: chassis.id, equipped: loadout }
  const profile = buildCombatProfile(chassis, design)

  const expectedArmor = loadout.armor.reduce((sum, id) => sum + (ARMOR_MODULES.find((m) => m.id === id)?.armorHp ?? 0), 0)
  const expectedShield = loadout.shield.reduce((sum, id) => sum + (SHIELD_MODULES.find((m) => m.id === id)?.shieldHp ?? 0), 0)
  const expectedSpeedBonus = loadout.upgrade.reduce((sum, id) => sum + (UPGRADE_MODULES.find((m) => m.id === id)?.speedBonusFraction ?? 0), 0)

  check('weapons list has one entry per equipped weapon slot', profile.weapons.length === loadout.weapon.filter(Boolean).length, `${profile.weapons.length}`)
  check('armor HP is the exact sum of equipped plates', Math.abs(profile.defenses.armorHp - expectedArmor) < 1e-9, `${profile.defenses.armorHp} vs ${expectedArmor}`)
  check('shield HP is the exact sum of equipped generators', Math.abs(profile.defenses.shieldHp - expectedShield) < 1e-9)
  check(
    'speed scales by (1 + summed upgrade speed bonus)',
    Math.abs(profile.maneuverUnitsPerSecond - chassis.baseMotion.maneuverUnitsPerSecond * (1 + expectedSpeedBonus)) < 1e-9,
  )
  check('point defense and flak are both present when Defense-category modules are equipped', profile.defenses.pointDefenseRating > 0)
}

console.log('\n=== 5. buildCombatProfile: stacking caps apply ===')
{
  // A design with every defense slot filled with the same high-PD module
  // should still be clamped, not spike arbitrarily high.
  const chassis = HULL_CHASSES.find((c) => c.id === 'battleship-hull')!
  const loadout = emptyLoadout(chassis)
  const heavyPd = DEFENSE_MODULES.find((m) => m.id === 'pd-heavy')!
  loadout.defense = chassis.slots.defense.map((size) => (moduleFitsSlot(heavyPd.slotSize, size) ? heavyPd.id : null))
  const design: ShipDesign = { id: 'test-cap', name: 'PD Stacked', chassisId: chassis.id, equipped: loadout }
  const profile = buildCombatProfile(chassis, design)
  check('point defense rating never exceeds its cap (0.9) even fully stacked', profile.defenses.pointDefenseRating <= 0.9)
}

console.log('\n=== 6. designToShipClass + resolveShipClass: presets and custom designs both resolve ===')
{
  check('resolveShipClass still finds an existing preset', resolveShipClass('cruiser')?.id === 'cruiser')
  check('resolveShipClass returns null for a nonsense id', resolveShipClass('not-a-real-class') === null)

  const chassis = HULL_CHASSES.find((c) => c.id === 'corvette-hull')!
  const shipClass = designToShipClass({ id: 'x1', name: 'Test Skiff', chassisId: chassis.id, equipped: emptyLoadout(chassis) }, chassis)
  check('designToShipClass namespaces the id with design:', shipClass.id === 'design:x1')
  check('designToShipClass carries the chassis role through', shipClass.role === chassis.role)

  const designId = useShipDesignStore.getState().createDesign('destroyer-hull', 'Test Interceptor')
  check('createDesign returns a real id', designId.length > 0)
  const resolved = resolveShipClass(`design:${designId}`)
  check('a freshly created design resolves through resolveShipClass immediately', resolved !== null)
  check('a nonexistent chassis id is refused, not silently defaulted', useShipDesignStore.getState().createDesign('not-a-chassis', 'Ghost') === '')

  const destroyerHull = HULL_CHASSES.find((c) => c.id === 'destroyer-hull')!
  const firstWeaponSlotSize = destroyerHull.slots.weapon[0]
  const fittingWeapon = modulesForSlot('weapon', firstWeaponSlotSize)[0]
  useShipDesignStore.getState().equipModule(designId, 'weapon', 0, fittingWeapon.id)
  const afterEquip = resolveShipClass(`design:${designId}`)
  check('equipping a module changes the resolved combat profile', afterEquip!.combat.weapons.length === 1)
  useShipDesignStore.getState().equipModule(designId, 'weapon', 0, null)
  const afterClear = resolveShipClass(`design:${designId}`)
  check('clearing a slot (moduleId: null) removes it again', afterClear!.combat.weapons.length === 0)

  useShipDesignStore.getState().deleteDesign(designId)
  check('a deleted design no longer resolves', resolveShipClass(`design:${designId}`) === null)
}

console.log('\n=== 7. A spawned custom design actually fights, through the real combat step ===')
{
  useCombatStore.setState({ engagements: [], viewedEngagementId: null })
  const chassis = HULL_CHASSES.find((c) => c.id === 'corvette-hull')!
  const loadout = emptyLoadout(chassis)
  loadout.weapon = chassis.slots.weapon.map((size) => modulesForSlot('weapon', size)[0]?.id ?? null)
  const designId = useShipDesignStore.getState().createDesign(chassis.id, 'Armed Test Skiff')
  loadout.weapon.forEach((moduleId, i) => useShipDesignStore.getState().equipModule(designId, 'weapon', i, moduleId))
  const classId = `design:${designId}`

  const shipClass = resolveShipClass(classId)!
  check('the custom design carries a real weapon loadout into combat', shipClass.combat.weapons.length > 0)

  const custom: ShipInstance = {
    id: 'custom-1',
    classId,
    name: 'Armed Test Skiff 1',
    allegiance: 'player',
    location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: false,
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(shipClass.combat),
    stance: 'balanced',
    fleetId: 'solo-custom-1',
  }
  const hostileClass = SHIP_CLASSES.find((c) => c.id === 'corvette')!
  const hostile: ShipInstance = {
    id: 'hostile-1',
    classId: hostileClass.id,
    name: 'Hostile Corvette',
    allegiance: 'hostile',
    location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: false,
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(hostileClass.combat),
    stance: 'balanced',
    fleetId: 'solo-hostile-1',
  }

  check('shipCombatProfile resolves a custom design (the same helper stepEngagements uses internally)', shipCombatProfile(custom) !== null)

  let simDays = 100
  let ships = [custom, hostile]
  let engagements = syncEngagements(ships, [], simDays)
  const opening = pointDistance(engagements[0].participants[0].position, engagements[0].participants[1].position)
  check('the custom-design fleet forms a real engagement, out of range at the start', Math.abs(opening - 12) < 1e-9)

  const rng = seededRng(3)
  let steps = 0
  let destroyed: string[] = []
  while (destroyed.length === 0 && steps < 20000) {
    simDays += COMBAT_STEP_DAYS
    steps++
    const result = stepEngagements(engagements, ships, simDays, rng)
    engagements = result.engagements
    ships = ships.filter((s) => !result.destroyedShipIds.includes(s.id)).map((s) => (result.shipCombat[s.id] ? { ...s, combat: result.shipCombat[s.id] } : s))
    destroyed = [...destroyed, ...result.destroyedShipIds]
  }
  check('a fight involving a custom design resolves to a real outcome (proves it works everywhere for free)', steps < 20000 && destroyed.length === 1, `${steps} steps, destroyed: ${destroyed.join(',')}`)
}

console.log('\n=== 8. Module catalog sanity ===')
{
  for (const [category, modules] of Object.entries(MODULE_CATALOG)) {
    check(`${category} catalog has at least one module per slot size`, ['small', 'medium', 'large', 'x'].every((size) => modules.some((m) => m.slotSize === size)))
  }
}

console.log('\n=== 9. Tech-gated modules: Laser/Shield/Point-Defense require the right EM node ===')
{
  const laser = WEAPON_MODULES.find((m) => m.id === 'laser')!
  const massDriver = WEAPON_MODULES.find((m) => m.id === 'mass-driver')!
  check('Laser requires Directed Energy Weapons', laser.requiresTechId === 'directed-energy-weapons')
  check('Mass Driver (kinetic) is ungated', massDriver.requiresTechId === undefined)
  check('every Shield module requires Shielding', SHIELD_MODULES.every((m) => m.requiresTechId === 'shielding'))
  check('every Defense (PD/Flak) module requires Point Defense Systems', DEFENSE_MODULES.every((m) => m.requiresTechId === 'point-defense-systems'))
  check('Armor modules are ungated', ARMOR_MODULES.every((m) => (m as { requiresTechId?: string }).requiresTechId === undefined))

  // modulesForSlot's actual filtering behavior.
  const noTech = new Set<string>()
  const withDEW = new Set(['directed-energy-weapons'])
  check('with no tech researched, a medium weapon slot omits the Laser', !modulesForSlot('weapon', 'medium', noTech).some((m) => m.id === 'laser'))
  check('...but still offers the ungated Mass Driver', modulesForSlot('weapon', 'medium', noTech).some((m) => m.id === 'mass-driver'))
  check('once Directed Energy Weapons is researched, the Laser appears', modulesForSlot('weapon', 'medium', withDEW).some((m) => m.id === 'laser'))
  check('omitting researchedIds entirely does not filter anything (back-compat for callers that ignore tech)', modulesForSlot('weapon', 'medium').some((m) => m.id === 'laser'))
  check('no shield modules are offered without Shielding researched', modulesForSlot('shield', 'x', noTech).length === 0)
  check('shield modules appear once Shielding is researched', modulesForSlot('shield', 'x', new Set(['shielding'])).length > 0)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
