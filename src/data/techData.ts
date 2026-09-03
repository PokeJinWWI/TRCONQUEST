// The technology system's data model — three independent research trees
// (Physics/Society/Engineering), each a flat list of TechNodes linked by
// prerequisites. Deliberately data-only, no store access, same reasoning as
// combatData.ts's WEAPON_TYPES: "what can be researched" is one vocabulary,
// independent of any particular country's progress through it.
//
// Physics is fully populated per the user's own real-world-physics-flavored
// design brief. Society and Engineering are structurally real (every helper
// below works for them) but deliberately left content-empty — Society is the
// collaborator's economy/politics track, Engineering nobody's yet. Filling
// them in later is adding array entries, not touching any of this file's
// logic.

export type TechCategory = 'physics' | 'society' | 'engineering'

export interface TechNode {
  id: string
  name: string
  category: TechCategory
  description: string
  // Research points to unlock — spent from that category's own pool (see
  // state/techStore.ts; the three categories never share points).
  cost: number
  // Alternative prerequisite SETS — "OR of ANDs". A plain single-parent node
  // is `[['parentId']]`. A node reachable from either of two branches (see
  // exotic-matter-theory below, reachable via Quantum OR Atomic) is
  // `[['quantum-computing'], ['nuclear-energetics']]`. A node that genuinely
  // needs two different branches to have BOTH landed (see hyperium-synthesis)
  // is a single set with two entries: `[['hyperspace-theory',
  // 'exotic-matter-theory']]`. A root has `[]` — always eligible.
  prerequisites: string[][]
  // Anomalous only, today — visible from the start (per the user's own
  // framing, it's a listed starting node, just locked) but not researchable
  // until anomalousUnlocked() says so, which is a separate aggregate check
  // rather than an ordinary prerequisite (see that function's own comment).
  locked?: boolean
}

