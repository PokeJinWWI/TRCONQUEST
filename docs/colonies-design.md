# Colonies, cities and shared worlds — design proposal

**Status:** version 1 is implemented (Simple mode only, see "Version 1" below). The rest of this doc is still the plan. Requested by the co-op partner (economy/politics track); written by the combat/navy track.

### The project owner's colony rules (2026-09-28)
- Colonies are founded by **colony ships**, one colony at a time on a planet. Several colonies may share a planet; a planet wholly claimed by one nation counts as one colony.
- **Every colony, the starting ones included, has a planetary outpost.**
- Founding costs **Influence**: a national stockpile capped at 1,000, +2 a month by default; the cost varies.
- A new colony is a **micro-colony**. It becomes a **planetary colony** once its orbit is uncontested (for now: warships designated **patrol ships** orbit it for a period, 90 days) and the colony itself is uncontested.
- Micro and planetary colonies have the same economy; a micro-colony just has smaller limits.

### Version 1 (built)
One nation per planet: a colony claims the whole planet; shared planets (regions, §2c/2d) are version 2.
- `data/colonyData.ts` (tuning), `scene/colonyLogic.ts` (pure: cost, outpost placement, patrol clock, promotion), `scene/colonies.ts` (founding, seeding, settlers, Influence), `state/colonyStore.ts` (one row per colonized body; owner = `bodyOwner`), `hooks/useColonyResolver.ts`.
- **Influence** is a `resourceStore` resource outside `SIMPLE_GOODS`: never traded, never paid in reparations. Start 100, +2/mo, cap 1,000.
- **Cost** = 20 + 10 × planet size (districts) + 5 × light-years from the capital (small moons ~50, Titan 70, Earth 100).
- **Colony Ship** (civilian, no tech): takes 20 million settlers from the capital when built. `colonize` command needs Simple mode, the world surveyed, unowned, with land, no hostile warship in orbit, settlers aboard and the Influence. It founds a micro-colony: the owner, a Simple-economy world (the settlers, land capped at 3), the outpost key node and a garrison; the ship is used up.
- **Moons have their own orbits**: a Colony Ship must orbit Titan itself to settle it, and patrol ships must orbit Titan to hold its orbit. At system scale a moon sits on its planet (`shipPhysics.bodyLivePosition` resolves a moon to its planet's position), so the trip is the planet's; the satellite view draws the ship circling the moon.
- **Patrol duty** (armed ships, signal-delayed like the bombard stance): 90 days of the owner's patrol ship in orbit with no hostile warship, then promotion if nobody else holds ground there and no enemy army stands on it. A hostile warship resets the clock.
- **Micro-colony limits:** land capped, can't recruit. Planetary: full land, can recruit (in Simple mode every planetary colony counts as a settled world, the seeded outposts too).
- **AI** (Simple mode): the Expander colonizes the cheapest surveyed unowned world it can afford, and puts one spare warship on patrol at each micro-colony (released once it's planetary).

### Decisions (answered by the co-op partner and the project owner)
- **Partial ownership is by region** (landmass + city footprint), not by percentage; region granularity follows this doc's proposal (no drawn borders).
- **Economy: Option B** — one `World` per (body, owner). Several markets on one planet, linked by local trade (reusing `internationalTrade`). Larger change, cleaner accounting.
- **Undersea habitats are vulnerable to ships/bombardment only after a tech** (until then a large defense multiplier).
- **Settlers come out of a nation's pops, in every economy mode.**
- **Hycean life support is a VERY late-game tech.** Until then hycean worlds are only inhabitable by a hycean-world species, which doesn't exist yet (today's species: human baseline + one other). That species is a future task; nothing here depends on it.
- **Proxima c stays Orion-owned, and is treated per species:** for non-hycean species it is essentially a **gas giant** (aerostat settlements in the upper atmosphere — the `aerostat` terrain already exists); for a hycean species it is an **ocean world**. Hycean worlds have **no land** at all, and need their own mechanics.
- **Non-hycean ocean worlds are covered too:** floating settlements and seabed settlements, both locked behind tech.
- The economy changes are the partner's; ships/map/territory/tests are ours.

The four asks:
1. Partial ownership of a planet (cities and land can be divided up).
2. Proxima c is hycean, yet has land.
3. Water worlds: floating and underwater colonies, and tech to live under the sea.
4. Mechanics for founding colonies and cities, and growing new urban areas.

---

## 1. What the code does today (facts, checked)

| Area | Today |
|---|---|
| Ownership | `territoryStore.bodyOwner`: **one owner per body**, seeded from `planet.ownerId`, changed only by treaty (`cedeBody`). `bodyController` = occupier. |
| Per-place control | `nodeHolders[body][node]` already exists: a sparse "who holds this fine node" map, painted by the ground war and read through `holderOf(body, node, owners, holders)`. Ownership itself has no node layer. |
| Economy | One `World` per inhabited body (`economyTypes.World`): one `ownerId`, one `pops`, `buildings`, `market`. `cedeBody` moves the whole World (`economyStore.setWorldOwner`). Only 6 worlds have one (Mars, Luna, Venus, Arcadia, Proxima b, Lalande 21185 d). |
| Cities on the map | Not stored. `planetTerrain.placeKeySlots` derives capital/city/spaceport/outpost **slots** from the terrain and the settlement tier (`capital`/`world`/`outpost`/`wild`); a city is urban terrain around a slot. Slot count comes from `citiesForDistricts(estimateSize(radius).districts)`. |
| Land in the economy | `World.land` = max district levels; `districts` = levels built (`economy/districts.ts`). Not tied to map geography. |
| Colonising | **Nothing.** There is no colonise command, no colony ship, no new World created at runtime. Worlds and owners are seed data. Starbases claim *systems*, not bodies. |
| Water worlds | `planetClass: 'hycean'` (Proxima c: 14,000 km, Orion-owned, **no economy World**) and `'ocean'`. `SURFACE_CLASSES.hycean.landFraction = 0.12`. |
| Why Proxima c has land | Two causes in `planetTerrain.surfaceOf`: the class spec gives 12% land, and a loop **raises land by 5% steps until a mainland of `MIN_MAINLAND_FRACTION` exists** (fine for continental worlds, wrong for a global ocean). Real-map bodies skip this loop. |
| Floating precedent | Gas/ice giants already have an `aerostat` terrain ("Aerostat Platforms": walkable, slow, paintable) in a latitude belt — a settlement surface with no ground under it. |
| Tech | `techData.ts`: Physics is filled in; **Society is the partner's and empty; Engineering is nobody's yet.** Gates like `ShipClass.requiresTech` exist. |

## 2. Proposed model

### 2a. Water worlds (small first step, unblocks the rest)

Two different kinds of water world, handled by one **habitat-by-species** rule:

- **Ocean worlds (non-hycean)** — `planetClass: 'ocean'` and friends: liquid water over land and/or seabed. Settle on land as today, plus two tech-locked kinds:
  - **Floating settlement** (surface): a platform city on an ocean node. Walkable by `all`/`amphibious` units, hit by ships and orbital fire like any surface city.
  - **Seabed settlement** (undersea habitat): a dome/hab on an ocean node. Reachable on the ground only by `amphibious`/`marine` units; a large `defense` multiplier while no penetrating-weapons tech exists (decision above), then ordinary vulnerability.
- **Hycean worlds** — deep global ocean under a hydrogen-rich atmosphere, **no land at all**:
  - `SURFACE_CLASSES.hycean.landFraction = 0` and an `oceanic: true` opt-out of the mainland-growth loop in `planetTerrain.surfaceOf` (that loop, plus the old 12%, is why Proxima c has land). The map is all ocean; `mainland < 0` already means "no key slots".
  - **For non-hycean species (everyone today) it counts as a gas giant:** the only settlements are upper-atmosphere `aerostat` platforms (existing terrain and rules), on a belt like a giant's.
  - **For a hycean species it counts as an ocean world:** floating and seabed settlements. Living under the sea there needs a VERY late tech (`Deep Hab Sealing`); until it and a hycean species exist, nothing settles it that way.
- **Habitat rule (data-driven):** each surface class lists which settlement kinds it allows *per species type* (`land`, `platform`, `undersea`, `aerostat`) in `data/groundData.ts` next to `SURFACE_CLASSES`. A species template (`economy/species.ts`) gains a `habitat` field (default `terrestrial`; future `hycean`). A colony ship checks the rule for the species of its settlers.
- **Tech gates** (Engineering tree, empty today — this fills its first branch): `Floating Platforms` → `Pressure Habitats` (seabed) → `Deep Hab Sealing` (very late; hycean-species undersea life). Costs/values TBD by the owner of Engineering.

### 2b. Founding colonies and cities

- **Colony ship** (new civilian ship class, like the Construction Ship): carries settlers/goods in its hold; command `colonize` (via `queueShipCommand`, same signal delay as survey/build); fires on arrival. Requirements: the body is **fully surveyed**, has no owner (or the region is unclaimed), the ship's nation has the tech for the settlement kind, the hold has the settling goods, and **the colonists come out of the nation's pops** (all modes: the ship draws them from the nation's population when loaded, and they seed the new World's pops). AI uses the same command (Expander gets a "colonize" step, same rules as the player).
- **Founding creates a World:** `economyStore.createWorld(bodyName, ownerId, seedPops, settlementType)` — this is the **economy side (partner)**. Simple mode has the analogue in `abstractEconomyStore` (worlds there run on owned bodies already). Complex-mode economy stays untouched by Simple changes and vice versa.
- **Founding a city** on an existing World: an order that consumes goods/construction and adds a **city slot** at a chosen node (ground map click, like Build). Rules: on a habitable surface for that settlement kind, a minimum distance from other cities, adjacent to the World's existing land (or ocean node for platforms), capped by `World.land`/districts so the map and the economy agree.
- **City slots become stored state** (today derived). `state/settlementStore.ts`: `{ body, node, kind: 'city'|'platform'|'habitat'|'outpost'|'spaceport'|'capital', ownerId, foundedAtDay }`. `placeKeySlots` stays as the *initial* layout for seeded worlds and is loaded into the store; new cities append. Key nodes/ground war read this store (via `groundKeySurface`, which already merges economy spaceports and installations).

### 2c. Partial ownership (by region)

- **A per-node owner layer**, parallel to the existing per-node *holder* layer: `nodeOwner[body][node] = countryId`, sparse, absent = the body's `bodyOwner`. `holderOf` (control) still resolves `nodeHolders` first, then `nodeOwner`, then `bodyOwner`. Everything that asks "who owns this place" goes through one function `ownerOfNode(body, node)` in `scene/territory.ts`; `bodyOwner` becomes the *default* owner (the "majority" owner).
- **Regions:** the unit of division is a **landmass region** = a connected group of nodes (`BodySurface.landComponent`) plus, for a city, the city's urban footprint. A treaty cession or a colony founding by another nation gives a nation a region, not the whole body.
- **What a region carries:** its cities/platforms/habitats (settlementStore rows) and the land around them. A nation "owns a body" for system-claim purposes when it owns **any** claimed region (contested systems already exist for multi-owner systems; a shared body makes the system contested, shown on the border/map).
- **Peace cession** (`cedeBody`) gains a sibling `cedeRegion(body, regionNodes, countryId)`; `evaluatePeace`/war score value a region by the settlements in it (capital/world/outpost values already exist in `warScore.ts`).
- **Ground war:** already node-based — holders paint nodes. Occupying a region's key nodes moves *control*; a treaty moves *ownership*. No new combat rules.
- **Orbital superiority / invasion** stays per body (fleets orbit bodies). Invading a shared world needs war with the controller of the target region.

### 2d. The economy split (partner's side — the biggest change): Option B

**One `World` per (body, owner)**, decided by the partner. A shared body is several ordinary Worlds (ids like `Mars` and `Mars·<owner>`; the first keeps the plain body id), each with its own pops, buildings, market and treasury flows, and no new accounting cases.
- **Local trade:** the Worlds of one body trade with each other through the existing `internationalTrade` machinery, with no spaceport or freight cap (they share a planet) but with the normal FX/tariff rules, peace only (a war closes the border).
- **Founding a colony on a body another nation already holds part of** creates a new World for the founder there.
- **Ceding a region** (`cedeRegion`) moves the pops and buildings whose city is in that region into the receiver's World for that body (created if needed) — the per-region analogue of today's `setWorldOwner`.
- `World` gains `regionIds` (the settlements it covers); `bodyOwner` stays as the body's default/majority owner; seeded worlds are single-owner and unchanged.
- Migration: a `worldsOfBody(bodyName)` accessor replaces `worldByName` for anything that means "the economy on this body"; `worldByName(id)` keeps meaning one World.

## 3. Proposed work split

**Partner (economy):** decide A vs B; `createWorld`, city/platform/habitat as building/district kinds; per-region ownership of pops/buildings; new Engineering-tree tech content; Society/law hooks for immigration if wanted.
**Combat/navy track (us):** hycean/ocean surface rule; platform/undersea terrain layer and map rendering; `settlementStore`; `nodeOwner` layer + `ownerOfNode` and migration of readers; colony ship class + `colonize` command + AI step; region cession in peace/war-score; ground-war reads for shared bodies; tests per mechanic (`tests/colonies.test.ts`, `tests/regions.test.ts`, `tests/waterWorlds.test.ts`).

## 4. Suggested order (each step ships and passes the sweep on its own)

1. Water-world surface rule (2a, land only): hycean → no land, Proxima c treated as a gas giant for non-hycean species. Small, visible on Proxima c, no economy impact.
2. `settlementStore` + migrate key-slot reads (no behaviour change; sets up cities as data).
3. Colony ship + `colonize` command creating an *unowned-body → owned outpost* first (no economy World yet), with tests and AI.
4. Partner: `createWorld` + city founding (2b) on top of step 3.
5. `nodeOwner` layer and `ownerOfNode` (2c), region cession, then the economy option A/B change (2d).
6. Floating/undersea settlement kinds and the Engineering tech gates (2a rest).

## 5. Still open

1. **Penetrating weapons tech** for hitting seabed habitats: which existing weapon line does it hang on (Physics is populated; this needs a node), and how large is the depth defense multiplier before it?
2. **Settler cost:** how many pops does a colony ship carry, and does removing them from the source World have a stability/labour effect (Complex) or just a population number (Simple)?
3. **Aerostat belt on hycean worlds:** same latitude belt as gas giants, or the whole atmosphere? (No data exists; nothing assumed.)
4. **The hycean species** (needs, habitat, name) — future task for the partner; the `habitat` field is the only hook this design needs now.
5. **Region cession terms** in peace deals: are regions offered one by one, or as a bundle per body? (`peace.ts` `PeaceTerms` currently cedes whole bodies.)
