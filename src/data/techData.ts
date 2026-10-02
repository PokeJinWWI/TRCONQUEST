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

// --- The tree ------------------------------------------------------------
//
// Eight open root branches plus one locked one, per the user's own design
// brief. Real-world fields, not invented ones. Each node's `category` is the
// research pool it's paid from: theory is Physics, turning it into hardware is
// Engineering, life sciences are Society — so one branch crosses trees (Warp
// Theory → Warp Drives, Orbital Mechanics → Orbital Construction). The
// per-tree lists below are filters of this one list.
const BRANCH_TECHS: TechNode[] = [
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
    category: 'engineering',
    description:
      "Continuous stationkeeping thrust, precisely countering a body's gravity well. A ship can hold any position it chooses instead of settling into a natural orbit — at the real cost, in reaction mass and power, of fighting gravity every second it does.",
    cost: 130,
    prerequisites: [['orbital-mechanics']],
  },
  {
    id: 'orbital-construction',
    name: 'Orbital Construction',
    category: 'engineering',
    description:
      'Building and holding station at real orbital scale, unmanned and unattended — the basis for a Starbase: a permanent claim on a system that needs no world to stand on.',
    cost: 60,
    // Starbases are what a colony needs in its system
    // (scene/colonies.canColonize), so it stays cheap.
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
    category: 'engineering',
    description:
      "Efficient heat dissipation and recapture. Exotic matter's output is effectively infinite, but only as much of it as doesn't leak away as waste heat is actually usable.",
    cost: 80,
    prerequisites: [['thermodynamics']],
  },
  {
    id: 'thermal-cloaking',
    name: 'Thermal Cloaking',
    category: 'engineering',
    description: "Actively suppressing and redirecting a hull's own heat signature.",
    cost: 160,
    prerequisites: [['waste-heat-management']],
  },
  {
    id: 'exotic-matter-containment',
    name: 'Exotic Matter Containment',
    category: 'engineering',
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
    category: 'engineering',
    description: 'Coherent, focused beams of energy — the physics behind every laser and beam weapon in service.',
    cost: 90,
    prerequisites: [['electromagnetism']],
  },
  {
    id: 'shielding',
    name: 'Shielding',
    category: 'engineering',
    description: 'Deflector fields — a standing electromagnetic barrier that absorbs incoming energy before it reaches the hull.',
    cost: 90,
    prerequisites: [['electromagnetism']],
  },
  {
    id: 'point-defense-systems',
    name: 'Point Defense Systems',
    category: 'engineering',
    description: 'Fast-tracking, short-range interception fire, purpose-built to shoot down incoming missiles and torpedoes.',
    cost: 90,
    prerequisites: [['electromagnetism']],
  },
  {
    id: 'sensors-and-jammers',
    name: 'Sensors & Jammers',
    category: 'engineering',
    description: 'Long-range electromagnetic detection, and the countermeasures built to blind it.',
    cost: 130,
    prerequisites: [['electromagnetism']],
  },
  {
    id: 'mirror-coating',
    name: 'Mirror Coating',
    category: 'engineering',
    description:
      "A reflective hull finish that scatters a portion of incoming laser fire — a direct, narrow counter to Directed Energy Weapons, and useful cover against passive optical detection besides.",
    cost: 170,
    prerequisites: [['directed-energy-weapons']],
  },
  {
    id: 'dyson-swarm-engineering',
    name: 'Dyson Swarm Engineering',
    category: 'engineering',
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
    category: 'society',
    description: 'The study of living systems — anatomy, genetics, and the chemistry that drives them.',
    cost: 50,
    prerequisites: [],
  },
  {
    id: 'genetic-engineering',
    name: 'Genetic Engineering',
    category: 'society',
    description: 'Directly editing genetic code — hardier colonists and crops engineered for conditions Earth life never evolved for.',
    cost: 90,
    prerequisites: [['biology']],
  },
  {
    id: 'xenobiology',
    name: 'Xenobiology',
    category: 'society',
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
  // The engineering that turns Warp Theory into a drive a hull can carry:
  // what actually lets a ship's warp drive fire (shipPhysics.planMove).
  {
    id: 'warp-drives',
    name: 'Warp Drives',
    category: 'engineering',
    description: 'Building the theory into hardware: field generators and exotic-matter handling small and robust enough to fit a ship.',
    cost: 90,
    prerequisites: [['warp-theory']],
  },
  // Signal relays riding the same exotic-matter warp field a warp drive
  // does — see commsData.ts's WARP_COMMS_SPEED_C for the actual speed this
  // buys (a balance pick, not derived). The first of two comms tiers gating
  // FTL communications (see commsData.ts's own top-of-file comment) —
  // before either is researched, every command to a distant fleet and
  // everything the player sees of it travels at light speed instead.
  {
    id: 'warp-comms',
    name: 'Warp Comms',
    category: 'engineering',
    description: 'FTL signal relays, riding the same exotic-matter warp field a warp drive does — order and report transit times measured in days rather than years.',
    cost: 90,
    prerequisites: [['warp-theory']],
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
    category: 'engineering',
    description: 'Computation exploiting superposition and entanglement — a real leap in processing efficiency.',
    cost: 90,
    prerequisites: [['quantum-mechanics']],
  },
  {
    id: 'quantum-communications',
    name: 'Quantum Communications',
    category: 'engineering',
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
    category: 'engineering',
    description: 'Energy release from nuclear reactions — a real efficiency gain over chemical or purely electromagnetic power.',
    cost: 90,
    prerequisites: [['atomic-physics']],
  },
  {
    id: 'radioisotope-power',
    name: 'Radioisotope Power Systems',
    category: 'engineering',
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
    category: 'engineering',
    description: 'Manufacturing hyperium directly from exotic matter, rather than relying on rare natural deposits.',
    cost: 300,
    prerequisites: [['hyperspace-theory', 'exotic-matter-theory']],
  },
  // The second, capstone comms tier — needs BOTH Hyperspace Theory AND
  // Quantum Communications (whose own description already reads as a proto
  // instant-comms tech) actually landed, the same "converges from two
  // branches" shape hyperium-synthesis above uses. Removes the light-speed
  // command lag entirely, at any distance, for whichever country researches
  // it — see commsData.ts.
  {
    id: 'hyper-comms',
    name: 'Hyper Comms',
    category: 'engineering',
    description: 'Entangled hyperspace relays — a message departs and arrives in the same instant, anywhere. The end of the light-speed leash on command.',
    cost: 260,
    prerequisites: [['hyperspace-theory', 'quantum-communications']],
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

// --- Power Systems (Engineering) -------------------------------------------
//
// A small, linear Power Systems chain
// gating the ship builder's Power Distribution tiers (see shipModules.ts's
// own "Power Distribution" section and POWER_TIER_TECH_ID) — every ship
// defaults to Tier 1 for free, so the chain starts at Tier 2. A flat
// prerequisite line (each tier needs the one before) rather than branching,
// since there's no meaningful choice here, just an investment ladder.
const POWER_TECHS: TechNode[] = [
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

// Every tech, all three trees together (the "All" tree view).
export const ALL_TECHS: TechNode[] = [...BRANCH_TECHS, ...POWER_TECHS]
export const PHYSICS_TECHS: TechNode[] = ALL_TECHS.filter((n) => n.category === 'physics')
export const SOCIETY_TECHS: TechNode[] = ALL_TECHS.filter((n) => n.category === 'society')
export const ENGINEERING_TECHS: TechNode[] = ALL_TECHS.filter((n) => n.category === 'engineering')

export const TECHS_BY_CATEGORY: Record<TechCategory, TechNode[]> = {
  physics: PHYSICS_TECHS,
  society: SOCIETY_TECHS,
  engineering: ENGINEERING_TECHS,
}

export function findTech(id: string): TechNode | undefined {
  return ALL_TECHS.find((n) => n.id === id)
}

// A tree's own roots: nodes none of whose prerequisites are in `techs` (a
// global root, or the first node of a tree that builds on another tree).
export function localRoots(techs: TechNode[]): TechNode[] {
  const ids = new Set(techs.map((n) => n.id))
  return techs.filter((n) => n.prerequisites.every((set) => set.every((id) => !ids.has(id))))
}

// Prerequisites of `node` that live outside `techs` (in another tree).
export function externalPrerequisites(node: TechNode, techs: TechNode[]): TechNode[] {
  const ids = new Set(techs.map((n) => n.id))
  const out = new Map<string, TechNode>()
  for (const set of node.prerequisites) for (const id of set) if (!ids.has(id)) { const t = findTech(id); if (t) out.set(id, t) }
  return [...out.values()]
}

// True if ANY prerequisite set is fully satisfied (or there are none at all
// — a root). This is the "OR of ANDs" read of TechNode.prerequisites.
export function prerequisitesMet(node: TechNode, researchedIds: ReadonlySet<string>): boolean {
  if (node.prerequisites.length === 0) return true
  return node.prerequisites.some((set) => set.every((id) => researchedIds.has(id)))
}

// How many (non-Anomalous) techs, any tree, have to be researched before
// Anomalous Phenomena is even attemptable — a simple aggregate threshold
// rather than an ordinary prerequisite, since the node itself isn't being
// expanded yet and there's nothing to be a "child" of.
export const ANOMALOUS_UNLOCK_THRESHOLD = 15

export function anomalousUnlocked(researchedIds: ReadonlySet<string>): boolean {
  const count = ALL_TECHS.filter((n) => !n.locked && researchedIds.has(n.id)).length
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
// Links cross trees, so the rule runs on every tech and the result is cut
// down to `techs` (the tree being shown).
export function visibleNodeIds(techs: TechNode[], researchedIds: ReadonlySet<string>): Set<string> {
  const all = new Map(ALL_TECHS.map((n) => [n.id, n]))
  for (const n of techs) all.set(n.id, n)
  const graph = [...all.values()]
  const visible = new Set<string>()
  const childrenOf = (parentId: string) => graph.filter((n) => n.prerequisites.some((set) => set.includes(parentId)))

  for (const node of graph) {
    if (node.prerequisites.length === 0) visible.add(node.id)
  }
  for (const id of researchedIds) {
    visible.add(id)
    for (const child of childrenOf(id)) {
      visible.add(child.id)
      for (const grandchild of childrenOf(child.id)) visible.add(grandchild.id)
    }
  }
  const shown = new Set(techs.map((n) => n.id))
  return new Set([...visible].filter((id) => shown.has(id)))
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

// --- Research queue --------------------------------------------------------
//
// A nation can queue research for later (techStore.queueTech): queued techs
// are researched in order as soon as their prerequisites are met and their
// own tree has the points. Queueing a tech whose prerequisites aren't met or
// queued yet queues those first (the first alternative of an OR).

// The ids to append to `queue` so `id` can be researched: its missing
// prerequisites first (depth first), then itself. Empty if it is already
// researched or queued.
export function queuePlan(id: string, researched: ReadonlySet<string>, queue: readonly string[]): string[] {
  const out: string[] = []
  const have = (t: string) => researched.has(t) || queue.includes(t) || out.includes(t)
  const visit = (t: string, depth: number) => {
    if (have(t) || depth > 50) return
    const node = findTech(t)
    if (!node) return
    if (!prerequisitesMet(node, new Set([...researched, ...queue, ...out]))) {
      // Take the alternative that needs the fewest new techs.
      const sets = node.prerequisites.map((set) => set.filter((p) => !have(p)))
      const pick = sets.reduce((a, b) => (b.length < a.length ? b : a), sets[0] ?? [])
      for (const p of pick) visit(p, depth + 1)
    }
    if (!have(t)) out.push(t)
  }
  visit(id, 0)
  return out
}

// Which queued techs get researched now, in order, given the points in each
// tree (spent as it goes). Within one tree the queue order holds: once a tree's
// next tech can't be afforded, nothing later in that tree jumps ahead of it.
export function queuedResearchNow(queue: readonly string[], researched: ReadonlySet<string>, points: Record<TechCategory, number>, freeCost = false): string[] {
  const have = new Set(researched)
  const left = { ...points }
  const blocked = new Set<TechCategory>()
  const done: string[] = []
  for (const id of queue) {
    const node = findTech(id)
    if (!node || have.has(id)) continue
    if (blocked.has(node.category)) continue
    if (!prerequisitesMet(node, have) || (node.locked && !anomalousUnlocked(have))) continue
    if (!freeCost && left[node.category] < node.cost) {
      blocked.add(node.category)
      continue
    }
    if (!freeCost) left[node.category] -= node.cost
    have.add(id)
    done.push(id)
  }
  return done
}

// How many months until each queued tech is researched, given the points in
// each tree now and what each tree earns a month (0 = it can go right now,
// null = never at this rate, e.g. a tree with no labs). Plays the queue forward
// month by month with the same rule the game uses (queuedResearchNow), so a
// tech that needs another tree's tech waits for it and yields to the ready ones.
export function researchEtas(
  queue: readonly string[],
  researched: ReadonlySet<string>,
  points: Record<TechCategory, number>,
  monthly: Record<TechCategory, number>,
  maxMonths = 360,
): Map<string, number | null> {
  const eta = new Map<string, number | null>()
  const have = new Set(researched)
  const left = { ...points }
  let remaining = queue.filter((id) => !have.has(id))
  for (let month = 0; month <= maxMonths && remaining.length > 0; month++) {
    const now = queuedResearchNow(remaining, have, left)
    for (const id of now) {
      const node = findTech(id)
      if (!node) continue
      left[node.category] -= node.cost
      have.add(id)
      eta.set(id, month)
    }
    remaining = remaining.filter((id) => !have.has(id))
    for (const c of ['physics', 'society', 'engineering'] as TechCategory[]) left[c] += monthly[c] ?? 0
  }
  for (const id of remaining) eta.set(id, null)
  return eta
}

// "now", "about 3 months", "about 2 years", or "not at this rate".
export function formatEta(months: number | null | undefined): string {
  if (months === null || months === undefined) return 'not at this rate'
  if (months <= 0) return 'now'
  if (months < 24) return `about ${months} month${months === 1 ? '' : 's'}`
  return `about ${Math.round(months / 12)} years`
}
