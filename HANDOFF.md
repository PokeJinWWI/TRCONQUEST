# Project Context

> **Read `Context.md` first.** It is the authoritative, continuously-maintained
> project document (~450+ lines now, every design decision with its
> reasoning). This file is a compact index into it, not a replacement.
>
> ⚠️ **Never write a handoff to `CONTEXT.md`.** The filesystem is
> case-insensitive (macOS), so `CONTEXT.md` **is** `Context.md` — writing a
> handoff there silently destroys the real project doc. Handoffs go here, in
> `HANDOFF.md`. (The `/newchat` command's template names `CONTEXT.md`; ignore
> that and use this file.)

## Objective

"Terra Relicta: Conquest" — a web-based grand strategy game (Vite + React +
TypeScript + three.js/react-three-fiber), DEFCON-style minimalist vector-map
aesthetic, Stellaris-inspired mechanics. Many sessions now have been almost
entirely about building a **ship combat system** from nothing, across nine
phases, then iterating on it from direct user feedback (bug reports, balance
asks, UX complaints) once it was playable.

## Current State

**All nine combat phases are complete and verified.** Typecheck clean
(`npx tsc -b`), build clean (`npm run build`), **233-check** pure-function
suite passing (`npx tsx tests/combat.test.ts`, up from 90 a few sessions ago),
and extensively verified live in the browser this session — including several
cases where live testing caught real bugs pure-function tests couldn't (see
Important Details).

### Git state (check before committing)

- `main` **is in sync with `origin/main`**, at commit `3f8172b` ("combat") —
  this covers roughly Phase 1 through Phase 6.
- **Phases 7, 8, and 9 are entirely uncommitted** (plus this session's
  auto-chaff-default change and `Context.md`/`HANDOFF.md` updates). That's a
  large amount of verified, working code sitting only on disk. House rule:
  only commit when explicitly asked — but flag this prominently, it hasn't
  come up in several sessions.
- Uncommitted files: `Context.md`, `src/App.css`, `src/App.tsx`,
  `src/components/{CombatPanel,DebugConsole,DraggableWindow,FleetManagement,
  Outliner}.tsx`, `src/data/combatData.ts`, `src/hooks/useCombatResolver.ts`,
  `src/index.css`, `src/scene/{CombatShipMarker,CombatViewScene,
  NavigationLine,SatelliteViewScene,ShipPanel,combatArena,combatResolution,
  moonData,planetData,shipPhysics}.ts(x)`, `src/state/{combatStore,
  settingsStore,shipStore}.ts`, `tests/combat.test.ts`, plus new untracked
  `src/hooks/useShipDriftIntegrator.ts`.

### What exists now (condensed — full reasoning in `Context.md`)

- **Phases 1–5**: mechanics, combat view, terrain, real-coordinate position
  model, motion physics + stances. See prior handoff content below or
  `Context.md` directly.
- **Phase 6**: click-picking rewrite — the click-catcher was a solid box, and
  a box raycast can only return a point on its own *surface*, so every manual
  move order had been landing on the arena wall (729/729 nodes mis-picked in
  testing). Destinations now resolve to a drawn lattice node via screen-space
  picking. `GRID_DIVISIONS` fine 12→16 so densities nest (4|8|16). Route lines
  got real width (Line2) and restricted to player/allied ships.
- **Phase 7**: real-time stance re-tracking (a ship used to freeze its
  destination the instant ANY route existed — fixed by keying off
  `holdPosition`, not `path.length`); overshot sub-waypoints dropped instead
  of forcing backtracking; a real velocity-preservation bug fixed
  (`integrateMotion`'s maxSpeed clamp was zeroing a "drifting" ship's velocity
  on the very next step); flying into a body is now fatal; **real gravity**
  for ships with zero thrust (felt only then — "thrusters mean flat space"
  per the brief); new Flee stance + automatic fallback for any disarmed ship;
  right-click targeting from the Engagement panel roster with toggle-off;
  Fleet Manager/Outliner scoped to player-owned ships; Luna added to Earth's
  arena as real terrain; satellite view fixed to render bodies at genuinely
  different sizes (was one flat constant); Settings tab; out-of-combat
  navigation lines with arrowheads; collapsible/edge-clamped windows.
