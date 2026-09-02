# Project Context

## Objective
Terra Relicta: Conquest — a web-based grand strategy game (Vite + React + TypeScript + three.js/r3f). Two-person team: the user owns the combat/tech track; a collaborator owns economy/politics (Victoria-3-style simulation). This session's work spanned three major features on the combat/tech side: finishing the Ship Builder + weapon rework, building a full Technology system (Physics tree + 4 mechanical hooks), and a Workspace Tabs UI overhaul (plus two window-manager bugfixes and a Tech Tree graph view).

## Current State
Everything implemented this session is **complete, tested, and verified live** — nothing is mid-implementation. Full verification sweep (`npx tsc -b`, all 7 `tests/*.test.ts` suites, `npm run build`) passes clean. **Nothing has been committed** (house rule: never commit unless explicitly asked) — `git status` will show a long list of modified/new files.

**This project already maintains a single authoritative, continuously-updated project log at `Context.md` (repo root)** — hundreds of lines covering every design decision, all 15 combat phases, the Technology system, and this session's UI work in full detail. It was just brought fully up to date at the end of this session. **A new session should read `Context.md` first, before anything else** — it is the real source of truth, far more complete than this handoff file.

**Filesystem warning, worth keeping**: this repo's filesystem (macOS APFS) is case-insensitive. `Context.md`, `CONTEXT.md`, and `context.md` all refer to the exact same file. Never create a differently-cased duplicate of it — this handoff was deliberately named `HANDOFF.md` to avoid exactly that collision.

