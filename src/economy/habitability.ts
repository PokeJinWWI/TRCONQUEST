// Habitability and the cost of simply staying alive (Complex mode). A world's `habitability` (0..1) says how kind its surface is to
// the people living on it: Earth, Venus and Mars (terraformed, in this setting) are 1; a barren rock or a gas-giant aerostat has to
// make its own air, water and pressure. A pop's LIFE SUPPORT need (economy/species, basic tier) scales with `1 - habitability`, so a
// good world needs none and a hostile one spends heavily just to stay alive; a small flat penalty to standard of living (capped)
// is the strain of living on one.
import type { PlanetClass } from '../scene/planetData'

export const HABITABILITY_BY_CLASS: Record<PlanetClass, number> = {
  continental: 1,
  ocean: 0.9,
  hycean: 0.5,
  desert: 0.7,
  eyeball: 0.6,
  ice: 0.3,
  barren: 0.25,
  toxic: 0.2,
  lava: 0.05,
  'gas-giant': 0.1,
  'ice-giant': 0.1,
}

export const habitabilityOfClass = (planetClass: PlanetClass): number => HABITABILITY_BY_CLASS[planetClass] ?? 0.5

// Need-units of life support per head at habitability 0 (per tier, before the wealth factor); same unit as the other need groups' `base`.
export const LIFE_SUPPORT_GROUP_ID = 'life-support'
// The most standard of living a hostile world costs (at habitability 0), a flat deduction on the raw score.
export const HABITAT_SOL_PENALTY_CAP = 0.08

// How much of a pop's life-support need the world leaves it with: 0 on a fully habitable world.
export const lifeSupportScale = (habitability: number | undefined): number => 1 - Math.max(0, Math.min(1, habitability ?? 1))
export const habitatPenalty = (habitability: number | undefined): number => HABITAT_SOL_PENALTY_CAP * lifeSupportScale(habitability)
