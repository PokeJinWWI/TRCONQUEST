# Project Context

## Objective
TRCONQUEST ("Terra Relicta: Conquest") — a browser-based sci-fi 4X/grand-strategy game (TypeScript + React + Three.js/react-three-fiber, Vite, Zustand stores). Current focus: building a **Victoria 3-flavored economy simulation** (pops, supply/demand, national government, politics) adapted to a space setting, at a bounded scale so it stays fast in the browser.

## Current State
- **Setting/rendering** already existed: 8 real nearby star systems with hand-authored planets/dwarf planets/asteroid belts, multi-star rendering (Alpha Centauri triple, Sirius/Luyten binaries), ownership/countries, a nation-select main menu, a left NavBar (Government/Economy/Military/etc. categories with sub-tabs, resizable draggable windows), a bottom ActionBar (Buildings/Politics/Diplomacy docked panels that also switch map modes), map modes (GDP/Political), and an Outliner with reserved sections.
- **Economy — Milestone 1 of the merged "v2" design just COMPLETED and verified live** (clean restructure). Three layers:
  - **Country** (national government): one treasury, taxRate, welfarePerCapita, debt, credit rating — spans all its worlds.
  - **World** (local economy): pops, buildings, local market, labor — NO treasury.
  - Trade/logistics between worlds NOT built yet (each world's market is local/isolated for now).
- 4 countries: Imperial State of Mars, Republic of Venus, Orion Republic, **Kingdom of Lalande** (alien). 6 inhabited worlds: Mars+Luna (ISM), Venus (RoV), Arcadia+Proxima b (Orion), Lalande 21185 d (Lalande). **Earth is an uninhabited relict** (no economy).
- **4-axis pops**: species + culture + religion + class. Species: baseline Humans + **Tidalians** (alien needs template). Populations stored in **millions**, displayed as B/M (e.g. "4.00B").
- Working live: national fiscal (revenue/expenditure/debt/credit rating), CPI/inflation, finance graphs (inline SVG), Budget tax/welfare controls, **construction** (queue buildings, funded from national treasury, ramps to completion), **politics readout** (interest groups from pops), per-planet tabbed inspector (Overview/Buildings/Economy/Politics), context-aware panels (follow the focused world).
- **All tests pass** (`tests/economy.test.ts` + combat/scenarios/escape via `npx tsx`), `tsc -b --noEmit` clean, lint clean.
- **Design doc**: `docs/economy-design-v2.md` (the merged plan — read it; sections 10 = milestone build order, 11 = setting content decided).

## Decisions
- Keep pops + supply/demand (micro), with a NATIONAL government layer on top (macro) — hybrid, Vic3-style, not pure macro/TNO. Optimize later.
- Trade model chosen: **connected markets with real physical transport** (freighters/logistics/range) — designed, not yet built.
- Sim scope: simulate all countries + all inhabited worlds at full detail (LOD designed but unneeded at this scale).
- Execution: clean restructure (done for M1).
- Religion mixes per world set by judgment (Mars: Imperial Church majority; Venus: Storm Cult plurality/Axiomatic/Silicon Dream; Arcadia: Arcadian Idyll/Old-Earth Theravada; Lalande: Tidal Communion).
- **Language**: stay TypeScript for now (performance is not the bottleneck at this scale). Real insurance = keep the sim as pure, isolated, headless-tested functions (already the case) so a Rust→WASM port later is a contained swap. Consider Rust→WASM only on a profiled wall or a native "real game" pivot. LOD is the biggest language-agnostic perf lever.

## Constraints
- Runs in the browser; game clock is rAF-driven and throttles when the browser pane is hidden (affects live testing — front the pane to advance time).
- Session state (playerStore, economyStore) is NOT persisted — reloading returns to the nation-select menu. Vite HMR sometimes triggers a reload mid-edit, resetting the session.
- `read_console_messages` in the browser tool retains a STALE buffer (old timestamps/exports like seedEconomy/estimateGdp/planetEconomy) after edits — visual/functional evidence is the reliable signal, not that buffer.
- Economy tick cadence: 1 tick per 7 sim-days (weekly). Population unit = 1 million people; recipes scaled ×100 to match.

## Important Details
- Economy code: `src/economy/` (economyTypes, economyTick [tickWorld + tickEconomy], economySeed [seedWorlds/seedCountries], goods, recipes, species, demographics [cultures/religions], politics, format). Store: `src/state/economyStore.ts`. Hooks: `useEconomyTick`, `usePlayerEconomy` (→ {country, world}), `useContextEconomy` (→ focused {world, country}). UI: `BuildingsPanel`, `EconomyPanel` (+ `NationEconomyPanel`), `PoliticsPanel`, `LineGraph`, `InspectPanel`, `ActionBar`, `NavBar`.
- Ownership lives on `planetData.ts` (ownerId) AND on the economy World; countries in `src/data/countryData.ts`.
- Sim is pure functions (no React/DOM/Three deps) — the portability discipline to preserve.
- **Nothing is committed to git yet** — all economy work (and earlier multi-star/map-mode/UI work) is uncommitted on `main`. User has not yet asked to commit; offer before large context loss.

## Open Questions
- Whether to commit the current work (offered, not yet answered).
- Alpha Centauri / Sirius planets Orion owns beyond Arcadia/Proxima b: treated as claimed-but-uninhabited for now.

## Next Steps (per design doc §10 build order)
1. **Milestone 2: Production Methods + throughput + employment/qualifications** — buildings ramp (fixes profit "teleporting"), expose PM choices (manual vs mechanized), show/require qualified employment. THIS IS THE NEXT MILESTONE.
2. Standard of Living loop (wealth→SoL→consumption tiers→demand/growth — the growth engine).
3. Energy (electricity as universal input) + expanded goods/chains.
4. Trade & logistics (freighters/range/transport cost + market-access price blending).
5. National government depth (multiple tax forms, laws as modifiers, more central-bank policy).
6. Politics depth (interest groups by all axes + discrimination; then parties, legislature, Political map mode).

## User Preferences
- Wants realism first (Vic3-level), optimize after. Dislikes abstract/confusing numbers (fixed the "2.3 pops" issue).
- Eager for breadth/progress ("get to it", "more everything"); references Vic3 & TNO economy guides.
- Wants to interact with buildings/employment, not just read them (→ construction done, PMs next).
- Appreciates honest feasibility assessments over hype.
- Git commit conventions: branch off main if needed; end commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; only commit/push when asked.
