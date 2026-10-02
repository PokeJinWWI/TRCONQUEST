// How risky a hyperdrive jump is for where it goes: further is riskier, and a
// heavier destination is riskier. One rule for a jump to a star system and for
// a jump to a whole neighbourhood (nothing can make the second yet; the rule is
// ready for when it can). The result multiplies the drive's base rate
// (shipPhysics.hyperdriveLossChance): 1 = an average jump between our own
// neighbourhood's stars, which keeps the base rates meaning what they did.
import {
  JUMP_RISK_CLUSTER_REF_KLY,
  JUMP_RISK_DISTANCE_EXPONENT,
  JUMP_RISK_MASS_EXPONENT,
  JUMP_RISK_MAX_FACTOR,
  JUMP_RISK_MIN_FACTOR,
} from '../data/shipData'
import { STARS, getStarsForNeighborhood, type StarData } from '../data/starData'
import { NEIGHBORHOODS } from '../data/neighborhoodData'

export function jumpRiskFactor(distance: number, destinationMass: number, refDistance: number, refMass: number): number {
  if (!(distance > 0) || !(destinationMass > 0)) return JUMP_RISK_MIN_FACTOR
  const raw = Math.pow(distance / refDistance, JUMP_RISK_DISTANCE_EXPONENT) * Math.pow(destinationMass / refMass, JUMP_RISK_MASS_EXPONENT)
  return Math.max(JUMP_RISK_MIN_FACTOR, Math.min(JUMP_RISK_MAX_FACTOR, raw))
}

function distance3(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function geometricMean(values: number[]): number {
  return Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length)
}

// "An average jump": the mean distance between two of our neighbourhood's
// stars, and their typical (geometric mean) mass.
function starReference(): { distanceLy: number; massKg: number } {
  let total = 0
  let pairs = 0
  for (let i = 0; i < STARS.length; i++) {
    for (let j = i + 1; j < STARS.length; j++) {
      total += distance3(STARS[i].position, STARS[j].position)
      pairs++
    }
  }
  return { distanceLy: total / pairs, massKg: geometricMean(STARS.map((s) => s.massKg)) }
}
let starRef: ReturnType<typeof starReference> | null = null

// A jump of `distanceLy` light-years to `destination`'s system.
export function starJumpRiskFactor(distanceLy: number, destination: Pick<StarData, 'massKg'>): number {
  starRef ??= starReference()
  return jumpRiskFactor(distanceLy, destination.massKg, starRef.distanceLy, starRef.massKg)
}

// A neighbourhood's mass: all its stars'.
export function clusterMassKg(clusterId: string): number {
  return getStarsForNeighborhood(clusterId).reduce((sum, s) => sum + s.massKg, 0)
}

let clusterRefMass: number | null = null

// A jump from one neighbourhood to another: their distance (thousands of
// light-years) and the mass of the one jumped to.
export function clusterJumpRiskFactor(fromClusterId: string, toClusterId: string): number {
  const from = NEIGHBORHOODS.find((n) => n.id === fromClusterId)
  const to = NEIGHBORHOODS.find((n) => n.id === toClusterId)
  if (!from || !to) return 1
  clusterRefMass ??= geometricMean(NEIGHBORHOODS.map((n) => clusterMassKg(n.id)))
  return jumpRiskFactor(distance3(from.position, to.position), clusterMassKg(to.id), JUMP_RISK_CLUSTER_REF_KLY, clusterRefMass)
}