## Decisions
- **Ship Builder**: 5 slot categories (weapon/armor/shield/defense/upgrade) × 4 sizes (small/medium/large/X). The 5 hand-authored preset hulls stay completely untouched by any of it — zero regression risk. Civilian Hull chassis deliberately has no weapon/defense slots (a bug the user caught and had fixed: "why do civilian ships have weapons and stuff?").
- **Missile/torpedo rework**: missiles get range-based damage falloff (100% tracking always, less damage past optimal range); torpedoes get accuracy falloff based on range AND target hull size (bigger targets easier to hit), plus a new `evasion` stat.
- **Technology system**: 3 independent research trees (Physics/Society/Engineering, Stellaris-style). Physics fully populated (28 nodes, 7 real-world-physics branches + locked Anomalous). Society/Engineering structurally real but content-empty (Society is the collaborator's territory).
- **Warp/Hyperdrive ARE genuinely tech-gated** (per the user's explicit mid-session correction — an earlier draft had left them permanently ungated) but default-seeded as already-researched on every fresh country, so existing gameplay doesn't regress.
- **Mandatory orbit-in-combat**: ships without Free-Flight Maneuvering (a Classical Mechanics tech) now default to actually orbiting the body they're fighting near instead of free-floating for free. Player-only gating — no NPC-nation tech link exists in the data model.
- **Workspace Tabs**: single-active-tab only (never multiple simultaneous `<Canvas>` mounts) — an instant snapshot/restore against the existing global `viewStore`/`shipStore.selectedShipId`, not a deep per-component refactor. The tab bar **swaps with `ResourceBar`** in the header (never both visible at once) — this was a mid-session pivot from an original "always-visible second row" design, after the user said "make it a swap... this way we can reduce clutter." Tabs are renameable (double-click).
- **Gallery view** (multiple tabs' scenes rendered live at once, in a grid) was explicitly scoped OUT to its own future phase, confirmed with the user as a real technical risk: the app currently only ever mounts one `<Canvas>` at a time; N simultaneous tiles means N real WebGL contexts (browsers cap concurrent contexts around 8-16), each duplicating a full per-frame orbital/physics render loop.

## Constraints
- **Never commit unless explicitly asked.**
- Full verification sweep required after any change: `npx tsc -b` + all 7 `tests/*.test.ts` files + `npm run build`.
- The browser sandbox can't reliably render/screenshot a second WebGL context, and screenshots can go stale relative to real DOM/store state right after a script-driven mutation — verify via `get_page_text` or a direct store read rather than trusting a screenshot alone when something looks like it didn't happen.
- Live store-probe verification: temporarily expose zustand stores on `window` from `main.tsx` (e.g. `window.__tech = useTechStore`), drive actions and inspect via the browser JS tool, then **always** revert `main.tsx` to clean before ending the turn — confirm via `git status --short src/main.tsx` showing no diff.
- Dev server serves from the `/TRCONQUEST/` base path, not root.
- A "Choose your nation" onboarding gate exists in `App.tsx` (collaborator's work) — must click through it, or call `usePlayerStore.getState().selectCountry(id)` directly, before ships/most UI exists. Real country ids: `imperial-state-of-mars`, `republic-of-venus`, `orion-republic`, `kingdom-of-lalande`.
- This filesystem is case-insensitive — see the warning above. Never create a `CONTEXT.md`/`context.md` file here.

## Important Details
- **Key files touched this session**: `src/data/techData.ts`, `src/state/techStore.ts`, `src/hooks/usePlayerTech.ts`, `src/components/TechPanel.tsx`, `src/components/TechTreeGraph.tsx`, `src/data/hullChassis.ts`, `src/data/shipModules.ts`, `src/state/shipDesignStore.ts`, `src/state/shipClassResolver.ts`, `src/state/workspaceStore.ts`, `src/components/TabBar.tsx`, `src/components/DraggableWindow.tsx`, `src/hooks/useHudBarLayout.ts`, `src/state/viewStore.ts`, `src/scene/combatArena.ts` (new `orbitalHoldVelocity`), `src/scene/combatResolution.ts` (`integrateMotion`/`stepEngagements` gained `canFreeFloat`/`playerCanFreeFloat` params, both defaulted so every pre-existing caller is unaffected), `src/scene/shipPhysics.ts` (`planMove` now gates warp/hyperdrive).
- **New test files**: `tests/shipDesigns.test.ts`, `tests/tech.test.ts`, `tests/workspace.test.ts` — same standalone `npx tsx tests/X.test.ts` pattern as every other test in this project, no framework.
- **A real, previously-undiscovered bug was found and fixed this session**: `useHudBarLayout.ts`'s effect had a `[topRef, bottomRef]` dependency array, but a `useRef` object's identity never changes — since `App.tsx` calls this hook before its own onboarding-gate check, the effect first ran while the header/footer didn't exist yet, no-opped, and then (because the dependency array never actually changed) never ran again once they mounted. The `--hud-top-height`/`--hud-bottom-height` CSS vars had therefore never actually been set since the onboarding gate was added; every docked panel had silently been running on hardcoded fallback offsets. Fixed by dropping the dependency array (effect now re-runs every render). Verified live: sidebar docking gap went from a measured ~24px overlap to exactly 0px.

## Open Questions
None outstanding from this session — all four window-manager/tabs requests were fully implemented, tested, and confirmed live. Gallery view is a deliberately deferred future phase, not an open question needing an answer.

## Next Steps
In rough priority order (matches `Context.md`'s own "Natural next steps" list):
1. **Gallery view** (deferred from Workspace Tabs) — needs its own performance budget designed against before starting.
2. **Combat feedback visuals** — no visual for a shot being fired, intercepted, or blocked; damage just appears on bars.
3. **Ship Builder polish/tuning** — chassis slot budgets and module catalog numbers are a first pass; no resource/cost system gates building a design yet (any design is free to build and spawn).
4. **Technology: real research income** — currently only gainable via the dev-console grant; needs hooking into the collaborator's real economy sim (`economyStore.ts`/`economyTick.ts`).
5. **A real multi-fleet playtesting pass** — Divide/Condense/Screen, Ram, Scuttle friendly-fire, the Ship Builder, tech-gating, and orbit-hold are all individually verified but haven't been played against each other in a real fight yet.
6. Everything still unstarted on the economy/politics side (collaborator's track).

## User Preferences
- Wants thorough, honest engineering: no invented data/mechanics for systems that don't exist yet — an established, explicit pattern throughout this project.
- Prefers being asked before large architectural commitments — `EnterPlanMode` + `AskUserQuestion` were used successfully multiple times this session (Ship Builder, Technology, Workspace Tabs) before writing code.
- Gives real-time steering feedback mid-implementation and expects it incorporated immediately for small, well-scoped pivots (e.g. the tab-bar "make it a swap" correction), rather than requiring a whole new planning round.
- Wants live browser verification, not just unit tests, for anything UI-observable.
- Never wants commits without being asked.
- Appreciates being told directly when an instruction conflicts with something important (like this handoff's filename) rather than having it silently worked around or silently followed into a mistake.
