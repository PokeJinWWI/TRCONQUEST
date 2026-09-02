import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { useCombatStore, areHostile } from '../state/combatStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { planMove } from '../scene/shipPhysics'
import { resolveShipClass } from '../state/shipClassResolver'
import { shipCombatProfile, overallHealthFraction } from '../scene/combatResolution'
import { STARS, type StarData } from '../data/starData'

// Below this overall-health fraction a ship counts as "weak" for the escape
// check — a threshold of its own rather than reusing anything from
// combatData, since "worth abandoning the fight over" is a strategic-scale
// judgment call, not a combat-arena one.
const ESCAPE_WEAK_HEALTH_FRACTION = 0.5
// How long a weak ship has to stay completely out of combat before it
// concludes it's safe enough to actually run — long enough that a lull
// between waves of the same fight doesn't trigger it, short enough that a
// ship which survived a beating doesn't just sit there crippled forever.
const ESCAPE_SAFE_DURATION_DAYS = 2

export function shipCurrentStarId(ship: Pick<ShipInstance, 'location'>): string | null {
  const { location } = ship
  if (location.kind === 'star') return location.starId
  if (location.kind === 'orbiting' || location.kind === 'system-point') return location.systemId
  return null
}

function starDistance(a: StarData, b: StarData): number {
  const dx = a.position[0] - b.position[0]
  const dy = a.position[1] - b.position[1]
  const dz = a.position[2] - b.position[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// The nearest star (real distance, not scene units) that isn't wherever the
// ship already is and has no hostile presence right now — "another,
// non-hostile star system" read literally. Doesn't require the star to have
// system data (hasSystemData) — resting there uncharted is still a
// perfectly good place to lick your wounds, same as any player-ordered trip
// to an unexplored star already allows.
//
// `requireChartedFrom`, when non-null, additionally requires an already-
// established hyperlane from that star id — see this file's own header on
// why: a hull with no warp drive can only reach this SAFELY (a charted
// lane's loss chance, same as any ordinary hyperdrive jump) rather than
// blindly (a fresh lane's much higher one), and an autonomous decision the
// player never asked for shouldn't gamble the ship on the difference.
export function pickSafeStar(
  ship: ShipInstance,
  currentStarId: string | null,
  allShips: ShipInstance[],
  requireChartedFrom: string | null = null,
): StarData | null {
  const origin = STARS.find((s) => s.id === currentStarId) ?? STARS[0]
  const { hasHyperlane } = useHyperlaneStore.getState()
  let best: StarData | null = null
  let bestDistance = Infinity
  for (const star of STARS) {
    if (star.id === currentStarId) continue
    if (requireChartedFrom && !hasHyperlane(requireChartedFrom, star.id)) continue
    const hostilePresent = allShips.some(
      (other) => other.id !== ship.id && shipCurrentStarId(other) === star.id && areHostile(ship.allegiance, other.allegiance),
    )
    if (hostilePresent) continue
    const distance = starDistance(origin, star)
    if (distance < bestDistance) {
      bestDistance = distance
      best = star
    }
  }
  return best
}

// Autonomous last resort for the player's own ships: a hull that's weak,
// entirely out of combat, and stays that way for a while concludes the fight
// it fled isn't coming back for it and jumps itself somewhere safer, rather
// than sitting crippled at the scene of a battle it already lost until the
// player remembers to move it. Mirrors useShipOrderSettler's shape (a
// per-tick sweep over every ship, driven off the game clock) but owns a
// genuinely different decision — whether to leave at all — so it's a
// separate hook rather than another branch bolted onto that one.
export function useEscapeBehavior() {
  useEffect(() => {
    const evaluate = (simDays: number) => {
      const { ships, setSafeSince, setShipOrder, setShipLocation, setPendingHyperdriveJump, removeShip } = useShipStore.getState()
      const { engagements } = useCombatStore.getState()
      const { addHyperlane } = useHyperlaneStore.getState()
      const engagedShipIds = new Set(engagements.flatMap((e) => e.participants.map((p) => p.shipId)))

      for (const ship of ships) {
        // planMove only ever plans for player-owned hulls (see its own
        // 'not-owned' guard) — this behavior is the player's own fleet
        // quietly saving itself, not a general AI system.
        if (ship.allegiance !== 'player') continue
        // Already going somewhere, or already spooling/using its drive —
        // don't second-guess an order (the player's own, or a jump already
        // queued/in flight) that's already carrying it away from danger.
        if (ship.order || ship.combat.ftlCharge || ship.pendingHyperdriveJump) continue

        if (engagedShipIds.has(ship.id)) {
          if (ship.safeSinceSimDays != null) setSafeSince(ship.id, null)
          continue
        }

        const profile = shipCombatProfile(ship)
        const weak = profile ? overallHealthFraction(ship.combat, profile) < ESCAPE_WEAK_HEALTH_FRACTION : false
        if (!weak) {
          if (ship.safeSinceSimDays != null) setSafeSince(ship.id, null)
          continue
        }

        if (ship.safeSinceSimDays == null) {
          setSafeSince(ship.id, simDays)
          continue
        }
        if (simDays - ship.safeSinceSimDays < ESCAPE_SAFE_DURATION_DAYS) continue

        // A warp-capable hull can reach ANY safe star with zero transit risk
        // (see planMove: warp only ever rolls a loss chance for a combat FTL
        // escape charge, which this isn't). A hyperdrive-only hull can't —
        // its jump always carries a real loss chance, so this only considers
        // an already-charted lane (~10% base) rather than a fresh one
        // (~50%): the whole point of this feature is safety, and an
        // automatic decision the player never asked for shouldn't gamble the
        // ship to make that happen. If neither yields a candidate, the ship
        // just stays put and keeps checking — declining a risky "escape"
        // is itself the safe choice.
        const shipClass = resolveShipClass(ship.classId)
        const hasWarp = shipClass?.ftlDrives.some((d) => d.kind === 'warp') ?? false
        const currentStarId = shipCurrentStarId(ship)
        const destinationStar = pickSafeStar(ship, currentStarId, ships, hasWarp ? null : currentStarId)
        if (!destinationStar) continue // nowhere safe to reach right now (or nowhere safe to reach SAFELY) — stay put and keep waiting

        const result = planMove(ship, { kind: 'star', starId: destinationStar.id }, simDays)
        if (result.kind === 'order') {
          setShipOrder(ship.id, result.order, result.warpReadyOverride)
        } else if (result.kind === 'instant') {
          setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays })
          if (result.hyperlaneEstablished) addHyperlane(...result.hyperlaneEstablished)
        } else if (result.kind === 'on-cooldown' || result.kind === 'paused') {
          setPendingHyperdriveJump(ship.id, destinationStar.id)
        } else if (result.kind === 'lost-in-hyperspace') {
          removeShip(ship.id)
        }
        // Whatever happened, this attempt is resolved — clear the timer so
        // a ship that's still around (order queued, jump pending) doesn't
        // immediately re-trigger next tick, and a ship that's gone doesn't
        // matter anymore anyway.
        setSafeSince(ship.id, null)
      }
    }

    evaluate(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => evaluate(state.simDays))
  }, [])
}
