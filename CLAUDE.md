# Terra Relicta: Conquest

Web grand-strategy game: Vite + React + TypeScript + three.js/r3f, zustand stores. Two-person team — the user owns combat/tech/ships; a collaborator owns economy/politics.

## Standing rules
- **Never commit unless explicitly asked.**
- **Verification sweep after any change:** `npx tsc -b`, every `tests/*.test.ts` (`npx tsx tests/<name>.test.ts`), and `npm run build`. All must be clean.
- **Filesystem is case-insensitive.** `Context.md` (~330KB, git-tracked running log) is the same file as `CONTEXT.md`/`context.md` — never overwrite it or create a differently-cased "separate" file. `HANDOFF.md` is a separate, older handoff note (partly stale).
- Don't read `Context.md` whole — grep it for the section you need, or read with offset/limit.
- Dev server serves from `/TRCONQUEST/`. Onboarding gate: pick a nation first (`usePlayerStore.getState().selectCountry(id)`; ids: `imperial-state-of-mars`, `republic-of-venus`, `orion-republic`, `kingdom-of-lalande`).

## Verification conventions
- **Store-probe:** to test UI state fast, temporarily expose zustand stores on `window` from `src/main.tsx`, drive them via the browser JS tool, and **always revert `main.tsx`** before ending the turn.
- Browser pane can be "hidden" (rAF suspended, stale `getComputedStyle`); verify via DOM attributes / screenshots, and use `setTimeout` not rAF for guaranteed callbacks. Vite HMR sometimes reloads to the onboarding screen — just redo setup.
- Tests are plain `tsx` scripts with a local `check()` helper, not a framework. One file per feature area; add a test file for any new mechanic and regression tests for bugs found.

## Architecture notes
- Pure-function resolvers separate from store I/O (e.g. `stepEngagements` in `scene/combatResolution.ts` vs `hooks/useCombatResolver.ts`). Keep new logic pure and testable.
- Timers are absolute `simDays` deadlines, never countdowns.
- Data/balance constants live in `src/data/*` (`combatData.ts`, `shipModules.ts`, `techData.ts`, `commsData.ts`); state in `src/state/*`.
- Optional new fields on `ShipInstance`/`CombatParticipant` default via `??` so existing literals and tests don't need updating.
- Zustand selectors should return primitives (join ids into a string) to avoid re-render churn.
- **FTL comms** (`scene/commsVisual.ts`): simulation state is live truth; a "visual" layer shows what the player's comms lag lets them see. Strategic orders queue via `queueMoveOrder`/`queueStance` (pending fields on the ship, fired by `hooks/useCommsResolver.ts`). Delay is computed from the ship's *live* position (`playerCommsDelayToShip`), never stale `ship.location`. Combat arena stays live.
- Combat tactics: boosts (thruster/shield/weapons) are mutually exclusive; Spin Thrust blocks Thruster Boost.
- **Nations own everything.** `ShipInstance.ownerId` (required) is a countryId; there are no ownerless ships and no stored allegiance. Hostility = `atWar(a, b)` from `state/diplomacyStore.ts`; the player-relative relation ('own'/'neutral'/'enemy') is derived via `state/shipRelations.ts`, never stored. Player controls gate on `isPlayerOwned`; `planMove` is player-gated, `planMoveUnchecked` is for AI/simulation.
- **Combat is N-sided:** one side per nation (`Engagement.nations`, player's nation = side 0); `CombatParticipant.hostileSides` is recomputed from diplomacy every `syncEngagements`; always test enemies with `isEnemy`, never `side !==`. Tests use `tests/testNations.ts` (TEST_PLAYER/TEST_ENEMY at war).
- **Per-country economy:** resources (`resourceStore.stateFor(id)`), shipyards (`shipyardStore.ordersFor(id)`), and tech are per nation; the player's view goes through `usePlayerResources`/`usePlayerTech`.
- **Territory** (`scene/territory.ts`, `state/territoryStore.ts`): per-body `bodyOwner` (changes only by treaty) and `bodyController` (occupation). A nation claims a system when it owns every *claimed* body there. `cedeBody` also moves the economy World (`economyStore.setWorldOwner`, the one sanctioned edit to collaborator code).
- **Armies** (`scene/armyLogic.ts` pure, `state/armyStore.ts`, `hooks/useGroundCombatResolver.ts`): armies are on a body, embarked on a `troop-transport`, or recruiting. Invading needs war with the controller + orbital superiority (no armed enemy ship orbiting); ground battles are derived, not stored, and step in fixed 0.25-day steps. Destroyed transports lose their cargo; blockaded worlds can't recruit.
- **War & peace** (`scene/warScore.ts` pure, `scene/peace.ts` store I/O): war score = occupied territory share (capital/world/outpost values) + capped battle balance; `evaluatePeace` is the one acceptance rule for AI and player alike. Start/end wars through `declareWarOn`/`proposePeace`/`makePeace`, not the raw store, so events and territory stay consistent.
- **Strategic AI** (`src/ai/`): per-empire blackboard built from one snapshot; five pure agents run in order — Diplomat → Strategist → Shipwright → Admiral → Marshal — returning intents; `executor.ts` is the only writer and uses the player's own store actions. Tuning in `data/aiData.ts`. Only nations in `countryRoster.STRATEGIC_AI_COUNTRY_IDS` run it (never the player's, never Lalande); AI wars only target neighbours (nations sharing a system). `tests/ai.test.ts` runs a headless campaign (`AI_TRACE=1` for a monthly trace).

## Working style
- User gives real-time steering mid-task; treat short corrections as authoritative constraints.
- Ask (AskUserQuestion) before large architectural commitments; use plan mode for big features.
- No invented data/mechanics for systems that don't exist yet. Report test/balance findings honestly, including "no bug found".
- Live browser verification for anything UI-observable.