// --- Physics -----------------------------------------------------------
//
// Eight open root branches plus one locked one, per the user's own design
// brief. Real-world physics fields, not invented ones — the user gave
// explicit creative discretion here, so branch/node choices below are this
// session's judgment call within that brief, not something they dictated
// node-by-node.
export const PHYSICS_TECHS: TechNode[] = [
  // --- Classical Mechanics ------------------------------------------------
  // The one branch with a confirmed, wired mechanical effect this pass: see
  // combatArena.ts's orbitalHoldVelocity and combatResolution.ts's
  // integrateMotion. Ships without Free-Flight Maneuvering default to
  // orbiting the body they're fighting near, instead of holding an arbitrary
  // rest position for free.
  {
    id: 'classical-mechanics',
    name: 'Classical Mechanics',
    category: 'physics',
    description:
      'Newtonian trajectory prediction — the ability to accurately calculate stellar body motion, orbital mechanics, and the effect of reaction-drive thrust against them.',
    cost: 40,
    prerequisites: [],
  },
  {
    id: 'orbital-mechanics',
    name: 'Orbital Mechanics',
    category: 'physics',
    description:
      "Precise modeling of a body's own gravity well, refined enough to plan a ship's trajectory around it rather than just predicting the body's motion.",
    cost: 70,
    prerequisites: [['classical-mechanics']],
  },
  {
    id: 'free-flight-maneuvering',
    name: 'Free-Flight Maneuvering',
    category: 'physics',
    description:
      "Continuous stationkeeping thrust, precisely countering a body's gravity well. A ship can hold any position it chooses instead of settling into a natural orbit — at the real cost, in reaction mass and power, of fighting gravity every second it does.",
    cost: 130,
    prerequisites: [['orbital-mechanics']],
  },

  // --- Thermodynamics ------------------------------------------------------
  {
    id: 'thermodynamics',
    name: 'Thermodynamics',
    category: 'physics',
    description: 'The basic laws of heat and energy transfer.',
    cost: 40,
    prerequisites: [],
  },
  {
    id: 'waste-heat-management',
    name: 'Waste Heat Management',
    category: 'physics',
    description:
      "Efficient heat dissipation and recapture. Exotic matter's output is effectively infinite, but only as much of it as doesn't leak away as waste heat is actually usable.",
    cost: 80,
    prerequisites: [['thermodynamics']],
  },
  {
    id: 'thermal-cloaking',
    name: 'Thermal Cloaking',
    category: 'physics',
    description: "Actively suppressing and redirecting a hull's own heat signature.",
    cost: 160,
    prerequisites: [['waste-heat-management']],
  },
  {
    id: 'exotic-matter-containment',
    name: 'Exotic Matter Containment',
    category: 'physics',
    description: 'Controlled, gradual extraction from an exotic matter deposit, rather than an uncontrolled release.',
    cost: 200,
    prerequisites: [['waste-heat-management']],
  },

  // --- Electromagnetism ------------------------------------------------------
  // Directed Energy Weapons / Shielding / Point Defense Systems are this
  // pass's second wired branch — see shipModules.ts's requiresTechId on the
  // Laser/Heavy Beam, Shield, and Defense-category module catalogs.
  {
    id: 'electromagnetism',
    name: 'Electromagnetism',
    category: 'physics',
    description: 'The unified theory of electricity, magnetism, and light.',
    cost: 40,
    prerequisites: [],
  },
  {
    id: 'directed-energy-weapons',
    name: 'Directed Energy Weapons',
    category: 'physics',
    description: 'Coherent, focused beams of energy — the physics behind every laser and beam weapon in service.',
    cost: 90,
    prerequisites: [['electromagnetism']],
  },
  {
    id: 'shielding',
    name: 'Shielding',
    category: 'physics',
    description: 'Deflector fields — a standing electromagnetic barrier that absorbs incoming energy before it reaches the hull.',
    cost: 90,
    prerequisites: [['electromagnetism']],
  },
  {
    id: 'point-defense-systems',
    name: 'Point Defense Systems',
    category: 'physics',
    description: 'Fast-tracking, short-range interception fire, purpose-built to shoot down incoming missiles and torpedoes.',
    cost: 90,
    prerequisites: [['electromagnetism']],
  },
  {
    id: 'sensors-and-jammers',
    name: 'Sensors & Jammers',
    category: 'physics',
    description: 'Long-range electromagnetic detection, and the countermeasures built to blind it.',
    cost: 130,
    prerequisites: [['electromagnetism']],
  },
  {
    id: 'mirror-coating',
    name: 'Mirror Coating',
    category: 'physics',
    description:
      "A reflective hull finish that scatters a portion of incoming laser fire — a direct, narrow counter to Directed Energy Weapons, and useful cover against passive optical detection besides.",
    cost: 170,
    prerequisites: [['directed-energy-weapons']],
  },
  {
    id: 'dyson-swarm-engineering',
    name: 'Dyson Swarm Engineering',
    category: 'physics',
    description: 'Orbital collector arrays at a stellar scale — the electromagnetic and structural engineering behind a Dyson swarm.',
    cost: 320,
    prerequisites: [['directed-energy-weapons', 'shielding']],
  },

  // --- Biology ------------------------------------------------------
  // Placed here deliberately — before Relativity/Quantum/Atomic/
  // Extradimensional — per the user's own explicit framing: biology is a
  // foundational science, same tier as Classical Mechanics/Thermodynamics/
  // Electromagnetism above, not one of the advanced/theoretical branches
  // that follow it.
  {
    id: 'biology',
    name: 'Biology',
    category: 'physics',
    description: 'The study of living systems — anatomy, genetics, and the chemistry that drives them.',
    cost: 50,
    prerequisites: [],
  },
  {
    id: 'genetic-engineering',
    name: 'Genetic Engineering',
    category: 'physics',
    description: 'Directly editing genetic code — hardier colonists and crops engineered for conditions Earth life never evolved for.',
    cost: 90,
    prerequisites: [['biology']],
  },
  {
    id: 'xenobiology',
    name: 'Xenobiology',
    category: 'physics',
    description: "The biology of non-terrestrial life — how organisms that evolved elsewhere differ from Earth's own, and what that means for habitability and first contact.",
    cost: 90,
    prerequisites: [['biology']],
  },

  // --- Relativity ------------------------------------------------------
  {
    id: 'relativity',
    name: 'Relativity',
    category: 'physics',
    description: 'Special and general relativity — how mass, energy, and spacetime itself relate.',
    cost: 50,
    prerequisites: [],
  },
  {
    id: 'warp-theory',
    name: 'Warp Theory',
    category: 'physics',
    description: 'The theoretical basis for a warp drive: using exotic matter to warp space itself rather than moving through it.',
    cost: 110,
    prerequisites: [['relativity']],
  },
  // --- Quantum ------------------------------------------------------
  {
    id: 'quantum-mechanics',
    name: 'Quantum Mechanics',
    category: 'physics',
    description: 'The physics of the very small.',
    cost: 50,
    prerequisites: [],
  },
  {
    id: 'quantum-computing',
    name: 'Quantum Computing',
    category: 'physics',
    description: 'Computation exploiting superposition and entanglement — a real leap in processing efficiency.',
    cost: 90,
    prerequisites: [['quantum-mechanics']],
  },
  {
    id: 'quantum-communications',
    name: 'Quantum Communications',
    category: 'physics',
    description: 'Entanglement-based signaling — communication with none of the usual electromagnetic-spectrum limitations.',
    cost: 90,
    prerequisites: [['quantum-mechanics']],
  },

  // --- Atomic ------------------------------------------------------
  {
    id: 'atomic-physics',
    name: 'Atomic Physics',
    category: 'physics',
    description: 'The structure of the atom and its nucleus.',
    cost: 50,
    prerequisites: [],
  },
  {
    id: 'nuclear-energetics',
    name: 'Nuclear Energetics',
    category: 'physics',
    description: 'Energy release from nuclear reactions — a real efficiency gain over chemical or purely electromagnetic power.',
    cost: 90,
    prerequisites: [['atomic-physics']],
  },
  {
    id: 'radioisotope-power',
    name: 'Radioisotope Power Systems',
    category: 'physics',
    description: 'Steady, low-maintenance power from radioactive decay — ideal for anything that has to run unattended for a long time.',
    cost: 90,
    prerequisites: [['atomic-physics']],
  },

  // Converges Quantum and Atomic — reachable via EITHER quantum-computing OR
  // nuclear-energetics, per the user's own notes that both branches "lead to
  // exotic matter research eventually."
  {
    id: 'exotic-matter-theory',
    name: 'Exotic Matter Theory',
    category: 'physics',
    description: 'The physics of exotic matter itself — matter with a mass-energy conversion ratio far beyond anything normal matter can achieve.',
    cost: 240,
    prerequisites: [['quantum-computing'], ['nuclear-energetics']],
  },

  // --- Extradimensional ------------------------------------------------------
  // Hyperspace Theory is this pass's third wired node — see shipPhysics.ts's
  // planMove, gated the same way as Warp Theory.
  {
    id: 'extradimensional-physics',
    name: 'Extradimensional Physics',
    category: 'physics',
    description: 'The theoretical existence of dimensions beyond the familiar four.',
    cost: 50,
    prerequisites: [],
  },
  {
    id: 'hyperspace-theory',
    name: 'Hyperspace Theory',
    category: 'physics',
    description: 'The physics of hyperspace — a dimension outside the normal universe where time passes faster, reachable only by burning hyperium.',
    cost: 120,
    prerequisites: [['extradimensional-physics']],
  },
  // Needs BOTH Extradimensional's own path AND Exotic Matter Theory (from
  // Quantum/Atomic) — "hyperium manufacturing from exotic matter" per the
  // user's notes, so this is the one node the whole tree actually converges
  // on from three different roots.
  {
    id: 'hyperium-synthesis',
    name: 'Hyperium Synthesis',
    category: 'physics',
    description: 'Manufacturing hyperium directly from exotic matter, rather than relying on rare natural deposits.',
    cost: 300,
    prerequisites: [['hyperspace-theory', 'exotic-matter-theory']],
  },

  // --- Anomalous (locked) ------------------------------------------------------
  // Deliberately not expanded per the user's explicit instruction — a single
  // locked node with no children yet.
  {
    id: 'anomalous-phenomena',
    name: 'Anomalous Phenomena',
    category: 'physics',
    description: 'Something beyond every known field above — not yet understood, and not yet reachable.',
    cost: 500,
    prerequisites: [],
    locked: true,
  },
]

