# Economy Design v2 — Merged Plan (TRCONQUEST)

**Status:** design doc for review, pre-implementation. Merges three sources —
your original `economy-design.md` (the depth bible), The New Order's macro
national-budget framing, and Victoria 3's core micro loop (throughput,
standard of living, qualifications, market access) — adapted to a sci-fi
*space* setting.

**Guiding principle:** be *realistic first* (Vic3-style micro, real economic
mechanisms), optimize later. Correctness and legibility over cleverness. The
scale is small enough that performance is a non-issue, so we don't pre-optimize.

---

## 0. Decisions locked in (from review)

- **Pops modeled on four axes:** class + culture + religion + **species**. This
  is the richest option; it unlocks discrimination, assimilation, religious and
  cultural politics, and species-differentiated needs.
- **Simulation scope:** every country and every *inhabited* world is fully
  simulated. Right now that's **3 countries** and **4 inhabited worlds**:
  - **Mars** — Imperial State of Mars (capital)
  - **Luna** — Imperial State of Mars (colony)
  - **Venus** — Republic of Venus (capital)
  - **Arcadia** — Orion Republic (capital)
  Everywhere else (including **Earth**, which is a *relict* — abandoned, per the
  game's name) is uninhabited: owned territory, maybe, but no pops/economy yet.
  So there is no LOD problem today — we simulate all of it at full detail. LOD
  is designed for but not needed until more worlds are settled.
- **Trade:** connected markets with **real physical transport** — goods move
  between worlds via freighters, constrained by logistics capacity and range,
  tying the economy into the ships/hyperlanes already in the game.
- **Execution:** **clean restructure.** Rebuild on a proper three-layer
  architecture, reusing the parts that already work (market-clearing math, the
  finance/inflation/credit machinery, the pure-function + test harness style).

---

## 1. The three layers

The single biggest fix from v1: separate what belongs to the **planet** from
what belongs to the **country**. Three layers, each a clean boundary:

1. **Local economy (per inhabited world).** Pops, jobs, buildings, a local
   goods market with its own prices, wages, employment, and standard of living.
   This is the micro layer — the Vic3 heart.
2. **National government (per country).** ONE treasury, budget, debt, tax
   policy, central bank, and laws for the whole country. Planets do **not** have
   their own treasuries (the v1 mistake). The state taxes economic activity
   across all its worlds and spends one national budget. This is the macro layer
   — the TNO heart.
3. **Galaxy trade & logistics (cross-world).** Freighter capacity moving goods
   between a country's worlds (and, later, between countries), with transport
   cost and range shaping which worlds can rely on imports. This is the
   space-adapted layer that replaces Vic3's abstract "market access."

```
Country (Imperial State of Mars)
├── National government: treasury, debt, taxes, central bank, laws
├── World: Mars   → local market, pops, buildings, SoL
└── World: Luna   → local market, pops, buildings, SoL
        ▲                         ▲
        └──── freighters move goods (logistics + range) ────┘
```

---

## 2. Pops — the base unit (four axes + Standard of Living)

A **pop** is a cohort sharing **species + culture + religion + class**, living on
one world, holding one job (or unemployed). It's an aggregate agent with a real
population number (people, shown as `2.3B`, never a bare `2.3`).

**Attributes:** population size, species, culture, religion, class, job,
**wealth**, **qualification/literacy**, life stage, and per-tier **needs
satisfaction**.

### 2a. Standard of Living (SoL) — the growth engine

The mechanism v1 was missing, and the reason the economy felt static. SoL is
derived from a pop's wealth relative to the cost of its needs basket:

- Higher SoL → the pop **consumes more, and reaches into higher/luxury need
  tiers** → demand rises → prices firm up → building profits rise → wages rise →
  SoL rises again. A self-reinforcing spiral (Vic3's core loop).
- SoL also drives **population growth/decline** (well-off pops grow, immiserated
  ones shrink/emigrate) and **qualification** (wealthier pops get educated,
  qualifying for higher-tier jobs).
- SoL is the **legible headline number** you manage pops through — you rarely
  touch individual cohorts, you watch and steer SoL. (This is the bridge to the
  "pops as an indirect number" instinct: the cohorts drive it, you read SoL.)

### 2b. Species (needs templates)

Each species maps the same tier structure (Basic / Everyday / Healthcare /
Comfort / Luxury) to **different goods**, or adds/removes tiers — data, not code,
so a new species is content. Baseline humans need food/medicine; a synthetic or
heavily-augmented strain might need power/maintenance instead; etc. (Exact
species roster is yours to define — the axis and the template system are what
this doc commits to.)

### 2c. Culture, religion, discrimination

Culture and religion are separate axes from species and from each other. They
drive consumption preferences, political leaning, and — critically —
**discrimination**: a pop of a non-dominant culture/religion/species can face
reduced job access, lower wages, or capped qualification, feeding unrest and
politics. Assimilation slowly shifts culture over time under the right
conditions.

### 2d. Classes

Subsistence, Labor, Technical, Professional, Investor, Political — same ladder as
your original doc, each reaching a different needs tier and carrying different
political weight and wealth.

---

## 3. Buildings — production methods, throughput, employment

The fix for "profit teleports overnight": buildings ramp and have depth you can
touch.

- **Production Methods (PMs).** Each building type has selectable methods that
  change its inputs, outputs, and worker mix — e.g. a farm's *manual* PM (many
  Subsistence workers, no inputs) vs *mechanized* PM (fewer workers, consumes
  machinery + energy, higher output). Switching PM is a real player decision
  with tradeoffs (labor vs inputs vs energy). This is the "interact with
  buildings" you wanted.
- **Throughput.** A building doesn't snap to full output. Throughput is a
  modifier that ramps production and profitability over time and with bonuses
  (companies, infrastructure, tech). Profit rises smoothly, not overnight.
- **Employment & qualifications.** A building posts jobs by class; it only fills
  them with **qualified, available** pops. Under-qualified or too-small a labor
  pool → understaffed → throttled output. You can see exactly how many pops a
  building employs and whether it can find them.
- **Ownership** (state ↔ private spectrum) and **profit → wages + dividends +
  tax** as before, but tax flows to the **national** treasury, not the planet.

---

## 4. Goods & production chains (with energy and transport)

Expanded from v1's four goods toward real chains. A realistic starter set,
grown over time:

- **Raw:** minerals/ores, hydrocarbons, fusion fuel, water, biomass
- **Energy:** **electricity** — consumed as an input by most industry,
  extraction, and higher pop tiers. Energy shortage → broad supply-side price
  shock (your original doc's power system, Section 14). This is a first-class
  good this time.
- **Intermediate:** steel/alloys, machinery, electronics, chemicals
- **Consumer:** food, clothing, household goods, electronics, luxuries
- **Services:** healthcare, education, transport, administration
- **Logistics/transport** is itself a good/capacity that freighters supply and
  that inter-world trade consumes (Section 6).

Buildings form chains: mine → minerals → smelter → steel → factory → machinery,
power plant → electricity feeding all of them, farm → food, etc. Pops (and
buildings) need **electricity and transport**, per your note.

---

## 5. Markets, prices, wages (per world + market access)

- Each world has a **local market**: prices clear each tick from effective
  (budget-and-price-constrained) demand vs supply — the v1 mechanism, kept, it
  works and is tested.
- **Market access blending (MAPI, from the Vic3 guide):** a world's price for a
  good is a blend of its *local* supply/demand and the *connected* (national /
  trade-reachable) market, weighted by how much transport capacity actually
  links it. A well-connected world tracks national prices; an isolated one runs
  on local synergies. This is what makes trade and logistics *matter* to prices.
- **Wages** clear a per-class labor market per world; income tax feeds the
  national treasury.

---

## 6. Trade & logistics (the space layer)

Goods move between worlds physically, not by teleporting into one national pool:

- Each country has **logistics capacity** (from freighter fleets / trade-hub
  stations — ties into the ships and stations already in the game).
- Moving a good from world A to world B consumes logistics capacity scaled by
  **distance/range** (hyperlane network) and adds a **transport cost** to the
  landed price.
- A world short on food can **import** it if there's a surplus elsewhere and the
  logistics/range to carry it — otherwise it starves (SoL crashes). This makes
  Luna's "mining colony that imports food" a real, fragile supply line, not a
  given.
- Later: inter-*country* trade, tariffs, blockades, piracy on trade routes (your
  original Section 5e).

---

## 7. National government (the macro layer)

One government per country, managing all its worlds:

- **Budget:** revenue (income tax, corporate/profit tax, tariffs, state-
  enterprise profits, resource royalties — the "different forms of taxation" you
  asked for) vs expenditure (welfare, administration, infrastructure/energy
  subsidy, military, debt service). Surplus/deficit → treasury/debt.
- **Debt & credit:** national debt, debt-to-GDP (annualized correctly),
  sovereign **credit rating** — reused from v1's finance layer, lifted to the
  country level.
- **Central bank:** policy interest rate (growth vs inflation/borrowing cost),
  reserve requirements, plus room for more policies later (open-market ops,
  currency issuance, independence level) — your original Section 9.
- **Money supply & inflation:** deficit spending injects money → inflation;
  surplus drains it → deflation. CPI + inflation, reused from v1.
- **Laws:** economic system, tax law, labor law, trade policy, welfare
  generosity — each a modifier on growth/efficiency/stability, gated (later)
  through the legislature. Different taxation forms live here, as you noted.

---

## 8. Politics (interest groups from real pop attributes)

Interest-group strength is computed from pops by **class + job + culture +
religion + species + discrimination faced** (not class alone, as you flagged):

- Baseline groups (Trade Unions, Intelligentsia, Industrialists, Bureaucracy,
  plus faith-linked and cultural blocs) draw membership and weight from
  sympathetic pops, weighted by class political weight and wealth.
- Discriminated pops radicalize differently; religious/cultural blocs are
  distinct political forces.
- Later milestones: parties (coalitions of interest groups), a legislature that
  gates laws/budget, in-government vs opposition, movements, and the Political
  map mode — all built on this strength math (your original Section 2).

The deeper systems from your original doc — **characters & dynasties (Section
3), corporations & boards (Sections 3e/6), full banking & credit creation
(Section 8), business cycles (Section 11), stockpiles (Section 12), the full
power/energy tech arc (Section 14), stations & asteroid charters (Section 5)** —
remain the long-term roadmap and are pulled in after the core loop above is
solid. This doc doesn't re-derive them; it builds the foundation they sit on.

---

## 9. Performance / LOD

At today's scale (3 countries, 4 worlds, a few dozen pop cohorts and goods each,
weekly ticks) the whole simulation is well under a millisecond per tick — the
render loop, not the economy, is the only frame cost. The LOD system (full
detail for player-relevant worlds, aggregate distant ones) is *designed for* so
growth is cheap, but is not built until more worlds are inhabited. If the sim
ever gets heavy, it can move to a Web Worker off the render thread.

---

## 10. Milestone build order (clean restructure)

Each milestone is a working, tested slice. Rough sequence:

1. **Foundation restructure.** Country / World / Pop(4-axis) / Building / Market
   data model; national treasury replaces per-planet treasury; realistic
   population numbers; seed the 3 countries and 4 worlds. Port the market-clearing
   and finance math onto the new shape. (Removes Earth's economy — it's a relict.)
2. **Production methods + throughput + employment/qualifications.** Buildings
   ramp, hire qualified pops, and expose the PM choice. Kills the profit-teleport
   and makes buildings interactive.
3. **Standard of Living loop.** Wealth → SoL → consumption tiers → demand →
   growth/qualification. The engine that makes the economy dynamic.
4. **Energy + expanded goods & chains.** Electricity as a universal input;
   longer production chains.
5. **Trade & logistics.** Freighter capacity, range, transport cost, market-
   access blending. Import/export between a country's worlds.
6. **National government depth.** Full budget with multiple tax forms, laws as
   modifiers, central-bank policies.
7. **Politics.** Interest groups from all pop axes + discrimination; then
   parties, legislature, the Political map mode.
8. **Beyond:** corporations, characters/dynasties, banking/credit creation,
   business cycles, stations/asteroid charters, the power tech arc — per the
   original design bible.

Construction (from v1) folds into Milestone 2/5 as "invest to add building
levels / switch PMs," funded from the national budget.

---

## 11. Setting content (decided)

- **Countries (4):** Imperial State of Mars, Republic of Venus, Orion Republic,
  and **Kingdom of Lalande** — a new alien empire.
- **Inhabited worlds (6):**
  - Mars — Imperial State of Mars (human, Martian culture)
  - Luna — Imperial State of Mars (human, Martian culture)
  - Venus — Republic of Venus (human, Venusian culture)
  - Arcadia — Orion Republic (human, Arcadian culture)
  - Proxima b — Orion Republic (human, Arcadian culture; **low** habitability)
  - Lalande 21185 d — Kingdom of Lalande (**Tidalian** species/culture)
- **Earth:** habitable but uncontrolled and uninhabited — a *relict*. No economy.
- **Species:** baseline Humans, and the **Tidalians** (alien, on Lalande 21185 d)
  with their own needs template.
- **Religions (plurality shares, chosen by judgment):**
  - Mars: Imperial Church of Mars (majority), then non-affiliated, Martian Buddhist
  - Venus: Venusian Storm Cult (plurality), Axiomatic, Silicon Dream, non-affiliated
  - Arcadia / Proxima b: Arcadian Idyll (majority), Old-Earth Theravada, non-affiliated
  - Luna: as Mars, a bit more secular
  - Lalande: a Tidalian faith (Tidal Communion), then non-affiliated
- **Population** stored as millions of people, displayed with M/B suffixes (no more
  bare "2.3"). Counts chosen by judgment (Mars ~4B, Venus ~2.5B, Lalande ~2.5B,
  Arcadia ~1.2B, Luna ~0.4B, Proxima b ~0.15B).

## 12. Open questions (resolved above; remaining minor)

1. **Species roster:** what species actually exist in the setting (baseline
   humans + what)? I can start with one human template and stub the axis.
2. **Cultures & religions:** rough list per world/country, or should I seed
   placeholder ones (e.g. Martian / Venusian / Arcadian cultures) for now?
3. **Earth:** confirm it's fully uninhabited (relict) and should have *no*
   economy — I'll remove the one I seeded in v1.
4. **Do the Alpha Centauri / Sirius planets** the Orion Republic owns count as
   inhabited later, or are they claimed-but-empty for now? (I'll treat Arcadia as
   Orion's only inhabited world unless you say otherwise.)
