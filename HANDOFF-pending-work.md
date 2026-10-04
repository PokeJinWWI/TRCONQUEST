# Handoff — pending work (Terra Relicta: Conquest)

Context for a fresh Claude chat. Read `CLAUDE.md` first (project rules). This repo is a Vite + React + TS + three.js grand-strategy game. **Never commit unless asked.** After ANY change run the verification sweep: `npx tsc -b`, the relevant `tests/*.test.ts` (`npx tsx tests/<name>.test.ts`), and `npm run build` — all must be clean.

The current state is GREEN except two intentionally-parked test files (`armyScenarios`, `terrainWar` — see task 4). Nothing is committed.

**Done since this doc was written:** TASK 1 (water good) ✅ and the GDP-per-capita / International Earth Dollar display work ✅ — see "COMPLETED" sections below.

---

## CRITICAL LESSON (read before touching the Complex economy)

`src/economy/*` (Complex mode) is balance-sensitive and guarded by `tests/complexStability.test.ts` (5 yrs, AI on) + `tests/economyEmpires.test.ts`. Adding **seeded** demand/buildings or raising net input demand destabilizes small nations (Orion = Arcadia + Proxima b; Mars is marginal) — they spiral in years 3–4 (broad electricity/fuel shortage cascade, NOT any single new chain).

