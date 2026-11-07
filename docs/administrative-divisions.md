# Administrative divisions: districts, provinces, macro-regions

**Status:** plan, not built (2026-10-21). Builds on `docs/territorial-design.md` (sites M2, claims M3, colonies M4, site buildings M5 and later).
Prototype: the "Earth in three tiers" sketch artifact (watershed districts sized by population on the +70 m terrain), built during the planning
conversation; the algorithm below is the same one, moved from a 1024x512 grid onto the body's surface mesh.

## 1. Decision

Keep the current system: development sites, claims and jurisdiction, `bodyOwner` as recognized body-wide sovereignty, site-placed buildings.
Nothing is replaced. What is added is **one fixed geography layer above the sites**, so every piece of dry ground belongs to a named unit:

| Tier | What it is | Earth default |
|---|---|---|
| **Macro-region** | whole provinces | ~10 |
| **Province** | whole districts | ~80 |
| **District** | a watershed sub-basin of the surface mesh; the base unit | ~500 |
| Site (exists) | a point inside a district where people live, resources lie, buildings stand | unchanged |

Pops, buildings and districts-as-economy (the Complex/Simple "district" levels) stay on sites. The new tiers carry ownership, claims,
occupation and display. Naming clash to settle (section 9): the economy already uses "district" for building districts.

## 2. What is wrong today (why)

- **Claims have no area.** A settlement claim covers every site within `SETTLEMENT_CLAIM_RADIUS_CELLS` (12) of its anchor (`scene/claims.scopeCovers`).
  Cells are reference cells (`REFERENCE_CELL_RAD` 0.0755 rad), so the radius is about 52 degrees of arc: ~5,800 km on Earth, the whole of any
  small moon, the same angle on every body. Ground between sites belongs to nobody.
- **Colonies take the whole body.** `colonies.ts:192` still calls `claimBody`, so one colony makes the body its nation's.
- **One economy World per body.** `worldByName` (79 references) assumes one; a second owner on a body has nowhere to live.
- **Every system has its own "where".** The ground war captures key nodes (`nodeHolders`), zoning draws polygons, freight runs site-to-hub
  trees, migration works per body, founding spacing is a cell distance (`SITE_MIN_SEPARATION_CELLS`, `OWN_SETTLEMENT_MIN_SEPARATION_CELLS`).
  None of them can answer "whose ground is this?".

## 3. Rules of the layer

1. **Every dry node is in exactly one district; every district in one province; every province in one macro-region.** No wasteland: empty
   land gets large districts, never none. Seas, gas giants and belts have no divisions (belts keep their sites).
2. **Borders follow geography.** Districts are drainage sub-basins, so borders run along watersheds and a river runs through a district, not
   along its edge. No straight survey lines.
3. **Size follows people, with a floor of land.** Each node weighs `population + LAND_WEIGHT x area` (Earth default: land is 25% of the
   total weight). Dense ground is cut small, empty ground stays big.
4. **Pure, deterministic, lazy.** Derived from the body's own data (mesh, relief, sites), memoised per body, generated the first time a body
   is looked at (like `locationsOf`). Same answer in Simple and Complex, on every load, whoever owns the body.
5. **Stable ids.** `"<body>/d<root node>"` for a district (its drainage outlet node), province and macro-region ids from their heaviest
   district's root. Ids move only if the inputs move; `DIVISIONS_VERSION` and a save migration cover that, as sites did.
6. **Sites belong to districts by their node.** `districtOf(siteId)` is derived, never stored.

## 4. Generation (`scene/divisions.ts`, pure; tuning in `data/divisionData.ts`)

Inputs per body: the fine surface mesh (`surfaceMesh()`, 40,962 nodes, ~110 km apart on Earth; Earth has ~13,000 dry nodes), the land mask
from `surfaceOf`, relief (`reliefOf(topographyOf(body))` on real bodies; the procedural elevation ranks `planetTerrain` already computes on
others), and a per-node population weight.

