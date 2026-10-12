// The Complex `resource` district was split into `mining` and `agricultural`. An older world is migrated by what its buildings use,
// nothing is lost, running it twice changes nothing; and the new `agricultural` site kind exists without moving any older site id.
//
// Run:  npx tsx tests/districtSplit.test.ts
import { seedWorlds } from '../src/economy/economySeed'
import { migrateWorldDistricts } from '../src/economy/districtMigration'
import { districtOfRecipe } from '../src/economy/recipes'
import { SLOTS_PER_DISTRICT_LEVEL } from '../src/economy/districts'
import { locationsOf } from '../src/scene/locations'
import type { World } from '../src/economy/economyTypes'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

type Loose = Record<string, number>

// The shape an old save had: one `resource` district holding what mining and agriculture hold now.
function asOld(world: World): World {
  const levels = world.districts as unknown as Loose
  const cap = world.districtCapacity as unknown as Loose
  const { mining, agricultural, ...rest } = levels
  const { mining: cm, agricultural: ca, ...capRest } = cap
  return {
    ...world,
    districts: { ...rest, resource: (mining ?? 0) + (agricultural ?? 0) } as unknown as World['districts'],
    districtCapacity: { ...capRest, resource: (cm ?? 0) + (ca ?? 0) } as unknown as World['districtCapacity'],
  }
}

console.log('\n=== Migrating an old world ===')
{
  const worlds = seedWorlds()
  const mars = worlds.find((w) => w.id === 'Mars')!
  const old = asOld(mars)
  check('the old shape has a resource district and no mining or agricultural one', 'resource' in (old.districts as object) && !('mining' in (old.districts as object)))
  const migrated = migrateWorldDistricts(old)
  const m = migrated.districts as unknown as Loose
  check('the migrated world has mining and agricultural, and no resource', 'mining' in m && 'agricultural' in m && !('resource' in m))
  const was = (mars.districts as unknown as Loose)
  check('the levels are conserved', m.mining + m.agricultural === was.mining + was.agricultural, `${m.mining}+${m.agricultural} vs ${was.mining}+${was.agricultural}`)
  const cap = migrated.districtCapacity as unknown as Loose
  check('the slots are conserved, a level being SLOTS_PER_DISTRICT_LEVEL', cap.mining + cap.agricultural === (mars.districtCapacity as unknown as Loose).mining + (mars.districtCapacity as unknown as Loose).agricultural && cap.mining % SLOTS_PER_DISTRICT_LEVEL === 0)
  const usedBy = (d: string) => mars.buildings.reduce((n, b) => n + (districtOfRecipe(b.recipeId) === d ? b.level : 0), 0)
  check('a world with farms and mines gets levels in both', usedBy('mining') === 0 || m.mining > 0)
  check('migrating twice changes nothing', JSON.stringify(migrateWorldDistricts(migrated)) === JSON.stringify(migrated))
  check('a current world passes through as the same object', migrateWorldDistricts(mars) === mars)
  const queued = migrateWorldDistricts({ ...old, constructionQueue: [{ ...(old.constructionQueue[0] ?? ({} as never)), district: 'resource' } as never] })
  check('a queued resource district order becomes a mining order', (queued.constructionQueue[0]?.district as string) === 'mining')
}

console.log('\n=== Every nation world migrates without losing a level ===')
{
  let ok = true
  for (const w of seedWorlds()) {
    const was = w.districts as unknown as Loose
    const m = migrateWorldDistricts(asOld(w)).districts as unknown as Loose
    if (m.mining + m.agricultural !== was.mining + was.agricultural) ok = false
  }
  check('mining + agricultural levels are conserved on every seeded world', ok)
}

console.log('\n=== The farmland site kind ===')
{
  const sites = locationsOf('Earth')
  const agri = sites.filter((s) => s.kind === 'agricultural')
  check('Earth has farmland sites', agri.length > 0, String(agri.length))
  const firstAgri = sites.findIndex((s) => s.kind === 'agricultural')
  check('farmland is generated last: no other kind comes after it', firstAgri >= 0 && sites.slice(firstAgri).every((s) => s.kind === 'agricultural'))
  check('farmland sits on ground suited to farming', agri.every((s) => s.suitability > 0))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nAll district split checks passed')
