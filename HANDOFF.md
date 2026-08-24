# Project Context

> **Read `Context.md` first.** It is the authoritative, continuously-maintained
> project document (~330 lines, every design decision with its reasoning).
> This file is a compact index into it, not a replacement.
>
> ⚠️ **Never write a handoff to `CONTEXT.md`.** The filesystem is
> case-insensitive (macOS), so `CONTEXT.md` **is** `Context.md` — writing a
> handoff there silently destroys the real project doc. Handoffs go here, in
> `HANDOFF.md`. (The `/newchat` command's template names `CONTEXT.md`; ignore
> that and use this file.)

## Objective

"Terra Relicta: Conquest" — a web-based grand strategy game (Vite + React +
TypeScript + three.js/react-three-fiber), DEFCON-style minimalist vector-map
aesthetic, Stellaris-inspired mechanics. Recent sessions have been almost
entirely about building a **ship combat system** from nothing, across five
phases.

## Current State

**All five combat phases are complete and verified.** Typecheck clean
(`npx tsc -b`), build clean (`npm run build`), 90-check pure-function suite
passing (`npx tsx tests/combat.test.ts`), and verified live in the browser.

What exists now:

- **Phase 1 (mechanics)**: tactical time mode; damage matrix
  (energy/kinetic/missile/torpedo vs shields/armor/point-defense); three
  component healthbars (weapons/utility/core) + a blended overall; five
  warship presets; auto-forming fleet-vs-fleet engagements on hostile
  co-location; FTL charge-to-escape.
- **Phase 2 (combat view)**: `combat` as a real view level; 3D lattice with
  live density control; click-to-move; latching manual control vs.
  auto-approach; right-click targeting; focus-fire.
- **Phase 3 (terrain + fleet UI)**: celestial bodies as real terrain that
  block line of fire and force A* routing around them; the arena as a movable
  *window*; Fleet Management subtabs.
- **Phase 4 (position model + risk)**: positions rewritten as real,
  density-independent coordinates; unobstructed moves land on the exact
  clicked point; grid movement moved to right-click; "Engaged Against"
  (actively trading fire) distinguished from merely being in a fight; FTL risk
  modifiers for core damage (universal) and active engagement (combat-only).
- **Phase 5 (motion physics + stances)**: position+velocity replaces the hop
  model; provably sub-light speeds with acceleration/deceleration/turning;
  four auto-combat stances in the Strategizer; yellow dashed engagement lines;
  Fleet Management window sizing fixed; tactical time five tiers with
  pause-independent speed control.

### Git state (check before committing)

- `main` is in sync with `origin/main`.
- Last commit: `1f1c380` "Add ship orbiting/physics polish and full combat
  system (mechanics, arena view, fleet UI)" — covers combat Phases 1–3 plus
  the prior session's ship work. **Pushed? No — verify with `git status`.**
- **Phases 4 and 5 are uncommitted**, plus `Context.md` updates and the new
  `tests/combat.test.ts`. House rule: only commit when explicitly asked.

## Decisions

Full reasoning for every one of these is in `Context.md` under "Combat system
(Phase N …)". Condensed:

- **Tactical time is a second *rate* on one clock**, not a second clock —
  everything is already a pure function of `simDays`, so nothing else changed.
  The clock auto-switches to tactical when a fight starts and back when it
  ends (combat is otherwise unobservable at ~518,400 sim-seconds per real
  second).