1. **Drainage.** Priority-flood from every coastal node (and the poles of a body with no sea): each dry node gets a downstream neighbour,
   pits filled, ties broken by node index. The result is a drainage tree per coast outlet.
2. **Districts.** Walk the tree upstream-first. Where two tributaries each carry at least `Wmin` of weight, each becomes its own district;
   where a basin passes `Wmax`, cut it there. Merge slivers below `0.8 x Wmin` into the neighbour with the longest shared border (an islet
   into the nearest district). Calibrate `W` so the count lands within 4% of the target.
3. **Provinces, then macro-regions.** Agglomerate: the lightest unit merges with the neighbour minimising `(w_a + w_b) / sqrt(shared border)`
   (small pairs, compact shapes) until the target count is left; a unit with no land neighbour joins the nearest by centroid. Nesting is
   exact by construction.
4. **Names.** A district or province is named for its largest settlement site; failing that, its IAU region name (`bodyTopography.regionAt`,
   real bodies); failing that, the founding nation's name pool (`scene/keyNames`). Macro-regions get hand-written names on Earth, Mars and
   Venus (a small table in `data/divisionData.ts`), compass names elsewhere.

**Population weight.** Settlement sites by their share of the body's people (`urban.shareOutPopulation`), capital and city key slots, plus a
smoothed spread so rural ground is not zero. For Earth, an optional build-time bake (`scripts/divisions/earthPopulation.ts`, never shipped,
like `scripts/terrain/`) turns Natural Earth's public-domain city list into a per-node weight: cities under the +70 m sea move to the nearest
dry node, and the setting's anchors (`data/earthEconomicGeography.ts`) add a modest boost where people have moved poleward. Output
`data/earthPopulation.ts` (one small array). The prototype used exactly this: 7,332 cities, 2,281 drowned ones (~1 billion people) moved inland.

**Targets per body** (`DIVISION_TARGETS`): Earth 500 / 80 / 10; Mars and Venus fewer (proportional to people and land, minimum 1); a body
smaller than `MIN_DIVIDED_RADIUS_KM` is one district = one province, with no macro tier. A body with one district behaves exactly as today.

Cost: Earth's ~13,000 dry nodes take well under 100 ms; still lazy, and never generated for every body in a render or at boot (the
`locations.ts` rule).

## 5. How each system plugs in

**Claims and jurisdiction** (`scene/claims.ts`, `scene/jurisdiction.ts`, `scene/sovereignty.ts`)
- Scope kinds gain `district` and `province`; `region` (anchor + radius) is retired. Specificity: location > district > province > body > system.
- A settlement claim covers **the district of its settlement**, not a 12-cell radius. `SETTLEMENT_CLAIM_RADIUS_CELLS` is deleted.
- Old saves: each `region` claim becomes a `district` claim on its anchor site's district (save migration).
- `holderOf(districtId)` = the recognized claimant by the usual jurisdiction rules; "contested" stays derived.

**Colonies and shared bodies** (`scene/colonies.ts`, `canColonize`)
- Founding files a provisional district claim (as now, but on the district) and recognizes it as today's founding does. `claimBody` is called
  only on a body with a single district; on a divided body the colony owns its district, not the body.
- `canColonize` refuses a district another nation holds or claims, and allows the rest of the body. Claim planet (`scene/planetClaim.ts`)
  stays as the body-wide claim it already is.
- Starting worlds: the seed recognizes every district of a nation's home body for it, so `bodyOwner` and today's behaviour are unchanged.
- Founding spacing: a new settlement must stand in a district its nation holds or that is free; the cell-distance rules stay as physical spacing.

**Occupation and war** (`scene/occupation.ts`, `scene/warScore.ts`)
- A district is controlled by whoever holds its key nodes (`nodeHolders`), so occupation becomes per district.
- War score counts occupied districts weighted by people and land, instead of whole bodies only. Against a one-world neighbour, partial
  conquest then scores.