Rules that worked:
- Make new buildings **buildable-but-NOT-auto-seeded** (don't add them in `economySeed.ts withTransport`/`withSupplyChains` paths).
- When a product gains a new input, make it **substitutive** (reduce an existing input to offset) so net material/electricity demand stays ~flat — don't add inputs purely additively.
- Universal inputs (electricity-like) must be **degradeable** (`CAPITAL_INPUTS` in `economyTick.ts`, 0.6 floor) so a shortfall throttles softly instead of hard-cascading.
- After any seed/tick/recipe change: rerun `npx tsx scripts/economy/calibrate.ts` then `--empires` (regenerates `seedCalibration.ts` / `empireCalibration.ts`), then re-hash `tests/economyEmpires.test.ts` section 1 (worlds/countries/corporations/banks/characters/families) and re-run complexStability + economyEmpires + economy.

---

## TASK 1 — Water good ✅ COMPLETED

Added `water` good to Complex mode (`category: 'raw'`, basePrice 2) in `goods.ts`. Built in two stages (pops first, then industry), calibrated after each, following the CRITICAL LESSON.
- **Producers** (`recipes.ts`, all extraction, buildable; only the treatment plant auto-seeds via `withSupplyChains` — it's defined first so `producerOf` prefers it, the rest are player/AI-built): `waterTreatmentPlant` (surface), `groundwaterPump`, `desalinationPlant` (sea), `iceMine` (frozen volatiles — user asked). Added to `RECIPE_GROUP` + `CONSTRUCTION_TIER`.
- **Consumers**: pop **drinking-water** basic need in BOTH species (`species.ts`, base 0.08/0.09); industry inputs — irrigation (wheat/rice/hydroponics), process water (chemicalPlant), cooling (coal/fusion), electricity trimmed to offset. `water` added to `CAPITAL_INPUTS` (degradeable, 0.6 floor) and `NEVER_MOTHBALLED` in `economySeed.ts`.
- **Balance note**: first pass left a chronic glut on Venus (a min-size plant overshot demand ~3×, inventory piled to 17k). Fix was **right-sizing** all four water-producer outputs (~2400→1000 etc., proportional inputs/jobs). Now pops ~407 + industry ~330 ≈ demand, supply tracks it, inventory bounded ~2k, price at floor. Stable, cheap, abundant — fits ocean worlds.
- Recalibrated nations + empires, re-hashed `economyEmpires` section 1 (worlds `bf2f4c1d2f0c2117`, countries `4c74ab14d2187147`). All green; empires 13/20 stable (up from 12).
- If you ADD more water demand later (e.g. more industrial inputs), rerun the calibrate → re-hash → stability loop, and re-check Venus/Mars for glut or shortage.

## TASK 1b — GDP-per-capita + International Earth Dollar (IED) ✅ COMPLETED (user asked mid-session)

- **GDP/cap was ~$900** because `USD_PER_UNIT` (display projection, `economy/format.ts`) was tuned for aggregates but divided across a billions-scale population. Economy itself was healthy (71% employed, needs met). Fix = a Complex-specific **`IED_PER_UNIT = 75_000_000`** → Venus reads **IED 76K/cap**, IED 190T aggregate.
- **Currency rename**: Earth's currency → **International Earth Dollar (IED)** (`economySeed.ts`, code `IED`). Glossary + fx/CB/Forex labels updated from "E$/Earth Dollar".
- **Metrics in IED, converted by exchange rate**: new `formatIED(nLocal, rate)` / `formatIEDPrice(nLocal, rate)` in `format.ts`. Each Complex panel passes its nation's `currency.rate` so metrics are comparable and a weak currency reads poorer in IED. Forex/trade keep local currency. Threaded through ~13 components (EconomyOverview, EconomyPanel, FiscalIndicators, complexCharts [added `rate` to `ChartProps`], DebtPanel, BanksPanel, CentralBankPanel, CorporationsPanel, StockExchangePanel, ConstructionPanel, BuildingsPanel, ComplexPlanetTabs; relabel-only for ForexPanel/CharactersPanel/ForeignHoldings reference values).
- **Scoped to Complex mode ONLY** — Simple mode's internal GDP scale is ~270× smaller, so it keeps `formatMoney`/`$` untouched. `FiscalIndicators` is shared → branches on `abstractMode`. Simple-mode IED is a possible follow-up (needs its own ~24000× factor).
- **TimeChart** `PAD_L` 46→66 so "IED 197.58T" y-axis labels don't clip. Verified live in-browser (Venus, Complex).
- The monetary test in `economy.test.ts` ("loose > tight inflation") was flaky (single-tick snapshot flips with horizon); `runInflation` now returns **mean inflation over the run**, reliably directional. NOT a weakening — the old check only passed by luck of tick-24.

**Iron & sulfur**: user decided to leave both as distinct goods (evaluation in chat: iron is the bulk feedstock of steel, wrong scale to co-produce; sulfur is a legit but low-value merge candidate).

## TASK 2 — Shipyard ↔ economy bridge (the "actually critical" fix)

In Complex mode the military shipyard panel (`state/shipyardStore.ts`, `components/ShipyardPanel.tsx`) charges abstract strategic `resourceStore` goods (Alloys / Energy / Exotic Matter / Hyperium / Special) that the deep economy never produces — "these don't exist in Complex mode." The economy enabler is now in place (a real `alloys` good + metals chain, `rocketFuel`). 

Make Complex-mode ship/military construction **draw from the Complex economy** (alloys, steel, electricity, rocketFuel, etc. from the nation's `economyStore` stockpile) instead of the strategic `resourceStore` pool. Map: Energy→electricity, Alloys→alloys. Decide what Exotic Matter / Hyperium map to (they have techs: `exotic-matter-*`, `hyperium-synthesis`) or add economy goods for them. This touches `shipyardStore` ↔ `economyStore`; Simple mode (`resourceStore` IS the stockpile) must be unaffected. Confirm the exact UX/mapping with the user before building.

## TASK 3 — Finish the economy-goods polish

Done already (green): copper/aluminium/nickel/titanium/lithium/alloys/rocketFuel goods; baseMetalsMine, lightMetalsMine, alloySmelter, rocketFuelRefinery, metallicHydrogenPlant (late tech `metallic-hydrogen`), fishingWharf, urbanCenter; ships/vehicles consume alloys+steel; beverages (coffee/tea/sugar) + yacht (oceanGoingShips luxury) pop needs. Optional follow-ups: richer secondary consumers (copper→electronics/electrical wiring, lithium→batteries/electronics) — keep net demand flat and recalibrate.

## TASK 4 — Army-scenario balance (parked by user, low priority)

`tests/armyScenarios.test.ts` (5 fails) + `tests/terrainWar.test.ts` section 5 (4 fails) are scripted field-battle demos whose balance shifted when Earth's terrain was reshaped (level-6 mesh + mountains/plateau). The medium scenarios can be re-tuned via force counts in `src/data/armyScenarios.ts`. The **hard "Fall Back to the Woods" is a genuine terrain-battle mechanic regression**: at the level-6 mesh the sophisticated "fall back + counter-attack" plan performs WORSE than naively bringing the reserve up — no force tuning fixes it; it needs a look at `scene/terrainBattle.ts` / `scene/terrainWar.ts` (high-ground / retreat mechanics). User said only fix when they ask.

## TASK 5 — P1–P12 grievance backlog (large, untouched)

From the user's earlier list, still pending: Vic3-style notifications/situations; market tab buyer/seller detail; Vic3 markets/trade-centers; partial planet ownership; airforce/navy mechanics; pops-as-army + conscription + ship crews + military HQs; mothballed fleets; Staffed→Unemployment relabel; GDP-per-capita too low; FX specific currencies; commercial banks in corporate tab; shipyards using alloys/energy in Complex (overlaps Task 2); real-growth vs GDP-line mismatch; "why is X so" breakdowns; low private investment; monthly (not daily) economic metrics + quarter/yearly growth + all-time graphs; typed number inputs (parse "2m"); privatization buyer models; multinationals vs normal companies; auto production-method switching; consumer-demand balancing; Proxima c hycean-with-land bug; water-world colonies; "goes to TAC mode when war declared" bug; M key toggles interstellar map + Escape closes topmost menu first; Vic3 SoL rework + birth/death/migration/food-security; camera focus-on-click + zoom-to-detail-view.
Already done earlier: corporate HQ not player-buildable; City Hall→Municipal Government Building; government type shown (not "AI empire").

---

## Map/terrain state (reference — considered DONE)

Earth: 4 megacities (Chengyu Megalopolis capital, Great Lakes Megalopolis, São Paulo, Nairobi) with elevation-gated coast-hugging sprawl (`scene/planetTerrain.floodUrban`); 6 curated dry-land spaceports (Jiuquan/Taiyuan/Baikonur/Malindi/Edwards/Biak, economy auto-placement suppressed for curated worlds in `scene/spaceportSites.ts`); Strasbourg fixed outpost. Mountains are DEM-shaped within named RANGE boxes (high AND rugged) + a new `plateau` terrain for smooth highlands (`scene/earthTerrain.ts` RANGES/PLATEAUS, `scene/bodyTopography.ts realTerrain`). Mars desert→plains. Mesh is level 6 (`scene/surfaceMesh.ts LEVEL_OF.fine=6`) with `fineSpacingRad` pinned to the level-4 `REFERENCE_CELL_RAD` so gameplay distances are unchanged. Verify Earth's look by rendering an equirect PNG headlessly (surfaceOf + terrainAt + a zlib PNG encoder) — the in-game globe is 3D and hard to read.
