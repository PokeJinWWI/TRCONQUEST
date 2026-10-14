// The Colony Ship's "Colonize…" chooser, the pure part: the worlds grouped by system (named,
// the ship's own system first), and the plain-language reasons for an empty list. Which worlds
// can be colonized at all is NOT decided here: that is scene/colonies.canColonize, and the list
// is built from it.

export interface ChooserWorld {
  bodyName: string
  starId: string
  // Light-years from the nation's capital: far systems come last.
  ly: number
}

export interface ChooserGroup {
  starId: string
  name: string
  bodies: string[]
  // The system the ship is in / the nation's home system.
  here: boolean
  home: boolean
}

export interface GroupInput {
  worlds: readonly ChooserWorld[]
  hereStarId: string | null
  homeStarId: string | null
  starName: (starId: string) => string
}

// The ship's own system first, then its nation's home system, then the rest nearest first;
// each system's worlds in the order given (the system's own order), then by name.
export function groupColonizeWorlds(input: GroupInput): ChooserGroup[] {
  const { hereStarId, homeStarId } = input
  const bySystem = new Map<string, ChooserGroup>()
  const lyOf = new Map<string, number>()
  const make = (starId: string): ChooserGroup => {
    let g = bySystem.get(starId)
    if (!g) {
      g = { starId, name: input.starName(starId), bodies: [], here: starId === hereStarId, home: starId === homeStarId }
      bySystem.set(starId, g)
    }
    return g
  }
  for (const w of input.worlds) {
    make(w.starId).bodies.push(w.bodyName)
    lyOf.set(w.starId, Math.min(lyOf.get(w.starId) ?? Infinity, w.ly))
  }
  const rank = (g: ChooserGroup) => (g.here ? 0 : g.home ? 1 : 2)
  return [...bySystem.values()].sort((a, b) => rank(a) - rank(b) || (lyOf.get(a.starId) ?? Infinity) - (lyOf.get(b.starId) ?? Infinity) || a.name.localeCompare(b.name))
}

export interface NothingHereInput {
  // The system the ship is in, and its name.
  systemName: string
  hasSettlers: boolean
  // The world the ship orbits: none (at a star or in open space), one that could be settled
  // (unowned, with land), or one that cannot (a star, an owned or landless world).
  orbit: 'none' | 'settleable' | 'not'
}

// Why the "Nothing here to settle" line has nothing to offer, in the order a player can act on it.
export function nothingHereReason(i: NothingHereInput): string {
  if (!i.hasSettlers) return 'The ship carries no settlers.'
  if (i.orbit === 'not') return 'The world it orbits cannot be settled. Open Colonize… to pick a world, or right-click one.'
  return 'Nothing here to settle. Right-click a surveyed, unowned world to colonize it.'
}

// The button that lets the player take a ship's colonizing decision back, in plain words.
export function takeBackLabel(auto: boolean, headedTo: string | null): { text: string; hint: string } {
  if (auto) return { text: 'Turn off Auto-settle and pick a world', hint: 'The ship is choosing worlds to settle by itself. Turn that off to choose yourself' }
  return { text: `Cancel the trip to ${headedTo ?? 'that world'} and pick another`, hint: `The ship is on its way to found a colony on ${headedTo ?? 'a world'}, as you ordered. Cancel that to choose a different world` }
}

// The line above that button.
export function takeBackStatus(auto: boolean, headedTo: string | null): string {
  return auto ? 'Auto-settle is choosing where to settle' : `On its way to ${headedTo ?? 'a world'} to found a colony (your order)`
}