- **Phase 8**: fixed combat resolving at ~240x speed after any trip through
  strategic time (a compounding catch-up debt — 1 real second in strategic
  time bought ~36 real minutes of hyperspeed combat; now the backlog is
  DISCARDED past one tick's reach, not queued — see `combatCatchUpCursor`);
  combat panels pinned to opposite screen edges (`anchor="left"/"right"` on
  `DraggableWindow`) so they stop covering the arena; hulls can no longer
  overlap (`SHIP_SEPARATION_UNITS`); ships can disengage by simply outrunning
  a fight (`DISENGAGE_DISTANCE_UNITS` — the only exit that works with wrecked
  utility, since FTL needs utility); unpowered hulls drift under real
  system-scale gravity **out of combat too** (`useShipDriftIntegrator`) —
  two real seeding bugs found by actually running it, not just unit-testing:
  seeding at heliocentric rest sent wrecks into the Sun (64 sim-days to
  impact), and the fleeing-ship offset (1.5 units) sat outside Earth's Hill
  sphere (~0.2 units) so a stranded hull just wandered off; chaff introduced
  (2 charges, 6s, then-50% miss); browser swipe-navigation blocked
  (`overscroll-behavior`) so it can't eject the player from the game.
- **Phase 9**: tools for playing against bad odds, after correcting a
  misread of the ask (see User Preferences — an early cut added a chaff
  range-falloff as "counterplay to chaff," which was backwards: it weakened
  chaff exactly when a losing player needs it most; reverted). Chaff raised to
  a **flat 75% miss at any range**. **Fleet-wide focus fire** (`setFleetTarget`,
  "Focus Fleet" button) — one click points every commanded ship at one
  hostile. **Local-odds readout** on every roster row (`×2`, red above `×1`) —
  how many enemies can shoot *this* hull right now, from the same
  `activeEnemyContacts` engagement lines already use; this is what makes
  **splitting the fleet into forced 1v1s** (the user's first-choice answer to
  being outnumbered) actually playable — verified live that enemies genuinely
  split by proximity rather than blobbing. **Scuttle** — detonate a doomed
  hull, damage falls off linearly within 3 units, yield scales with
  *remaining* core (a healthy ship is a bigger bomb but also the one you'd
  rather keep — the tension is the point), hits only the opposing side, behind
  a two-step confirm. **Point defense now scales with the target's weapons
  component** — was a flat, undegradable hull stat, so torpedo boats had no
  play against a PD ship until the instant it died; now 55%→28%→0% as weapons
  are shot out, so Focus Fire → Weapons is a real setup.
- **This session's tail**: **auto-chaff default** — `ShipInstance.
  chaffAutoDeploy` (default `true`) makes every ship, including the player's,
  spend chaff automatically via the same AI threshold logic, with a checkbox
  in the panel to opt out and use the Deploy button manually instead. Tested
  both states directly.

## Decisions

Full reasoning for every one of these is in `Context.md` under "Combat system
(Phase N …)". Condensed, Phase 6 onward (Phases 1–5 condensed in the section
above and in `Context.md` directly):

- **A click is a ray, not a point** — the lattice is what supplies the depth
  a click cannot. `pickLatticeNode` resolves screen-space proximity first,
  depth only breaks genuine overlap ties.
- **Densities must nest** (4|8|16, each exactly double) so a fine-lattice
  placement is reachable at any display density — otherwise a coarse-density
  click could land beside the dot that was actually clicked.
- **`path.length > 0` and "is this ship under manual control" are different
  questions**, and conflating them was the Phase 7 stance-freezing bug's
  actual root cause. The real flag is `holdPosition`.
- **A route's intermediate nodes are a pathfinding aid, not checkpoints** —
  only the FINAL waypoint is ever required. Overshot sub-nodes are dropped
  (`pruneOvershotWaypoints`), not backtracked to.
- **Gravity is felt only by a ship with zero thrust budget**, applied inside
  `integrateMotion`'s own zero-thrust branch — a working ship is "flat space"
  per the design brief, full stop; there's no partial-gravity blending.
- **Real gravity needs one honest anchor, everything else is a real ratio
  against it** — same method as `arenaBodyRadius`/light-speed: literal real
  numbers are meaningless at this compression (a literal free-fall from a
  planet's surface takes ~19 minutes; fights run tens of seconds), so pick ONE
  reference fact (Earth: a dead-thrust hull starting just outside its arena
  radius falls in within several real seconds) and scale every other body's
  gravity by its REAL surface-gravity ratio to Earth's.
- **What binds a ship to a planet is the DIFFERENTIAL gravitational field,
  not the net one** — at typical distances the Sun out-pulls a planet by 5:1+,
  but pulls the *planet* almost identically, so the common part cancels
  (this is literally what a Hill sphere is). A test asserting on the raw net
  vector fails while the physics is correct; assert on `g(ship) - g(body)`.
- **A countermeasure for bad odds should not have its own counter** — chaff's
  range falloff was reverted for exactly this reason mid-session (see User
  Preferences).
- **Splitting the fleet was already mechanically supported** (`nearestEnemy`
  picks by proximity) — the actual gap was visibility, not mechanics. Verified
  live before shipping the readout: 4 hostiles split cleanly 2/2 when the
  player's 2 ships were pulled far apart.
- **Scuttle's yield scaling with remaining core is the whole design** — it
  stops the mechanic being a free finisher bolted onto every losing fight,
  because the moment of best payoff (full core) is never the moment you most
  want to spend the ship.
- **Point defense had to become answerable** — a flat, undegradable hull stat
  meant missile/torpedo boats had no play against it at all before this
  session; it's gunnery, so it now dies with the gunnery array.
- **Combat catch-up must discard backlog past one tick's reach, not queue
  it** — queueing is what turned a brief visit to strategic time into 36 real
  minutes of hyperspeed combat afterward.

## Constraints

- **`npx tsc --noEmit` does NOT typecheck this project** — use **`npx tsc -b`**.
  Also note: `tests/combat.test.ts` is deliberately OUTSIDE `tsconfig`'s
  coverage (by design, so it never enters the app bundle) — meaning a type
  error in the test file will NOT be caught by `tsc -b` at all, only at
  runtime via `tsx`. Hit this directly this session (a required new
  `CombatObstacle` field wasn't added to several test fixtures; `tsc -b`
  stayed clean while `tsx` threw `NaN`/`undefined` at runtime). Always run
  the test suite itself after any type change touching shared interfaces.
- No eslint installed — don't attempt lint checks.
- No backend; pure client-side. "Dev-only" means dead-code-eliminated by
  Vite, not secret.
- No real economy/tech-tree systems yet.
- **Arena scale is non-linear** — body radii are fourth-root compressed, no
  single km-per-unit scale exists. System view (planets/system-scale travel)
  IS true-to-scale by contrast (`UNITS_PER_AU` applies uniformly), which is
  why the new out-of-combat gravity code could use real Newtonian mechanics
  with no invented anchor, unlike the arena's own gravity.
- **Browser sandbox artifacts** (all reconfirmed and expanded this session):
  - The 2nd+ `<Canvas>` mount in one tab deterministically loses its WebGL
    context. Open a fresh tab per view level being tested.
  - `document.hidden`/`gl.readPixels` are not valid diagnostics here.
  - Real wall-clock time advances between agent tool calls — do timing
    sensitive play→wait→pause sequences inside ONE tool call.
  - r3f only recognizes a synthetic `contextmenu` dispatched as a
    **`PointerEvent`**, targeted at `state.events.connected` (usually the
    canvas's parent DIV, not the canvas itself — inspect
    `three.events.connected` if unsure), with `offsetX`/`offsetY` explicitly
    defined via `Object.defineProperty` (a synthetic event leaves them 0) and
    preceded by a `pointerdown`/`pointerup` (click-type events only fire on
    what a prior pointerdown hit).
  - Vite HMR goes stale after store/type edits — **hard-reload** before
    concluding anything is broken.
  - Use `HTMLSelectElement.prototype` (not `window.HTMLSelectElement`) for
    the native value setter, or you get "Illegal invocation".
  - **NEW this session: `await import('/path/to/module.ts')` from a
    `javascript_exec` call gives a SEPARATE module instance from the one the
    running app uses.** Spawning ships or reading state through it silently
    diverges from the real UI (store mutations don't show up; store reads
    return fresh-module defaults, e.g. a phantom `paused: false` while the
    real game is actually paused). This caused real wasted time twice this
    session. **The fix**: expose the real singleton stores via a temporary
    probe added to `src/main.tsx` (`window.__combatStore = useCombatStore`
    etc., gated on `import.meta.env.DEV`, evaluated once at real app
    bootstrap) — then hard-reload so the probe is live, do the verification,
    and **remove the probe before finishing** (confirmed clean via
    `grep -rn "PROBE" src/`).
  - **NEW this session: the preview pane only advances real animation frames
    (rAF) when something forces a paint.** Plain `setTimeout` inside
    `javascript_exec` does NOT reliably pump frames while the pane is
    backgrounded — r3f `<Html>` markers won't mount, `useFrame` won't run, and
    the game clock (`useGameTimeStore`) advances only a tiny fraction of real
    elapsed time. The `computer` tool's `wait` action DOES force real frames.
    When verifying anything frame-or-clock dependent, use
    `computer{action:"wait", duration:N}` between steps, or interleave
    `computer{action:"screenshot"}`, rather than chaining `setTimeout`s inside
    one `javascript_exec` call.

## Important Details

- Working directory: `/Users/pikaj/Documents/Terra Relicta/TRCONQUEST`
- **`Context.md`** (capital C) — authoritative project doc, ~450+ lines now.
  Read first. Keep updated after every change, documenting *why*.
- **`tests/combat.test.ts`** — 233-check seeded pure-function suite (was 90 a
  few sessions ago). Run with `npx tsx tests/combat.test.ts`. Outside `src/`
  so it never enters the app typecheck or bundle (see Constraints above for
  the sharp edge this creates).
- Dev server: `npm run dev` (Vite, port 5173, base `/TRCONQUEST/` — navigate
  to `http://localhost:5173/TRCONQUEST/` explicitly). `.claude/launch.json`
  registers it as `trc-dev`. A dev server was often ALREADY RUNNING at the
  start of sessions this cycle (PID persisted across conversation turns) —
  check `lsof -i :5173` before trying to start a new one.
- Build: `npm run build`. Typecheck: `npx tsc -b`.
- Debug console: backtick key, dev build only — spawns any ship class at any
  body with any allegiance. Player-ship spawns now default
  `chaffAutoDeploy: true` (added this session, mirroring the `warpWhenReady:
  false` explicit-default pattern already used there).
- Combat source map (expanded from earlier sessions):
  - `src/data/combatData.ts` — damage matrix, weapon/defense archetypes, hull
    presets, stances, risk constants, **chaff constants**
    (`CHAFF_CHARGES`/`CHAFF_MISS_CHANCE`/`CHAFF_DURATION_SECONDS`/
    `CHAFF_AI_FIRST_THRESHOLD`/`CHAFF_AI_SECOND_THRESHOLD`), **scuttle
    constants + `scuttleDamageAt`**.
  - `src/scene/combatArena.ts` — `ArenaPoint` vs `GridNode`, light-speed
    anchor, body sizing, LOS, A*, `pickLatticeNode`, **arena-scale gravity**
    (`arenaSurfaceGravity`, `gravitationalAcceleration`, both added Phase 7).
  - `src/scene/combatResolution.ts` — the big one: `integrateMotion`,
    `stanceDestination` (+ `fleeDestination`), `stepEngagements` (now also
    doing separation, scuttle resolution, AI chaff/countermeasures,
    disengagement), `syncEngagements`, `activeEnemyContacts`,
    `pruneOvershotWaypoints`, `combatCatchUpCursor`, `isChaffActive`/
    `deployChaff`, `applyRawBlast`.
  - `src/scene/shipPhysics.ts` — gained **system-scale gravity for
    out-of-combat drift**: `systemGravityAcceleration`, `systemBodyContaining`,
    `bodyOrbitalVelocity` (all Phase 8, all real Newtonian mechanics, no
    invented anchor — see Constraints).
  - `src/hooks/useShipDriftIntegrator.ts` — **NEW file**, Phase 8. Sub-steps
    unpowered out-of-combat drift under real gravity, mirrors what the arena's
    `integrateMotion` already does for in-combat ships.
  - `src/hooks/useCombatResolver.ts` — drives combat off the clock; now also
    handles disengagement-to-system-space placement (with the stranded vs.
    powered offset distinction) and the strategic-time catch-up clamp.
  - `src/state/combatStore.ts` — live engagements; gained `setFleetTarget`,
    `orderScuttle`.
  - `src/state/shipStore.ts` — gained `chaffRemaining`/`chaffActiveUntilSimDays`
    on `ShipCombatState`, `chaffAutoDeploy`/`drift` on `ShipInstance`,
    `deployChaff`/`setChaffAutoDeploy`/`setDrift` actions.
  - `src/state/settingsStore.ts` — **NEW file**, Phase 7. Navigation line
    thickness preference.
  - `src/scene/routeArrow.ts` — **NEW file**, Phase 7. Shared arrowhead math
    for combat and out-of-combat navigation lines.
  - `src/scene/NavigationLine.tsx` — **NEW file**, Phase 7. Out-of-combat
    route line with arrowhead.
  - Views: `CombatViewScene` / `CombatGrid` / `CombatShipMarker` /
    `CombatPathLine` / `CombatEngagementLine`; panels `CombatPanel` (now with
    Focus Fleet, per-row odds, Chaff row + auto-deploy checkbox, Scuttle
    row), `FleetManagement`, `ShipPanel`, `SettingsPanel` (**new**),
    `DraggableWindow` (gained `anchor` prop, collapse-with-anchor-preserved,
    viewport drag-clamping).
- GitHub Pages deploys via `.github/workflows/deploy.yml` on push to `main`.
  Whether Settings → Pages → Source is actually "GitHub Actions" has never
  been reverified across many sessions now.

## Open Questions

- **Should Phases 7–9 be committed (and pushed)?** Nothing has been committed
  since `3f8172b`. This is the largest amount of uncommitted work this
  project has carried between sessions — worth raising proactively even
  though the house rule is to wait to be asked.
- **The reported "ship doesn't reroute to its destination" bug was NOT
  reproduced**, despite thorough live testing: fresh orders and mid-flight
  redirects both verified working in system view AND the combat arena,
  including confirming actual position convergence toward the new target over
  real elapsed time (using the real store, exposed via probe — not the
  `await import()` phantom-instance trap). **Still open**: need the user's
  exact reproduction steps — which view, what the ship was doing right before
  the order (resting / already traveling / in combat with a target), and
  whether the game was paused. One real environment confound was found and
  should be ruled out first: this sandboxed preview pane throttles rAF hard
  when backgrounded, so a ship can look motionless for several real seconds
  even when working correctly — worth asking whether that matches what was
  seen, or whether it looked like the order was simply refused/ignored.
- Is GitHub Pages actually live? Still unverified across many sessions.
- **Combat balance is more untested by real play than ever** — gravity,
  chaff, scuttle, fleet-focus-fire, hull separation, and disengagement have
  ALL landed without a human playing a fight end-to-end start to finish.

## Next Steps

- Get the user's precise reproduction steps for the reroute bug (see Open
  Questions) — don't guess further without them.