// Structurally real — every helper below works on these exactly like
// PHYSICS_TECHS — just content-empty. Society is the collaborator's
// economy/politics track.

export const SOCIETY_TECHS: TechNode[] = []

// --- Engineering ---------------------------------------------------------
//
// Engineering's first real content: a small, linear Power Systems chain
// gating the ship builder's Power Distribution tiers (see shipModules.ts's
// own "Power Distribution" section and POWER_TIER_TECH_ID) — every ship
// defaults to Tier 1 for free, so the chain starts at Tier 2. A flat
// prerequisite line (each tier needs the one before) rather than branching,
// since there's no meaningful choice here, just an investment ladder.
export const ENGINEERING_TECHS: TechNode[] = [
  {
    id: 'power-distribution-2',
    name: 'Power Distribution II',
    category: 'engineering',
    description: 'A second independent power bus and load-balancing grid — lets a hull run meaningfully more equipment at once without browning out.',
    cost: 90,
    prerequisites: [],
  },
  {
    id: 'power-distribution-3',
    name: 'Power Distribution III',
    category: 'engineering',
    description: 'Redundant capacitor banks and finer-grained load balancing across the grid — real headroom for a heavier, more power-hungry loadout.',
    cost: 180,
    prerequisites: [['power-distribution-2']],
  },
  {
    id: 'power-distribution-4',
    name: 'Power Distribution IV',
    category: 'engineering',
    description: "A hull-spanning smart grid, the practical ceiling of what a single reactor core can feed — even so, the biggest weapons in service still don't come cheap.",
    cost: 320,
    prerequisites: [['power-distribution-3']],
  },
]

