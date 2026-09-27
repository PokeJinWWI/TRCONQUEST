import type { Building } from '../../economy/economyTypes'

// Identical buildings (same recipe) for the planet screen's grouped tiles, in
// first-seen order. Pure.
export function groupsOf(buildings: Building[]): Building[][] {
  const byRecipe = new Map<string, Building[]>()
  for (const b of buildings) {
    const g = byRecipe.get(b.recipeId)
    if (g) g.push(b)
    else byRecipe.set(b.recipeId, [b])
  }
  return [...byRecipe.values()]
}