- Ask about committing/pushing Phases 7–9 — a lot of verified work is at risk
  sitting only on disk.
- A real playtesting pass, given how much combat-feel-altering work has
  landed untested by an actual player.
- Roadmap candidates, roughly by value (unchanged from prior sessions,
  still not started):
  - **Combat feedback**: no visual for a shot fired/intercepted/blocked —
    damage just appears on bars. A tracer/impact layer and a "no line of
    fire" indicator would make the terrain and countermeasure rules legible
    without reading the panel — especially relevant now that chaff/PD/scuttle
    all exist but have no visual language of their own beyond badges/bars.
  - **Loadout editing** in the Ship Designer, once resources/refit exist.
  - Long-unstarted: galactic view (stub), star systems beyond Sol, real
    economy/tech systems.

## User Preferences

- **Wants honest, concrete, LIVE verification**, not just pure-function
  tests, for anything user-facing — and has been right often enough (chaff
  badge visibility, panel anchoring, fleet-split proximity behavior, the
  240x strategic-time bug) that live browser confirmation is treated as the
  real bar, with pure-function tests as the fast, precise layer underneath
  it. When live verification isn't possible or a bug can't be reproduced
  despite real effort, **say so plainly rather than filling the gap with
  guesswork** — this was tested directly this session with the
  unreproduced reroute bug, and the honest "I tried hard and couldn't
  reproduce it, here's exactly what I checked, here's what I need from you"
  response is the expected shape, not a fabricated fix.
