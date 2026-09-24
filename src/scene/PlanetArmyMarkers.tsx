import { useEffect, useMemo } from 'react'
import { Html } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Color } from 'three'
import { useArmyStore } from '../state/armyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useViewStore } from '../state/viewStore'
import { ownerDisplay } from '../data/countryRoster'
import { ARMY_KINDS } from '../data/armyData'
import { TERRAIN } from '../data/groundData'
import { armiesOnBody, armyStrength } from './armyLogic'
import { groundSurface, holderOf } from './groundLogic'
import { TERRAIN_IDS } from './planetTerrain'
import { normalize, surfaceMesh } from './surfaceMesh'
import { GroundBattleSummary, useGroundBattles } from '../components/ArmyViews'

// Satellite view's picture of the ground war, drawn inside the hologram's
// rotating frame (HologramBody's children) so it turns with the world:
//   - a translucent shell tinting every node by who holds it, so the planet
//     visibly changes colour as the front moves — shown once there's a ground
//     war (units on it, or ground changed hands);
//   - one chip per army, where its units actually stand.
// The detailed, commandable version is the planetary map (GroundViewScene).
export function PlanetArmyMarkers({ bodyName, radius }: { bodyName: string; radius: number }) {
  const idsKey = useArmyStore((s) =>
    armiesOnBody(s.armies, bodyName)
      .map((a) => `${a.id}:${Math.ceil(armyStrength(a).strength)}:${a.units.map((u) => (u.position ? `${u.position.x.toFixed(2)},${u.position.y.toFixed(2)},${u.position.z.toFixed(2)}` : '')).join(';')}`)
      .join('|'),
  )
  const painted = useTerritoryStore((s) => !!s.nodeHolders[bodyName])
  const armies = useMemo(() => armiesOnBody(useArmyStore.getState().armies, bodyName), [idsKey, bodyName]) // eslint-disable-line react-hooks/exhaustive-deps
  const showShell = painted || armies.length > 0

  return (
    <>
      {showShell && <SurfaceControlShell bodyName={bodyName} radius={radius} />}
      {armies.map((a) => {
        const placed = a.units.filter((u) => u.position)
        if (placed.length === 0) return null
        const c = normalize(placed.reduce((acc, u) => ({ x: acc.x + u.position!.x, y: acc.y + u.position!.y, z: acc.z + u.position!.z }), { x: 0, y: 0, z: 0 }))
        const r = radius * 1.04
        const { name, color } = ownerDisplay(a.ownerId)
        return (
          <group key={a.id} position={[c.x * r, c.y * r, c.z * r]}>
            <Html zIndexRange={[0, 0]}>
              <div className="army-marker" style={{ borderColor: color, color }} title={`${name} ${ARMY_KINDS[a.kind].name}`}>
                <span className="army-marker-glyph">{a.kind === 'garrison' ? '■' : '▲'}</span>
                {Math.ceil(armyStrength(a).strength)}
              </div>
            </Html>
          </group>
        )
      })}
    </>
  )
}

function SurfaceControlShell({ bodyName, radius }: { bodyName: string; radius: number }) {
  const mesh = surfaceMesh()
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const holders = useTerritoryStore((s) => s.nodeHolders[bodyName])
  const surface = useMemo(() => groundSurface(bodyName, owners), [bodyName, owners])
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(Float32Array.from(mesh.positions, (v) => v * radius * 1.01), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(mesh.count.fine * 4), 4))
    g.setIndex(new BufferAttribute(mesh.faces, 1))
    return g
  }, [mesh, radius])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => {
    if (!surface) return
    const colors = geometry.getAttribute('color') as BufferAttribute
    const c = new Color()
    for (let i = 0; i < mesh.count.fine; i++) {
      const terrain = TERRAIN[TERRAIN_IDS[surface.terrain[i]]]
      const h = terrain.paintable ? holderOf(bodyName, i, owners, { [bodyName]: holders ?? {} }) : undefined
      if (h) c.set(ownerDisplay(h).color)
      colors.setXYZW(i, c.r, c.g, c.b, h ? 0.45 : 0)
    }
    colors.needsUpdate = true
  }, [geometry, surface, holders, owners, bodyName, mesh])
  if (!surface) return null
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshBasicMaterial vertexColors transparent depthWrite={false} />
    </mesh>
  )
}

// The planet view's ground-war HUD: the occupation banner and the battle's
// strength bars, shown only while this body is being fought over or is under
// occupation, with a way into the planetary map.
export function PlanetGroundHud({ bodyName }: { bodyName: string }) {
  const battles = useGroundBattles()
  const battle = battles.find((b) => b.bodyName === bodyName)
  const ownerId = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const controllerId = useTerritoryStore((s) => s.bodyController[bodyName])
  const occupier = controllerId && controllerId !== ownerId ? ownerDisplay(controllerId) : undefined
  if (!battle && !occupier) return null
  return (
    <div className="planet-ground-hud">
      {occupier && (
        <div className="occupation-banner" style={{ borderColor: occupier.color, color: occupier.color, margin: battle ? '0 0 6px' : 0 }}>
          Occupied by {occupier.name}
        </div>
      )}
      {battle && <GroundBattleSummary battle={battle} />}
      <button type="button" className="detail-view-btn planet-ground-hud-btn" onClick={() => useViewStore.getState().enterGround(bodyName)}>
        Open ground map
      </button>
    </div>
  )
}
