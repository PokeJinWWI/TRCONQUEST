// Selection in the galactic view, the pure part: which panels the scene shows,
// and which ship stands for the Solar Neighbourhood badge (scene/GalacticShips.tsx).

// A selected ship opens the ship panel, as in every other view; a selected
// cluster keeps its own window (it carries the jump-risk line for the selected
// ships), so both can be open at once.
export function galacticPanels(selectedShipId: string | null, selectedClusterId: string | null): { ship: boolean; cluster: boolean } {
  return { ship: !!selectedShipId, cluster: !!selectedClusterId }
}

// The ship the badge on the Solar Neighbourhood selects (click) and stands for
// (box select): the first of the own ships inside it, or null when there are none.
export function homeBadgeLeadId(home: readonly { id: string }[]): string | null {
  return home[0]?.id ?? null
}