- **Corrects a misread design direction plainly, and expects it reverted
  cleanly, not defended.** Mid-session: an implementation of "chaff
  counterplay" (a range falloff) was corrected with "its not counterplay to
  chaff thats the problem, its counterplay against odds" — i.e., the
  countermeasure itself needed to get STRONGER, and the actual gap was
  *other* tools for a losing player, not a nerf disguised as depth. The
  right response was full reversion of the specific wrong piece (kept what
  was independently good — point defense scaling survived because it's
  genuinely an underdog tool) plus a clarifying question before building
  more, rather than layering fixes on a wrong foundation.
- **`AskUserQuestion` works well when a request is genuinely open-ended** —
  used once this session ("what should a player reach for when losing?")
  and the multi-select answer (split the fleet / fleet focus fire / doomed-
  ship trades) directly shaped the next several features. Use it for
  direction, not for confirming things already decided.
- **Only commit when explicitly asked.** Reinforced hard this session — a
  huge amount of work has now accumulated uncommitted across several
  sessions in a row. Still never commit unprompted, but it's reasonable to
  flag the growing pile proactively (done above, under Open Questions).
- Gives concrete feedback in short messages that **bundle several distinct
  asks at once** (this session had single messages with 5–9 separate items)
  — separate and address each rather than conflating them, and it's fine to
  work through them in a batch with periodic check-ins rather than asking
  permission before each one.
- Comfortable delegating large, ambiguous design work and trusting judgment
  calls — but expects those calls **surfaced clearly afterward**, including
  when a call turns out to need correcting (see chaff falloff above).
- Asked previously to be told proactively if a request is better suited to
  Opus or overkill for it — no explicit instance of this coming up this
  session, but the preference stands.
- **Reports bugs precisely and from real observation.** Every specific
  numeric/behavioral bug report across many sessions has pointed at a real
  structural issue when investigated (light-speed ratio, teleport bugs, the
  strategic-time 240x bug, chaff/PD lacking counterplay). The one exception
  so far is the still-open reroute report, which extensive live testing could
  not reproduce — treat that as "needs more specific repro info," not as
  evidence the pattern has changed.
