# Territorial, colonization and save/load architecture (Milestone 1)

**Status:** built (see "As built" at the end). Originally written as design only. Source: `combined-spec.md` (15 milestones). This round covers M1 (this doc), M2 (development locations), M3 (territorial core) and a new save/load system. M4 onward are sequenced in section 8.
Supersedes the "partial ownership" and "economy split" parts of `colonies-design.md` (same decisions, now with concrete shapes). Colonies v1 stays as built until M4.

## 1. Principles

1. One authoritative structure per concept; everything else is a pure derivation. No `owner` field that means several things.
2. Pure logic in `scene/*` / `data/*`, store I/O in `state/*`, resolvers in `hooks/*` (the repo's existing split).
3. Simple and Complex share one physical and political world. They differ only in how much economy they simulate on top.
4. Legal impossibility and physical impossibility are different results, always.
5. All new state is plain JSON (no class instances, functions, Maps) so it saves without special cases. Sets are allowed only through the save codec.

## 2. Authoritative data model

| Concept | Authority (who writes) | Derived views |
|---|---|---|
| **Development location** (site) | `data/locations.ts`, pure and seeded; runtime state in `state/locationStore.ts` (established, reserves left) | suitability, capacity, `KeySlot` mapping |
| **Claim** (territorial claim and its lifecycle) | `state/jurisdictionStore.claims` | sovereign of a scope, Frontier Situation, `bodyOwner` compat view |
| **Sovereignty** | derived from claims with status `recognized` (plus treaty/transfer records) | `sovereignOf(scope)` |
| **Property** | the asset itself (`World`/building/settlement/Starbase `ownerId`) | holdings lists |
| **Orbital jurisdiction** (M8) | derived from claims + agreements per orbital zone | |
| **Military control** | `territoryStore.bodyController` + `nodeHolders` + fleets (existing combat) | `militaryControlOf(scope)` |
| **Access rights** (M9) | `treatyStore` permission entries | `mayAccess(actor, scope, action)` |

### 2.1 Scope
A territorial scope is `{ kind: 'system' | 'body' | 'location'; id: string }`. A body-wide status is explicit (`kind:'body'`), never implied by owning one site. Orbital zones (M8) add `{ kind: 'orbit'; id: '<body>~<zone>' }`.

### 2.2 Development locations (M2)
- Id: `"<bodyName>#<kind>-<n>"`, `n` from the body's own seeded stream (`seededStream(GALAXY_SEED, body)`; the first draws are thrown away, as `depositStore.bodyStream` does). Stable across runs and saves.
- Kinds (can overlap via `tags`): `resource`, `settlement`, `industrial`, `infrastructure`, `strategic`.
- Sources, all existing: `planetTerrain.surfaceOf` (land, mountains, coast: where settlements and industry fit), `bodyTopography` (real maps), `data/deposits.ts` (hyperium/exotic), per-`World.reserves` kinds in Complex, `KeySlot`s (capital, cities, spaceports: **keep their node ids**, so the ground war and `keyNames` are unaffected; each becomes a settlement/strategic site).
- Not given to every body: gas giants get aerostat sites only; belts get resource sites; dwarfs/moons get few.
- Fields: `id, bodyName, kind, tags, node?` (surface node index for ground-map placement), `suitability` 0..1, `capacity` (district-level equivalents), `deposit?` `{ good, reserve }`.
- Runtime: `state/locationStore`: `established: Record<id, { ownerId, since }>` and `reserves: Record<id, number>`; everything else is regenerated on demand and memoised (like `surfaceOf`).

### 2.3 Claims (M3)
```
Claim { id, scope, claimantId, status, basis, since, evidence: ClaimEvidence[], supersededBy? }
status: 'provisional' | 'contested' | 'recognized' | 'superseded' | 'withdrawn'   (unclaimed = no claim)
basis:  'founding' | 'settlement' | 'treaty' | 'transfer' | 'seed' | 'recognition'
```
- `contested` is derived, not stored: a scope with two live non-superseded claims by different claimants. Stored status stays `provisional` or `recognized`; the contest is computed so it clears itself when one withdraws.
- Transitions are explicit functions (`establishClaim`, `strengthenBySettlement`, `recognize`, `withdraw`, `supersede`, `transfer`). Nothing becomes `recognized` through a numeric threshold; recognition needs a treaty/diplomatic act or a seed.
- Settlement-based claims have a defined scope: a colony claims **its location(s) plus a radius of nearby sites on that body** (`SETTLEMENT_CLAIM_RADIUS`), never the system.
- Survey and a first ship create **no** claim. A Starbase creates a *presence* record, not a claim; it may support a provisional system claim only if its builder files one.

### 2.4 Frontier Situation
Derived, per scope: no recognized sovereign. Carries `{ claimants, presence (Starbases, settlements), priority }`. `priority` goes to the earliest provisional claim holder with a settlement in scope; it grants first right to build there and gives rivals an incident if they build inside, but does not stop them physically.

### 2.5 Central rules (`scene/jurisdiction.ts`, pure)
```
jurisdictionAt(loc, state)        -> { sovereign?, claims, frontier, disputed, agreements }
authorizeConstruction(req, state) -> 'authorized' | 'treaty' | 'limited-right' | 'contested'
                                     | 'needs-permission' | 'prohibited' | 'military-restricted'
                                     | { physical: reason }
```
Legal outcome and physical feasibility are computed separately and combined as `{ legal, physical }`; the UI shows both. UI, AI, resolvers, `canColonize`, `canBuildStarbase`, and building placement all call these; none re-derive sovereignty.

### 2.6 Legacy bridge (as built in M3; this replaces the earlier "derived view" sketch)
Five tests and the sandbox set `territoryStore.bodyOwner` directly and 71 files read it, so making it a derived view would have broken them and bought nothing. As built:
- **`bodyOwner` stays the authority for recognized BODY-WIDE sovereignty** (it already meant exactly that: "changes only by treaty"). **Claims** (`state/jurisdictionStore`) hold everything weaker or narrower: provisional claims, region and location claims, system claims. `jurisdictionOf` reads both, with `bodyOwner` outranking a recognized body claim at body level so a stale claim can never outvote it.
- Recognizing or transferring a body-scope claim goes through `scene/sovereignty.ts`, which records the claim and writes `bodyOwner` (via the existing `claimBody` / `cedeBody`). A test pins who may call those writers.
- `systemClaim` / `shownClaim` are **unchanged** in M3: the map's border rule still counts Starbases (existing tests assert it). They are drawing rules, not legal ones: `jurisdictionOf(system)` never looks at a Starbase. M7 removes the coupling from the border drawing too.
- `cedeBody` still moves a world's economy with it (the Complex cession). Separating property from sovereignty for the economy is M5. Established development sites (`locationStore`) and claims are never moved by a transfer.
- `claimBody` (a colony founded on unowned ground) still sets body-wide ownership at once: M4 turns founding into "establish a site + file a settlement claim".
- `canColonize` and `canBuildStarbase` now ask `decideConstructionNow`; with no claims on the ground it says "authorized", so today's games play as before.

## 3. Colonization (shared by both modes, built M4)
Same chain in both: survey -> choose site -> Colony Ship founds a settlement **at a location** -> creates claim (settlement-scope), property record, initial facilities. No Simple-only shortcut: `colonies.ts` moves from "claim the body" to "establish a location + claim its scope". Colony stage (micro/planetary) is kept.

## 4. Economy: several owners per body

### 4.1 Complex (the user's own code)
Today one `World` per body, found by `worldByName`. Target: **one `World` per (body, owner)**, as decided in `colonies-design.md` 2d.
- `World.id = "<body>@<ownerId>"`; new field `bodyName`; `name` stays the display name. A body with one owner keeps one world, so every existing seed, test and save-of-the-future behaves the same.
- API: `worldOf(body, ownerId)`, `worldsOnBody(body)`; `worldByName(worlds, name)` stays as "the body's principal world" (largest by population, ties by owner id) during the transition so callers migrate one at a time. Principal-world is only for display and single-owner assumptions; new code must use `worldOf`.
- Co-located worlds trade through `economy/internationalTrade` with a local (zero-FX, low-freight) route, gated by jurisdiction (M9) and war.
- `pop`, `land`, `districtCapacity` of a body are split by location ownership: a world's capacity is the sum of `capacity` of the locations its owner established.
- `setWorldOwner` is retired for sovereignty changes (property does not move with sovereignty); kept only for explicit nationalization/sale.
- Callers to migrate (from grep): `state/nationEconomy.ts` (5), `scene/shipyardLogic.ts` (4), `scene/techResources.ts` (3), `hooks/useContextEconomy.ts` (3), `state/territoryStore.ts`, `state/armyStore.ts`, `scene/peace.ts`, `scene/groundLogic.ts`, `scene/gameSetup.ts`, `hooks/usePlayerEconomy.ts`, `components/InspectPanel.tsx`, `components/ArmyViews.tsx`; tests: `territory`, `holdings`, `diplomacy`. The economy worker and `economyStep` take `World[]` and do not care about body sharing.
- Not in M2-M3. Order inside M4-M5: add `bodyName`/id scheme with no behaviour change -> migrate callers -> allow a second world on a body.

### 4.2 Simple
`abstractEconomyStore` already keys `WorldState` by `bodyName`. Target: key by `"<body>@<ownerId>"` the same way, `land` capped by the owner's established locations. `bodyName` stays a field.

### 4.3 What is aggregated
Simple: production and consumption per world, buildings assigned to a site but not individually simulated, transport as monthly capacity (M6). Complex: per-building, per-pop. Locations, claims, deposits and networks are identical in both.

## 5. Save/load (new)
Today nothing saves. Design:
- `state/gameStores.ts` (moved out of `gameReset.ts`): the registry `{ key, store, kind: 'game' | 'ui', version, migrate? }`. `resetGame` and `saveGame` both read it. A test fails if a `create(` store exists that is not registered, so new stores cannot be forgotten.
- Saved: game stores only (user decision); UI/window/workspace/confirm/hover/debug/map-mode stores are `kind:'ui'`, never saved. `settingsStore` stays preferences.
- Codec: `getState()` minus functions; `Set` and `Map` encoded as tagged objects; `undefined` stripped; numbers must be finite (guard against NaN).
- Envelope: `{ format: 'trconquest-save', version, savedAt, gameVersion, stores, economyWorker, module }`. Per-store `version` + `migrate(oldJson, fromVersion)`; a missing migration for an older save is a hard, readable error, never a silent partial load.
- Outside-store state: `data/countryData` dynamic countries (store the `Country` objects and re-`registerCountry` on load, after `resetDynamicCountries`), `economyEngine` (cancel the in-flight month before saving, rebuild queue state on load), `hooks/fightPace`, jump-roll seed, surface/body caches (cleared). Generated galaxy is deterministic from `GALAXY_SEED` and not saved.
- Economy worker: the 20 empires live only in the worker. Add `export-empires` / `import-empires` messages with `EmpireSim.toJSON/fromJSON`; ~2 MB, gzip via `CompressionStream` when present. The nations' Complex economy is already main-thread store state.
- Restore order: pause the clock -> `cancelEconomyFlight` -> `resetGame` -> set stores in dependency order (territory/claims before locations before economies before ships) -> import empires -> clear caches -> resume paused.
- Storage: IndexedDB slots (list, load, delete, overwrite confirm) and file export/import (`.trsave.json.gz`). Menu entries in `components/EscapeMenu.tsx` and the main menu. Autosave: later, off by default.
- Tests: `tests/saveLoad.test.ts` round trip over every registered store; advance N months after restore equals an uninterrupted run (deterministic seeds); registry guard; codec edge cases; a migration stub; claims, locations and multi-jurisdiction setups survive (acceptance I).

## 6. Orbital, military, access (design only; M8-M11)
Orbital zones per body (`low`, `high`, optionally `L-points`) with their own jurisdiction (default: the body's sovereign, overridable by claim/agreement) and a military controller derived from `combatStore`/fleet presence/blockade. Foreign stations are assets with a jurisdiction, never sovereignty. Occupation stays `bodyController`; blockade is a derived flag on supply routes. Transfer, occupation and blockade are three separate operations in `peace.ts`/`armyLogic.ts`.

## 7. Diplomacy hooks (M9)
Reuse `diplomacyStore` (opinion, events, incidents) and `treatyStore`. Add incident kinds `unauthorized-construction`, `disputed-settlement`; add treaty provisions as data (`construction-right`, `transit`, `basing`, `concession`, `joint-admin`) each with scope and parties. `encroachment.ts` is generalized from "system has one owner" to "jurisdictionAt says someone else governs here".

## 8. Sequencing

| # | Milestone | Depends on |
|---|---|---|
| S | Save/load system | none (do first so every later milestone is saved from day one) |
| 2 | Development locations | S |
| 3 | Claims, sovereignty, Frontier, central rules | 2 |
| 4 | Unified colonization + Complex World-per-(body, owner) | 3 |
| 5 | Site-based buildings, extraction, construction rights, foreign assets | 4 |
| 6 | Infrastructure and transport economy | 5 |
| 7 | System sovereignty, remove Starbase coupling | 3 |
| 8 | Orbital jurisdiction and control | 3, 7 |
| 9 | Diplomatic agreements and access | 3 |
| 10-14 | Urbanization, occupation, AI, UI/overview, ground combat | earlier |
S moves ahead of M2 because the user asked for real saves and every new store must register at birth. M7 depends only on M3, so it can ship before M4 if wanted.

## 9. Intentional simplifications
- Saves are for the same game version plus per-store migrations; no cross-version guarantees before a store's `version` is bumped.
- Locations are strategic sites, not provinces; no per-house simulation.
- `contested` is derived, so claim history before a withdrawal is kept only in `evidence`.
- Nobody's sovereignty ever changes from a numeric threshold; recognition is an event.

## 10. Risks
1. 58 consumers of `bodyOwner`/`systemClaim`: mitigated by the derived compat view and a writer-pinning test.
2. Complex World identity change touches ~15 callers and the worker boundary; staged behind the principal-world shim.
3. Save of economy worker state (2 MB) and in-flight months: cancel-before-save rule.
4. Tuning: `SETTLEMENT_CLAIM_RADIUS` and priority rules are new balance numbers; put them in `data/territoryData.ts`, not inline.
5. Existing tests that assume "one owner per body" (`territory`, `colonies`, `holdings`, `diplomacy`) must stay green unchanged through M3.


## 11. As built (2026-10)

All fifteen milestones of `combined-spec.md` are implemented, plus the save system (S) that this plan put first. Where the build differs from sections 1-10:

| Milestone | Where | Notes |
|---|---|---|
| S Save/load | `state/gameStores.ts`, `saveCodec`, `saveGame`, `saveStorage`, `components/SaveSlots.tsx` | envelope v2; IndexedDB slots + `.trsave.json.gz` files; empires saved from the worker; `upgradeLegacyTerritory` for v1 files |
| 2 Locations | `data/locationData.ts`, `scene/locations.ts`, `state/locationStore.ts` | derived and deterministic; only `established` is saved |
| 3 Claims/jurisdiction | `scene/claims.ts`, `scene/jurisdiction.ts`, `scene/sovereignty.ts`, `state/jurisdictionStore.ts` | `bodyOwner` stays the body-wide authority (section 2.6) |
| 4 Colonization | `scene/colonies.ts`, `economy/colonySeed.ts` | both modes; **Complex `World` per (body, owner) was NOT built** (see below) |
| 5 Site-based buildings | `scene/placement.ts`, `scene/placementOrders.ts`, `state/placementStore.ts` | the ledger records WHERE; the economies keep HOW MANY |
| 6 Infrastructure | `scene/infrastructureNet.ts`, `scene/infrastructureOrders.ts`, `state/infrastructureStore.ts` | surface routes; only effect is the per-building output share `siteAccess` |
| 7 System sovereignty | `scene/systemTerritory.ts`, `claimSystemForStarbase` | the map's `systemClaim` drawing is unchanged (a drawing, not a ruling) |
| 8 Orbit | `scene/orbits.ts`, `scene/orbitalState.ts`, `scene/orbitalOrders.ts`, `state/orbitalStore.ts` | scope kind `orbit`; control derived from armed ships + platforms |
| 9 Agreements | `data/treatyData.ts` (5 new articles), `scene/territorialAgreements.ts`, `scene/territorialIncidents.ts` | rights/bans DERIVED from treaties in force |
| 10 Urbanization | `scene/urban.ts`, `scene/urbanState.ts` | derived tiers and specializations; no stored "city" |
| 11 Occupation | `scene/occupation.ts` + rules in jurisdiction, routes, orbit | occupier's limited right; supply cut; platforms cut off |
| 12 AI | `ai/developer.ts`, `scene/aiDevelopment.ts`, `placeUnplacedOrders` | the 7th agent; all through the player's functions |
| 13 UI + migration | `components/planet/{TerritoryTab,DevelopmentTab,SystemTerritoryRows}.tsx`, `scene/territoryView.ts` | view models are plain data and tested |
| 14 Ground combat | `scene/groundSupply.ts`, `GroundWorld.supplyOf`, `capturedBy` | captured sites make nothing; routes with a captured end are cut |
| 15 Validation | `tests/acceptance.test.ts` | scenarios A-J, Simple and Complex, AI over 18 months |

### Intentional simplifications and open items
- **Complex `World` per (body, owner)** (section 4.1) is designed but not built. Nothing in M5-M14 needed a second world on a body: colonies are one nation per body (v1), and foreign facilities are sites in `locationStore`, not worlds. A body with several nations' economies is the one real follow-up.
- `cedeBody` still moves a world's Complex economy with the body (legacy); sites, facilities, routes and claims are never moved by a transfer.
- Complex AIs (inside the worker) and the Simple nation AI order buildings without a site; `placeUnplacedOrders` places them best-effort each month, and an order no site fits is left alone (refusing would add a second rule inside balanced economies).
- Routes are surface only (orbit and interstellar freight stay `launchCapacity` / `interstellarFromWorlds`); no maglev; congestion is per nation.
- Resource depletion stays body-level (`World.resourceDeposits`); Simple minerals stay inexhaustible. Sites say WHERE a mine goes, not how much it yields.
- The AI does not negotiate treaties for territorial rights, and does not file claims beyond what colonizing and Starbases file; it does not recognize or transfer territory.
- Urban tiers are derived and informative: they do not cap population in the economies.
- Ground combat: the existing key-node rules still decide occupation; M14 adds the economic consequences of who holds a site, not a new combat model.
- Tests that assert old behaviour were updated only where the rule changed on purpose: `tests/colonies.test.ts` (Complex is no longer refused).


## 12. Economy and geography as one world (the follow-up round)

The building menus and the development sites were two views of one thing; they are now one model. What was built:

- **Districts are developed AT sites.** `placementStore` holds `levels[site][district]` beside `placed[site][building]`; the economies keep the totals and the
  ledger is reconciled to them (`reconcileBody`: a level lost comes off the site with the most room to spare). A site's capacity caps the levels it can take; one
  level holds 8 building slots in Complex and 4 in Simple. `scene/districtSites.ts` says which district stands on which kind of site (a port or a road network
  stands on infrastructure ground but may also stand in a city: `siteKindsFor`).
- **A building needs a developed slot** at the site it is built on once the body is seeded (`physicalFit(..., developed)`); `planDistrictLevel`/`recordLevel` do
  the same for district levels. Both economies' `queueDistrict`/`queueBuilding`/`queueConstruction` take a `siteId`; their own AIs' orders (no site) are placed
  best-effort each month (`placeUnplacedOrders`).
- **Seeding.** `assignSeed` (pure) puts every starting level and building on a site (extractors where their deposit is, a hyperium deposit never gets levels);
  `seedBodyPlacement`/`ensureSeeded` apply it the first time a body is looked at in a real game (`autoSeed`, set by `setUpNewGame`), so there is no start-up stall.
  Seeded sites are marked `connected` (`locationStore.established[site].connected`): the starting economy was balanced with its freight getting out, so they count as
  connected until an enemy holds them; seeding changes no number in either economy (tested). Simple Venus carries one level beyond its sites' capacity (flagged).
- **Civic buildings, not "civic key sites".** The Senate House, landmarks, municipal buildings and a colony's station are real buildings in the Core district
  (`scene/civic.ts`, `civicStore`, clickable: `CivicBuildingWindow`); spaceports are ordinary Urban buildings. They take no slot and have no economic effect, so no
  calibration moves. The key nodes of the ground war are unchanged: `scene/keyBuildings.ts` is now only the pure source of their names, and the Defense tab still lists the nodes.
  **Simple mode's Core is a display-only card** (government takes no levels there), not a developable district: adding a developable Core to Simple would change its district
  list and tests for no gameplay gain yet; say so if you want it.
- **Building means choosing where.** `scene/siteChoices.ts` + `components/planet/SiteChooser.tsx`: every site of the right kind with its ground, access, room, owner, and the
  LEGAL and PHYSICAL answers apart; every new-building and new-level entry point (planet tabs, Economy nav panels, both modes) goes through it. Upgrades of an existing building
  still pick the best site.
- **By building | By area.** `planetViewStore.view`; `scene/areaView.ts` + `components/planet/AreaView.tsx` show each settlement and site as a card (districts, buildings, civic
  buildings, orders, "+ Level" / "+ Build" at that site).
- **Saves.** `placement` store v2 (migrate adds `levels`, `seeded`, `autoSeed`); an older save with nothing placed starts seeding on load; one that already has placements keeps
  them and the old room rule (`upgradeLegacyPlacement`).

Known gaps: the empires' worlds (worker-only) have no sites; deconstructing a district level reconciles by the "most room" rule, not by a site the player picks; upgrades of an
existing building are not placed by the player.

## 13. Districts you can see and place (the lens round)

Districts are now ground on the map, not just numbers. What was built, in the order a player meets it:

- **Venus has no desert** (`bodyTopography`: its dry interior is plains, as Mars's is). **The government spends only the government's money:** the Complex "Build as" selector is gone from
  every player build entry point; player orders are always `{ kind: 'state' }`, and `tests/venusAndFunding.test.ts` scans the UI so a company can never pay for a player order again.
- **Separate districts.** The Complex `resource` district is split into **mining** and **agricultural** (`economy/recipes.DistrictType`, seed capacities from what each world's buildings use;
  `economy/districtMigration.ts` splits an old save's `resource` levels by building usage, idempotent, applied to the economy store and to the empires' resident worlds). Sites gained a
  matching `agricultural` kind (farmland), generated LAST from a stream of its own, so no existing site id moved (`tests/districtSplit.test.ts`).
- **Footprints are real terrain.** `scene/footprint.ts` (pure) grows each developed site outward over a fixed seeded, cost-weighted ORDER of cells, so a footprint of n cells is always the first n
  of n+1 and a city only grows. Size = levels x cells per level + buildings x cells per building (+ for a settlement, its people: `data/footprintData.ts`); sites claim ground in a fixed priority
  (settlements first, then by id) and never take another site's own node. `scene/footprintState.ts` draws them onto the surface (`urban` / `industrial` / `mining` / `farmland`, new terrain ids the
  ground war reads for movement and defence) in `groundSurface`, **only on seeded bodies**, cached per base surface and signature. The map seeds a world when it opens (`GroundViewScene`).
- **Founding a district where you click.** `locationStore.custom` (founded sites, ids `<body>#<kind>-<n>` from 100) is merged into `locationsOf` through a small registry
  (`scene/customSites.ts`) so the scene layer needs no store; `scene/siteFounding.ts` (ground) + `siteFoundingOrders.ts` (jurisdiction: asked about the candidate as if it existed). Founding is free by
  itself; its first level pays the normal cost. A founded site can be given up only while empty.
- **Zones.** Every district has a zone, the ground it may grow into: the default is the first cells of its growth order sized to hold exactly the capacity it was generated with, a redrawn one
  (`zoneStore.zones`) is what the player painted. **A zone sets the site's capacity** (`capacityFromZone`; the registry feeds `locationsOf`, so every rule that reads `capacity` follows it).
  Untouched buildable ground in no zone is the **rural district**. The **land-use law** (`zoneStore.policy`, per nation: free / permit / restricted, set in the lens panel) decides whether a zone may grow
  into rural land: *permit* files a request decided on an absolute `simDays` deadline (`PERMIT_DAYS`, resolved monthly with the other main-thread syncs). **Nature reserves** are rural cells no zone may
  grow into. Shrinking a zone takes down what no longer fits (`scene/zoneOrders.planZoneEdit` quotes it; the lens asks for confirmation first).
- **Demolition has a price** (`data/demolitionData.ts`, `scene/demolition.ts` pure, `demolitionOrders.ts`): farmland is cheap, industry heavy, a mine's clean-up grows with the depth the site was worked
  to, a city is heaviest and displaces people (they leave unrest behind: `unrestStore`, fading linearly to an absolute deadline, handed to each economy before every month as an OPTIONAL field
  `displacedUnrest`: absent = no change, so no calibration moves). Paid through `economyPayment.pay` (goods in Complex, the strategic pool in Simple); **no salvage**; only the state's own buildings
  can be demolished (a company's are not the government's to knock down). Simple keeps its deconstruction bar; Complex removes at once (`removeDistrictLevel`, `downgradeBuilding(..., {noSalvage})`).
  The placement ledger is cut at the site the player pointed at.
- **Spaceports can be named and placed.** `structureStore.ports`: the world's auto-placed ports are recorded as they were at seeding (nothing moves), later ones stand where the player clicked
  (`portStructures.placePort`) and count as key nodes only once the economy has built them; a renamed port keeps its name on the map and in the key-node list (the pencil). **Defence installations** take a chosen
  node and a name (`defenseStore.build(..., { node, name })`, `judgeInstallationNode`). **Government buildings** stand in a city's Core district: choosing the city (the site) is the choice; they have no node
  of their own (no new data invented for them).
- **The build lens** (the ⚙ panel's first tab, both modes): a palette of district levels, buildings by district (greyed with the reason), defences, roads and railways, zoning and the land-use law. Picking
  one arms it and opens the world's ground map: hover previews the patch (green: it would work, red: it would not, with the reason from the same rules), **left-click** places / founds / redraws / lays and
  the district pulses, **right-click** cancels the order in progress or takes it down with its cost (confirmation first), Esc puts it down. Entry points: `scene/lensActions.ts` (all rules elsewhere),
  `lensOrders.ts` (one way to order a building or level at a site), `lensTarget.ts` (which district is under the pointer), `LensLayers.tsx` / `LensHud.tsx`.
- **Rural life.** Homesteads and farmsteads are derived from the countryside's people (`scene/ruralLife.ts`, `ruralState.ts`): about one mark per two million rural people (more where the land farms), on rural
  ground in a fixed preference order (near water and good land first), never in a nature reserve; nothing is stored and a zone that grows over them absorbs them.
- **Roads and railways are drawn** on the ground map between the sites they join (solid when working, dim while being built, orange in disrepair); the lens has a Road and a Railway tool.

Not built (say if you want them): ranger and relay stations; separate seaport markers on coasts; painting a zone by DRAGGING (the brush paints per click so the camera drag is untouched); hiding the
three-way "permit" decision behind a separate government approval screen (the request is decided on its deadline).

Known quirks: demolishing a district level in Simple mode takes months (its bar), though its cost is paid at once; the lens right-click cannot take down a spaceport (it is taken down from the economy panel).

## 14. A building belongs to a place (2026-10-14)

A building built in a different place is a different building: two factories in X are ONE Factory at level 2 in X; two in Y are another Factory at level 2 in Y (two buildings, four levels).

- **Model (Complex).** `Building.siteId?` (`economy/economyTypes.ts`); a building is identified by (recipeId, owner, siteId) and `level` is how many stand THERE. `economy/buildingSites.ts` (pure): `buildingKey`, `findBuilding`, `levelOf`, `levelAtSite`, `splitBySites(buildings, ledger)` (idempotent; level, inventory, profit, jobs shared out in proportion so a month's output is unchanged), `mergeSites`. A finished order merges by that key (`economyTick`), so an order with a `siteId` stands at that site and a site-less one joins the unplaced building. Unplaced = no `siteId` (empire sims, an AI build not yet placed, an old save): behaves as before.
- **Ledger.** `placementStore.placed` still decides legality and slots, but in Complex `reconcileBody` is now building-driven (`reconcileComplexBuildings`): ledger at a site = tagged buildings + orders there + units an unplaced building has claimed; anything above that is a ghost (a downsized level, a cancelled order) and goes at exactly that site.
- **Seed / saves.** `seedBodyPlacement` splits the world after `assignSeed` (Complex). Save envelope v3: an older file is split by its ledger on load (`saveGame.upgradeBuildingsToSites`).
- **Access.** `Building.siteAccess` is per building from its own site (`syncSiteAccess` writes keys `recipe@site`; unplaced ones keep the per-recipe aggregate; a building on a site an enemy holds makes nothing).
- **Both modes, one list.** `scene/placedBuildings.ts`: `placedBuildings(body)` = rows {id, siteId|null, level, buildingId?}; Complex from `world.buildings`, Simple from the ledger less what is only on order (its economy keeps counts, so the ledger IS its per-place record). `buildingTotals` gives "Factory: 4 levels in 2 places".
- **UI.** The planet's "Buildings" tab (`components/planet/BuildingsTab.tsx`, view model `scene/buildingsView.ts`) replaces By building / By area: each place is a card with its Core / Urban / Industrial (Academic / Generator in Simple) district blocks, their buildings as tiles with their level there, a per-district + level / + Build with the REASON shown when refused (`queueDistrict` and `queueConstruction` now return `{ok, reason}`), the orders with cancel, the military district level, foreign firms and (Complex) Manage buildings. Economy > Buildings rows and the building window name the place.
- **Not changed:** land caps (a density-cost model is a separate plan), `World` per (body, owner).
- **Baseline test fix.** `acceptance.test.ts` / `aiDevelopment.test.ts` summed the raw ledger as slots, counting slot-free spaceports (Earth's 8 at one infrastructure site): a test accounting bug, not a game bug; they now use `slotsUsedBy`.