export const TECHS_BY_CATEGORY: Record<TechCategory, TechNode[]> = {
  physics: PHYSICS_TECHS,
  society: SOCIETY_TECHS,
  engineering: ENGINEERING_TECHS,
}

export function findTech(id: string): TechNode | undefined {
  return PHYSICS_TECHS.find((n) => n.id === id) ?? SOCIETY_TECHS.find((n) => n.id === id) ?? ENGINEERING_TECHS.find((n) => n.id === id)
}

// True if ANY prerequisite set is fully satisfied (or there are none at all
// — a root). This is the "OR of ANDs" read of TechNode.prerequisites.
export function prerequisitesMet(node: TechNode, researchedIds: ReadonlySet<string>): boolean {
  if (node.prerequisites.length === 0) return true
  return node.prerequisites.some((set) => set.every((id) => researchedIds.has(id)))
}

// How much of the (non-Anomalous) Physics tree has to be researched before
// Anomalous Phenomena is even attemptable — a simple aggregate threshold
// rather than an ordinary prerequisite, since the node itself isn't being
// expanded yet and there's nothing to be a "child" of.
export const ANOMALOUS_UNLOCK_THRESHOLD = 15

export function anomalousUnlocked(researchedIds: ReadonlySet<string>): boolean {
  const count = PHYSICS_TECHS.filter((n) => !n.locked && researchedIds.has(n.id)).length
  return count >= ANOMALOUS_UNLOCK_THRESHOLD
}

// Every node id visible right now: every root (locked or not — Anomalous is
// visible from the start per the user's own framing, just not
// researchable), every already-researched node, and — the literal "two
// nodes past anything you've already researched" rule — each researched
// node's direct children (full detail) and grandchildren (still returned
// here; the UI is what decides a grandchild renders as a locked preview
// rather than full detail, since that's a presentation concern, not a
// visibility one).
export function visibleNodeIds(techs: TechNode[], researchedIds: ReadonlySet<string>): Set<string> {
  const visible = new Set<string>()
  const childrenOf = (parentId: string) => techs.filter((n) => n.prerequisites.some((set) => set.includes(parentId)))

  for (const node of techs) {
    if (node.prerequisites.length === 0) visible.add(node.id)
  }
  for (const id of researchedIds) {
    visible.add(id)
    for (const child of childrenOf(id)) {
      visible.add(child.id)
      for (const grandchild of childrenOf(child.id)) visible.add(grandchild.id)
    }
  }
  return visible
}

// `freeCost` is the dev console's "zero all tech costs" toggle (see
// techStore.ts's freeResearchMode) — skips the points check entirely rather
// than pretending `availablePoints` is huge, so a country that has never
// earned a single point can still research through the whole tree with it
// on. Defaults false so every pre-existing caller is unaffected.
export function canResearch(node: TechNode, researchedIds: ReadonlySet<string>, availablePoints: number, freeCost = false): boolean {
  if (researchedIds.has(node.id)) return false
  if (node.locked && !anomalousUnlocked(researchedIds)) return false
  if (!prerequisitesMet(node, researchedIds)) return false
  return freeCost || availablePoints >= node.cost
}
