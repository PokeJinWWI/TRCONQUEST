import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { InstancedMesh, Object3D, type Group } from 'three'
import { useCombatStore } from '../state/combatStore'
import { toVector3 } from './combatArena'

// Generous ceiling on simultaneous in-flight rounds across one engagement —
// same reasoning as CombatEngagementLine's MAX_PAIRS: allocated once, and
// `mesh.count` selects how much of it is actually visible each frame, so
// rounds launching and arriving never reallocate anything.
const MAX_PROJECTILES = 64

const MISSILE_COLOR = '#c9ff5c'
const TORPEDO_COLOR = '#ff9f40'
// Torpedoes are the heavier round (see combatData's TORPEDO_SPEED_UNITS_PER_
// SECOND) — reads a little bigger, matching missile-vs-torpedo elsewhere.
const MISSILE_RADIUS = 0.05
const TORPEDO_RADIUS = 0.08

const DAMAGE_TYPE_MARKER_LABEL: Record<'missile' | 'torpedo', string> = {
  missile: 'Missile',
  torpedo: 'Torpedo',
}

interface CombatProjectileMarkerProps {
  engagementId: string
}

interface SingleProjectileLabelProps {
  engagementId: string
  projectileId: string
}

// The label + "how far through its flight" bar for ONE in-flight round —
// same "icon in the 3D scene, HTML overlay for text/bars" split
// CombatShipMarker already uses, and for the same reason: a bar or label
// can't be drawn inside the InstancedMesh dots below (those exist purely for
// a cheap, GPU-batched moving point), so each round that wants one gets its
// own tiny mounted marker. Read via getState() inside useFrame rather than a
// reactive selector for position, matching CombatShipMarker's own reasoning
// — but progress/damage type ARE read reactively (a cheap string compare),
// since those change far less often than position and unmounting/remounting
// on every position tick would be wasteful the other way around.
function SingleProjectileLabel({ engagementId, projectileId }: SingleProjectileLabelProps) {
  const groupRef = useRef<Group>(null)
  const infoKey = useCombatStore((s) => {
    const proj = s.engagements.find((e) => e.id === engagementId)?.projectiles?.find((p) => p.id === projectileId)
    return proj ? `${proj.damageType}|${Math.round(proj.progress * 100)}` : ''
  })

  useFrame(() => {
    const engagement = useCombatStore.getState().engagements.find((e) => e.id === engagementId)
    const proj = engagement?.projectiles?.find((p) => p.id === projectileId)
    if (!engagement || !proj || !groupRef.current) return
    const pos = toVector3(proj.position).sub(toVector3(engagement.center))
    groupRef.current.position.copy(pos)
  })

  if (!infoKey) return null
  const [damageType, progressStr] = infoKey.split('|') as ['missile' | 'torpedo', string]
  const progress = Number(progressStr)
  const color = damageType === 'missile' ? MISSILE_COLOR : TORPEDO_COLOR

  return (
    <group ref={groupRef}>
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
        <div className="combat-projectile-marker">
          <span className="combat-projectile-label" style={{ color }}>
            {DAMAGE_TYPE_MARKER_LABEL[damageType]}
          </span>
          <span className="combat-projectile-progress">
            <span className="combat-projectile-progress-fill" style={{ width: `${progress}%`, background: color }} />
          </span>
        </div>
      </Html>
    </group>
  )
}

// Missiles/torpedoes actually crossing the distance to their target (see
// combatData's "Missile / torpedo travel time" and combatResolution's
// projectile-flight step) — the visible half of travel time actually being
// real: without this, a round taking several seconds to arrive would be
// invisible the whole time it's happening. Two InstancedMeshes (missile/
// torpedo) for the moving dot itself, same reasoning CombatEngagementLine's
// color-category buffers already use — cheap and GPU-batched — PLUS one
// individually-mounted label+progress-bar per round (see
// SingleProjectileLabel above) for the text a batched mesh can't carry.
export function CombatProjectileMarker({ engagementId }: CombatProjectileMarkerProps) {
  const missileRef = useRef<InstancedMesh>(null)
  const torpedoRef = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  // A joined string of ids, not an array — see CombatShipMarker's own
  // comment on why this avoids a reference-equality re-render every store
  // update. Recomputed only when the SET of in-flight rounds changes (a
  // launch or an arrival), not on every position tick — each label's own
  // position is read straight from the store in its own useFrame instead.
  const projectileIdsKey = useCombatStore((s) => {
    const engagement = s.engagements.find((e) => e.id === engagementId)
    return (engagement?.projectiles ?? []).map((p) => p.id).join(',')
  })
  const projectileIds = projectileIdsKey ? projectileIdsKey.split(',') : []

  useFrame(() => {
    const engagement = useCombatStore.getState().engagements.find((e) => e.id === engagementId)
    const missileMesh = missileRef.current
    const torpedoMesh = torpedoRef.current
    if (!missileMesh || !torpedoMesh) return

    if (!engagement || !engagement.projectiles || engagement.projectiles.length === 0) {
      missileMesh.count = 0
      torpedoMesh.count = 0
      return
    }

    const center = engagement.center
    let missileIndex = 0
    let torpedoIndex = 0

    for (const proj of engagement.projectiles) {
      const mesh = proj.damageType === 'missile' ? missileMesh : torpedoMesh
      const index = proj.damageType === 'missile' ? missileIndex : torpedoIndex
      if (index >= MAX_PROJECTILES) continue
      dummy.position.set(proj.position.x - center.x, proj.position.y - center.y, proj.position.z - center.z)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      if (proj.damageType === 'missile') missileIndex++
      else torpedoIndex++
    }

    missileMesh.count = missileIndex
    torpedoMesh.count = torpedoIndex
    missileMesh.instanceMatrix.needsUpdate = true
    torpedoMesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={missileRef} args={[undefined, undefined, MAX_PROJECTILES]} frustumCulled={false} count={0}>
        <sphereGeometry args={[MISSILE_RADIUS, 8, 8]} />
        <meshBasicMaterial color={MISSILE_COLOR} />
      </instancedMesh>
      <instancedMesh ref={torpedoRef} args={[undefined, undefined, MAX_PROJECTILES]} frustumCulled={false} count={0}>
        <sphereGeometry args={[TORPEDO_RADIUS, 8, 8]} />
        <meshBasicMaterial color={TORPEDO_COLOR} />
      </instancedMesh>
      {projectileIds.map((id) => (
        <SingleProjectileLabel key={id} engagementId={engagementId} projectileId={id} />
      ))}
    </>
  )
}