- **Damage follows the Stellaris convention** (the brief's own reference):
  energy strong vs armor / weak vs shields, kinetic the mirror,
  missiles+torpedoes bypass shields but are interceptable. *The brief as
  written described both energy and kinetic as strong-vs-armor — flagged as a
  typo and corrected.* Layer overflow carries in **raw** (pre-multiplier)
  damage so the counter-matrix stays correct on partially-stripped layers.
- **Three components degrade; only core kills.** Weapons scales firepower,
  utility scales thrust *and* FTL charge rate (0 = stranded, can't flee), core
  at 0 destroys. The overall bar blends all five pools (including
  shields/armor) — an earlier components-only version showed 100% integrity on
  a ship that had lost all shields and half its armor.
- **Positions are real continuous coordinates; the lattice is only a
  pathfinding aid.** Two reported bugs traced to violating this: storing
  positions as density-relative lattice indices caused "ships teleport to the
  nearest intersection on density change"; storing the current leg's
  *endpoint* in `position` caused "a new order teleports the ship to the
  previous destination" and made the route line vanish on issue. Both fixed at
  the root, not patched.
- **Ships are provably sub-light.** Speeds are declared as fractions of a
  derived `ARENA_LIGHT_SPEED_UNITS_PER_SECOND` (from Sol's real radius and
  *c*), never as bare numbers — the old fastest hull ran at 96% of light on a
  reaction drive and nothing caught it because nothing expressed the
  relationship.
- **Acceleration comes from one rule**: steer the velocity *vector* under a
  single `accel * dt` budget. Starting, stopping, and turning all fall out of
  it; no special-case turn logic.
- **Engagement lines ignore the lattice** — it's a line of *fire*, and shots
  travel straight; drawing it on the grid would imply a constraint gunnery
  doesn't have. Pairs come from the same `activeEnemyContacts` that drives the
  panel readout and FTL risk, so there's no second cosmetic definition.
- **Warp gained combat-only escape risk**, scoped so ordinary warp orders are
  *provably* unaffected (gated on a `riskContext` param only the combat
  resolver passes) — regression-tested with 200 ordinary orders on a
  nearly-dead-core ship.

## Constraints

- **`npx tsc --noEmit` does NOT typecheck this project** — `tsconfig.json` is
  solution-style (`files: []`, only `references`), so it silently checks
  nothing. Use **`npx tsc -b`**.
- No eslint installed — don't attempt lint checks.
- No backend; pure client-side. "Dev-only" means dead-code-eliminated by Vite,
  not secret.
- No real economy/tech-tree systems yet — habitability, drive tiers, weapon
  balance numbers etc. are real data with documented heuristics, not gaps to
  silently paper over.
- **Arena scale is non-linear.** Body radii are fourth-root compressed, so
  there is **no single km-per-unit scale**: one unit is ~179,000 km against
  Sol but ~5,300 km against Earth. The light-speed anchor is therefore defined
  against one specific body. Fully realistic reaction-drive speed (0.01c)
  would make one arena crossing ~12 minutes, which isn't playable.
- **Browser sandbox artifacts** (all reconfirmed):
  - The 2nd+ `<Canvas>` mount in one tab deterministically loses its WebGL
    context. Open a fresh tab per view level being tested. DOM UI outside the
    Canvas still works in a context-lost tab.
  - `document.hidden` reports `"hidden"` unconditionally; `gl.readPixels`
    reads back all-zero. **Neither is a valid diagnostic here.**
  - **Real wall-clock time advances between agent tool calls.** Polling for a
    mid-fight moment fails — fights resolve between calls. Do the whole
    play→wait→pause sequence *inside a single* `javascript_tool` call.
  - r3f only recognizes a synthetic `contextmenu` dispatched as a
    **`PointerEvent`**, not the DOM-native `MouseEvent` type.
  - Vite HMR goes stale after store/type edits and silently breaks handlers
    (e.g. spawn buttons stop working). **Hard-reload before concluding
    anything is broken.**
  - Use `HTMLSelectElement.prototype` (not `window.HTMLSelectElement`) when
    setting select values via the native setter — the latter throws
    "Illegal invocation".

## Important Details

- Working directory: `/Users/pikaj/Documents/Terra Relicta/TRCONQUEST`
- **`Context.md`** (capital C, repo root) — authoritative project doc. Read
  first. Keep updated after every change, documenting *why*, not just *what*.
- **`tests/combat.test.ts`** — 90-check seeded pure-function suite, the
  primary verification path for combat. Run with `npx tsx tests/combat.test.ts`.
  Lives outside `src/` so it never enters the app typecheck or bundle.
- Dev server: `npm run dev` (Vite, port 5173, base `/TRCONQUEST/` — navigate
  to `http://localhost:5173/TRCONQUEST/` explicitly). `.claude/launch.json`
  registers it as `trc-dev`.
- Build: `npm run build`. Typecheck: `npx tsc -b`.
- Debug console: backtick key, dev build only — spawns any ship class at any
  body with any allegiance.
- Combat source map:
  - `src/data/combatData.ts` — damage matrix, weapon/defense archetypes, hull
    presets, stances, risk constants.
  - `src/scene/combatArena.ts` — `ArenaPoint` (real coords) vs `GridNode`
    (pathfinding index), light-speed anchor, body sizing, LOS, A*.
  - `src/scene/combatResolution.ts` — pure simulation: `integrateMotion`,
    `stanceDestination`, `stepEngagements`, `syncEngagements`,
    `activeEnemyContacts`.
  - `src/state/combatStore.ts` — live engagements. `src/hooks/useCombatResolver.ts`
    — drives it off the clock.
  - Views: `CombatViewScene` / `CombatGrid` / `CombatShipMarker` /
    `CombatPathLine` / `CombatEngagementLine`; panels `CombatPanel`,
    `FleetManagement`, `ShipPanel`.
- GitHub Pages deploys via `.github/workflows/deploy.yml` on push to `main`.
  Whether Settings → Pages → Source is actually set to "GitHub Actions" has
  never been reverified.

## Open Questions

- Should Phases 4–5 be committed (and pushed)? Nothing has been committed
  since `1f1c380`.
- Is GitHub Pages actually live (Settings → Pages → Source = "GitHub
  Actions")? Still unverified across several sessions.
- Combat balance is untuned by playtesting — fights are now noticeably longer
  since ships became sub-light. Whether that pacing feels right is a judgment
  call only the user can make.

## Next Steps

Nothing is pending — the last request was fully delivered. Natural candidates,
roughly by value:

- **Combat feedback**: no visual for a shot fired, intercepted, or blocked —
  damage just appears on bars. A tracer/impact layer and a "no line of fire"
  indicator would make the terrain rules legible without reading the panel.
- **Fleet-wide targeting UI**: per-ship right-click targeting exists, but
  there's no way to assign a whole fleet's focus fire at once.
- **Loadout editing** in the Ship Designer, once resources/refit exist to make
  custom designs mean anything.
- Long-unstarted: flesh out the galactic view (still a stub), star systems
  beyond Sol, real economy/tech systems.

## User Preferences

- **Wants honest, concrete verification.** Call out plainly what couldn't be
  verified live rather than assuming. This user has repeatedly valued catching
  false leads and being upfront about pure-function testing as a substitute
  when the sandbox can't render something.
- **Wants `Context.md` kept current after every change**, documenting *why*.
  Established house convention.
- **Only commit when explicitly asked.**
- Gives concrete feedback in short messages that **bundle several distinct
  asks at once** — separate and address each rather than conflating them.
- Comfortable delegating large, ambiguous design work and trusting judgment
  calls — but expects those calls **surfaced clearly afterward**.
- Asked to be told proactively if a request is better suited to Opus (complex,
  open-ended design) or overkill for it (simple enough for Sonnet) — flag the
  model rather than silently picking.
- Reports bugs precisely and from real observation ("it takes light ~4-5
  seconds to cross the sun"). Take these literally and verify the underlying
  numbers — every such report this session was correct and pointed at a real
  structural bug.
