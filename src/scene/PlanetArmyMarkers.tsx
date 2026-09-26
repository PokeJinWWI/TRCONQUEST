import { useEffect, useMemo } from 'react'
import { Html } from '@react-three/drei'
import { Color, ShaderMaterial, SRGBColorSpace, Vector2 } from 'three'
import { buildGeometry, TEX_WIDTH, useNodeTexture, VERT, type HoloNode } from './HoloGlobe'
import { useArmyStore } from '../state/armyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useViewStore } from '../state/viewStore'
import { ownerDisplay } from '../data/countryRoster'
import { ARMY_KINDS } from '../data/armyData'
import { TERRAIN } from '../data/groundData'
import { armiesOnBody, armyStrength } from './armyLogic'
import { groundSurface, holderOf } from './groundLogic'
import { TERRAIN_IDS } from './planetTerrain'
import { normalize } from './surfaceMesh'
import { GroundBattleSummary, useGroundBattles } from '../components/ArmyViews'
import { relationColorOf, useRelationKey } from '../state/shipRelations'

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
  // A war starting or ending recolours the chips (they show relation, not nation).
  useRelationKey()
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
        const { name } = ownerDisplay(a.ownerId)
        const color = relationColorOf(a.ownerId)
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

// Each fine node is one crisp cell (its triangle's nearest corner), so the
// front reads as sharp patches rather than a colour wash blurred across the
// mesh. Node colours live in a texture (see HoloGlobe.useNodeTexture): alpha
// 255 where a nation holds the node, 0 where nobody does.
const SHELL_FRAG = /* glsl */ `
uniform sampler2D uNodes;
uniform vec2 uTexSize;
varying vec3 vIds;
varying vec3 vBary;
vec4 node(float id) {
  float row = floor((id + 0.5) / uTexSize.x);
  float col = id - row * uTexSize.x;
  return texture2D(uNodes, (vec2(col, row) + 0.5) / uTexSize);
}
void main() {
  vec3 w = vBary;
  float id = w.x >= w.y && w.x >= w.z ? vIds.x : (w.y >= w.z ? vIds.y : vIds.z);
  vec4 n = node(floor(id + 0.5));
  if (n.a < 0.5) discard;
  gl_FragColor = vec4(n.rgb, 0.4);
}
`

function SurfaceControlShell({ bodyName, radius }: { bodyName: string; radius: number }) {
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const holders = useTerritoryStore((s) => s.nodeHolders[bodyName])
  const surface = useMemo(() => groundSurface(bodyName, owners), [bodyName, owners])
  const nodeAt = useMemo(() => {
    const c = new Color()
    const rgb = { r: 0, g: 0, b: 0 }
    return (i: number): HoloNode => {
      if (!surface) return { r: 0, g: 0, b: 0, land: false }
      const terrain = TERRAIN[TERRAIN_IDS[surface.terrain[i]]]
      const h = terrain.paintable ? holderOf(bodyName, i, owners, { [bodyName]: holders ?? {} }) : undefined
      if (!h) return { r: 0, g: 0, b: 0, land: false }
      c.setStyle(ownerDisplay(h).color, SRGBColorSpace).getRGB(rgb, SRGBColorSpace)
      return { r: Math.round(rgb.r * 255), g: Math.round(rgb.g * 255), b: Math.round(rgb.b * 255), land: true }
    }
  }, [surface, holders, owners, bodyName])
  const { texture, rows } = useNodeTexture(nodeAt, nodeAt)
  const geometry = useMemo(() => buildGeometry(radius * 1.01), [radius])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: SHELL_FRAG,
        uniforms: { uNodes: { value: texture }, uTexSize: { value: new Vector2(TEX_WIDTH, rows) } },
        transparent: true,
        depthWrite: false,
      }),
    [texture, rows],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  if (!surface) return null
  return <mesh geometry={geometry} material={material} raycast={() => null} />
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