**Economy: one World per (body, owner)** (section 4.1 of the territorial design, both modes)
- Complex `World.id = "<body>@<owner>"`; a World's capacity, land and people are the sites in its owner's districts. `worldByName` stays as
  "principal world" so its 79 callers move one at a time. Simple mode gets the matching per-owner `WorldState`.
- A body with one owner keeps one World, so the seed, `complexStability`, `economyEngine` and the empires' hash are untouched.

**Zoning, freight, migration, AI**
- Zones may be drawn only inside districts the drawer holds (`scene/zoning.ts`).
- A route through another nation's district needs an access right (`decideAccess` already exists).
- Two Worlds on one body exchange people through the existing migration rules.
- The Expander targets free districts; the Developer reasons per district.

**UI**
- Ground map mode "Divisions": fill by macro-region, province or district, borders per tier, holder colours (relation colours, as for ships).
- Planet panel: the Control tab lists the body's districts with holder, people and sites; hover on the ground map names the district,
  province and macro-region.
- Earth flavour (one world government): provinces read as the government's administrative units; governors and province policies are a
  later idea, not in this plan.

## 6. Milestones

Each step is pure logic plus store I/O in the repo's usual split, has its own `tests/*.test.ts`, and passes the standard sweep.

| Step | What | Done when |
|---|---|---|
| **D1** | `scene/divisions.ts` + `data/divisionData.ts`; dev-only ground map mode | `tests/divisions.test.ts`: deterministic, every dry node covered once, exact nesting, counts within 10% of target, ids stable across runs, one-district bodies trivial |
| **D1b** | Earth population bake script + `data/earthPopulation.ts` (optional) | Earth's tiers follow today's people with drowned cities moved inland |
| **D2** | Claims on districts; retire `region` scope and the radius; save version bump + migration | `tests/jurisdiction.test.ts` updated, old-save migration tested |
| **D3** | Colonies on divided bodies, `canColonize` per district, Control tab list; audit the 91 `bodyOwner` readers (body-wide vs per-district) | two nations hold districts of one body at claim level; single-owner games unchanged |
| **D4** | Occupation and war score per district | partial conquest scores; existing war tests unchanged for whole bodies |
| **D5** | World per (body, owner), both modes | `complexStability`, `economyEngine`, `economyEmpires` hashes unchanged; a shared body runs two Worlds |
| **D6** | Zoning, freight access, migration between co-located Worlds, AI | each in its own test file |

D1 to D3 give the visible result (a map you can point at and say "that is theirs", shared bodies at the claim level). D5 is the largest
step and can wait.

## 7. Intentional simplifications

- Districts are fixed per body: no player redrawing in this plan (split/merge of provinces is a later option, sketched in conversation).
- Borders are mesh-node boundaries (~110 km on Earth); the map smooths them for display, the rules use nodes.
- No climate in the weights; the setting's climate shift enters only through the Earth anchors.
- Orbit keeps its own scope (`<body>~low|high`); divisions are surface only.

## 8. Risks

- **Id stability.** Changing the mesh, relief, land mask or population inputs moves district ids. `DIVISIONS_VERSION` + migration, and a
  test that pins Earth's counts (as `locations.test.ts` pins site counts).
- **`bodyOwner` readers.** 91 files read it; most can keep reading body-wide sovereignty, but production, trade and occupation readers must
  be checked in D3.
- **Complex calibration.** D5 must leave single-owner worlds bit-identical; the empires stay as they are (they have no sites).

## 9. Decisions for the owners

1. Tier names: "district" already names building districts in both economies. Alternatives: county / prefecture / canton for the base unit.
2. Counts: Earth 500 / 80 / 10, or other targets; and whether Mars and Venus get a macro tier.
3. Earth population: use the Natural Earth bake (D1b), or only the game's own settlement sites.
4. Whether a nation may hold a single district inside another nation's province (CK3-style enclaves) or whether provinces must be whole.
5. Whether players may later split and merge provinces they hold.
