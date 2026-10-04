// Tech tiers of the generated empires (data/generatedEmpires.ts): which techs an
// empire at each tier has researched. Only techs that exist in data/techData.ts.
//
// TECH_TIERS[t] lists what tier t ADDS; an empire at tier t has everything up to
// and including it (`techsForTier`). To extend: add techs to a tier (or append a
// tier and raise nothing else: MAX_TECH_TIER follows the list). Each tier's set
// must stay closed under prerequisites (tests/galaxyGen.test.ts checks it).
//
// The human nations (everyone in the Sol neighbourhood) are the baseline: they
// start with techStore.DEFAULT_RESEARCHED (warp theory, hyperspace theory,
// Hyperdrive Mk I, warp comms, the two Extraction techs), which is exactly tier HUMAN_BASELINE_TIER and the
// techs beneath it: they have NO warp drive. Tier 1 has no faster-than-light
// travel at all; tier 5 holds the deepest techs there are. Warp Drive Mk I is not in
// the map: an empire gets it by closeness to the galactic core
// (warpData.WARP_MK1_RADIUS_KLY), where exotic matter is.
export const TECH_TIERS: string[][] = [
  // 0: nothing yet
  [],
  // 1: the theory FTL stands on, but no drive
  ['relativity', 'extradimensional-physics'],
  // 2: the human baseline
  ['warp-theory', 'hyperspace-theory', 'hyperdrive-mk1', 'hyperium-extraction', 'exotic-matter-extraction'],
  // 3: the sciences the humans have yet to research
  [
    'classical-mechanics', 'orbital-mechanics', 'thermodynamics', 'waste-heat-management', 'electromagnetism',
    'directed-energy-weapons', 'shielding', 'point-defense-systems', 'sensors-and-jammers', 'biology',
    'genetic-engineering', 'xenobiology', 'quantum-mechanics', 'warp-comms', 'atomic-physics',
  ],
  // 4: advanced engineering
  [
    'quantum-computing', 'nuclear-energetics', 'radioisotope-power', 'orbital-construction',
    'free-flight-maneuvering', 'thermal-cloaking', 'mirror-coating', 'power-distribution-2', 'power-distribution-3',
  ],
  // 5: the deepest (anomalous-phenomena is locked behind its own unlock, so not here)
  ['exotic-matter-theory', 'exotic-matter-containment', 'hyper-comms', 'hyperium-synthesis', 'dyson-swarm-engineering', 'power-distribution-4'],
]

export const HUMAN_BASELINE_TIER = 2
export const MAX_TECH_TIER = TECH_TIERS.length - 1

// Everything an empire at `tier` has researched (clamped to the tiers there are).
export function techsForTier(tier: number): Set<string> {
  const top = Math.max(0, Math.min(MAX_TECH_TIER, Math.floor(tier)))
  return new Set(TECH_TIERS.slice(0, top + 1).flat())
}

// The highest tier whose techs are all in `researched` (an empire whose tech was
// written by hand states no tier of its own).
export function tierOfTechs(researched: ReadonlySet<string>): number {
  let tier = 0
  for (let t = 1; t <= MAX_TECH_TIER; t++) {
    if (!TECH_TIERS[t].every((id) => researched.has(id))) break
    tier = t
  }
  return tier
}
