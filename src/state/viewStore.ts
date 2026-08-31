import { create } from 'zustand'

// 'combat' is the "detailed view" of an engagement, the same way 'satellite'
// is the detailed view of a body — a real view level rather than a modal
// overlay, so it gets the breadcrumb, the zoom-out-to-leave gesture, and the
// scene-remount transition every other level already has. It sits outside the
// galactic→satellite zoom ladder though: you don't reach it by zooming in on
// anything, you enter it from a ship that's in a fight.
export type ViewLevel = 'galactic' | 'interstellar' | 'system' | 'satellite' | 'combat'

interface ViewState {
  level: ViewLevel
  // Which neighborhood INTERSTELLAR is currently showing — mirrors
  // selectedStarId one level up. Only 'solar-neighborhood' has real star
  // data today (see starData's getStarsForNeighborhood), but the level
  // itself doesn't hardcode that; it's generic from here down.
  selectedNeighborhoodId: string
  selectedStarId: string
  // The planet, star (e.g. "Sol"), or other body currently open in satellite
  // view — not just planets, hence the generic name. Also doubles as system
  // view's "returning from satellite view" continuity signal: when set at
  // mount, SolarSystemScene both pre-selects that body AND starts the camera
  // near it (see SolarSystemScene's `continuityBodyRef`).
  selectedBodyName: string | null
  // Whatever's currently selected/inspected *within* the active scene — a
  // star/planet/moon id or name, in that scene's own identifier space
  // (interstellar keys by star id, system/satellite key by body name). Lives
  // here (not local scene state) specifically so the Outliner — a sibling of
  // whichever scene is mounted — can both read it (to highlight the current
  // selection) and drive it (clicking an entry selects it exactly like
  // clicking its in-scene marker would, including engaging that scene's own
  // SelectionTracker camera lock). Reset to null on every navigation
  // transition below except where a transition deliberately carries a
  // selection forward (see enterSystem/exitSatelliteToSystem).
  inViewSelection: string | null
  selectInView: (key: string | null) => void
  // Whether selecting something (a body or a ship) also eases the camera
  // onto it (SelectionTracker) — on by default, matching the behavior every
  // scene already had. Toggled from the top HUD bar (LockOnToggle) for
  // players who want to inspect something without the camera moving to
  // follow it. Deliberately doesn't affect the *unselected* default camera
  // anchor each scene falls back to (Sol/the primary body) — that's
  // navigation plumbing (it's what exit-via-zoom-out measures distance
  // against), not "following a selection," so it stays on regardless.
  lockOnEnabled: boolean
  toggleLockOn: () => void
  // `neighborhoodId` seeds selectedNeighborhoodId — used when arriving by
  // entering a neighborhood from galactic view. Omit it for a plain jump
  // (breadcrumb, or exiting a system back out) that should keep showing
  // whichever neighborhood was already selected.
  enterInterstellar: (neighborhoodId?: string) => void
  // `preselectBody` seeds `inViewSelection` — used when arriving here by
  // zooming into a star, so e.g. zooming into Sol from interstellar arrives
  // with Sol already selected (but still framed at the far default, since
  // this doesn't touch `selectedBodyName`). Omit it for a plain jump
  // (breadcrumb) with no such continuity.
  enterSystem: (starId: string, preselectBody?: string) => void
  enterSatellite: (bodyName: string) => void
  // Returning to system view via zoom-out (as opposed to the breadcrumb or a
  // fresh arrival) keeps `selectedBodyName` set so SolarSystemScene can start
  // the camera near that body instead of resetting to the far default view,
  // and carries it into `inViewSelection` too so that body arrives
  // pre-selected (matching what was open in satellite view).
  exitSatelliteToSystem: () => void
  enterGalactic: () => void
  // Which engagement the combat view is showing. Held here rather than in
  // combatStore's `viewedEngagementId` because it's navigation state — it has
  // to move in lockstep with `level`, and splitting "which view" from "what
  // that view is showing" across two stores is how you get a combat level
  // mounted with nothing to render.
  combatEngagementId: string | null
  enterCombat: (engagementId: string) => void
  // Leaves combat for the system view. Combat isn't part of the zoom ladder,
  // so there's no "one level up" to return to — system view is the sensible
  // place to land, since that's where the fight is physically happening.
  exitCombat: () => void
}

export const useViewStore = create<ViewState>((set) => ({
  level: 'system',
  selectedNeighborhoodId: 'solar-neighborhood',
  selectedStarId: 'sol',
  selectedBodyName: null,
  inViewSelection: null,
  selectInView: (key) => set({ inViewSelection: key }),
  lockOnEnabled: true,
  toggleLockOn: () => set((s) => ({ lockOnEnabled: !s.lockOnEnabled })),
  enterGalactic: () => set({ level: 'galactic', selectedBodyName: null, inViewSelection: null }),
  enterInterstellar: (neighborhoodId) =>
    set((s) => ({
      level: 'interstellar',
      selectedNeighborhoodId: neighborhoodId ?? s.selectedNeighborhoodId,
      selectedBodyName: null,
      inViewSelection: null,
    })),
  enterSystem: (starId, preselectBody) =>
    set({ level: 'system', selectedStarId: starId, selectedBodyName: null, inViewSelection: preselectBody ?? null }),
  enterSatellite: (bodyName) => set({ level: 'satellite', selectedBodyName: bodyName, inViewSelection: null }),
  exitSatelliteToSystem: () => set((s) => ({ level: 'system', inViewSelection: s.selectedBodyName })),
  combatEngagementId: null,
  // Deliberately leaves `inViewSelection` alone: entering combat is always
  // done from a selected ship, and that selection is exactly what the combat
  // view's panel wants to keep showing.
  enterCombat: (engagementId) => set({ level: 'combat', combatEngagementId: engagementId }),
  exitCombat: () => set({ level: 'system', combatEngagementId: null, inViewSelection: null }),
}))
