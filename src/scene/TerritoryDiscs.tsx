// Borders on the interstellar map. Every claimed star gets a translucent
// owner-coloured bubble whose surface reads as a crisp outline from any angle
// (a fresnel rim), and the bubbles are cut against each other in the shader so
// the picture is a set of REGIONS, not overlapping blobs:
//   - two bubbles of the SAME nation merge — the surface inside the other one
//     is hidden, leaving only the outline of the union;
//   - bubbles of DIFFERENT nations are split along the plane halfway between
//     their stars, and a bright seam is drawn along that plane, so where one
//     nation ends and the next begins is a visible line in both colours;
//   - a CONTESTED system is drawn as its own region in striped colours (both
//     claimants), rather than being left blank.
// Each nation's name floats over its territory, so a border is never just
// "some colour". There is no Voronoi/polygon geometry in this project and none
// is added: it's a handful of sphere meshes and one small fragment shader.
// Layered UNDER the per-star claim ring (InterstellarScene's
// StarNode/.owner-ring), which stays the authoritative per-system indicator.
import { useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector3, Vector4 } from 'three'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { STARS, starScenePosition } from '../data/starData'
import { ownerInfoOf } from '../data/ownerInfo'
import type { StarData } from '../data/starData'
import type { SystemClaim } from './territory'
import { useMapModeStore } from '../state/mapModeStore'
import { useHoverTipStore } from '../state/hoverTipStore'

// Scene units (UNITS_PER_LY = 8, so this is roughly a 1.5-2 ly reach) for a
// claimed system with no neighbor to size against, and the most a bubble is
// ever allowed to grow to even where neighbors are very far apart.
const DEFAULT_REGION_RADIUS = 12
const MAX_REGION_RADIUS = 17
// How far toward the midpoint to the nearest other claimed star a bubble
// reaches. Just past halfway, so two neighbours' bubbles overlap a little and
// the seam between them is a real plane cut rather than two tangent spheres.
const NEIGHBOR_REACH = 0.62
// Same-nation systems this close (scene units, ~3.75 ly) are joined into one
// region; the overlap factor makes the join a real bridge, not two tangent
// bubbles, and MAX_LINK_RADIUS bounds how far a link may grow a bubble.
const LINK_DISTANCE = 30
const LINK_OVERLAP = 1.15
const MAX_LINK_RADIUS = 18
// Shader array size — comfortably above the number of charted stars.
const MAX_REGIONS = 64

interface Region {
  key: string
  pos: Vector3
  radius: number
  // Owner identity for merge/cut decisions: a nation id, or a joined id list
  // for a contested system (so it never merges with anyone).
  ownerKey: string
  colors: [string, string]
  contested: boolean
  // What hovering it says when nation names are off.
  label: string
}

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec4 uCenters[${MAX_REGIONS}];
  uniform float uOwner[${MAX_REGIONS}];
  uniform int uCount;
  uniform int uSelf;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uContested;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  void main() {
    vec3 p = vWorld;
    vec3 self = uCenters[uSelf].xyz;
    float di = distance(p, self);
    float myOwner = uOwner[uSelf];
    // Distance (in scene units) from the seam with the nearest other nation.
    float seam = 1e9;
    for (int j = 0; j < ${MAX_REGIONS}; j++) {
      if (j >= uCount) break;
      if (j == uSelf) continue;
      float dj = distance(p, uCenters[j].xyz);
      if (uOwner[j] == myOwner) {
        // Same nation: inside its other bubble is interior, not border.
        if (dj < uCenters[j].w) discard;
      } else {
        // Different nation: this bubble ends at the halfway plane.
        if (dj < di) discard;
        seam = min(seam, (dj - di) * 0.5);
      }
    }
    vec3 view = normalize(cameraPosition - p);
    float rim = pow(1.0 - abs(dot(normalize(vNormalW), view)), 2.2);
    float seamGlow = 1.0 - smoothstep(0.0, 0.9, seam);
    vec3 color = uColorA;
    if (uContested > 0.5) {
      color = mix(uColorA, uColorB, step(0.5, fract((p.x + p.y + p.z) * 0.22)));
    }
    float a = 0.09 + rim * 0.7 + seamGlow * 0.8;
    gl_FragColor = vec4(color * a, a);
  }
`

function useRegions(claimsByStar: Map<string, SystemClaim>, stars: StarData[]): Region[] {
  return useMemo(() => {
    const claimed = stars.map((star) => {
      const claim = claimsByStar.get(star.id)
      if (!claim || claim.kind === 'unclaimed') return null
      const ids = claim.kind === 'owned' ? [claim.countryId] : claim.countryIds
      const colors = ids.map((id) => ownerInfoOf(id)?.color ?? '#888')
      const names = ids.map((id) => ownerInfoOf(id)?.name ?? id)
      return {
        id: star.id,
        pos: new Vector3(...starScenePosition(star)),
        ownerKey: ids.join('+'),
        colors: [colors[0], colors[1] ?? colors[0]] as [string, string],
        contested: claim.kind === 'contested',
        label: claim.kind === 'contested' ? `Contested: ${names.join(' / ')}` : `${names[0]} territory`,
      }
    }).filter((e): e is NonNullable<typeof e> => e !== null)

    return claimed.slice(0, MAX_REGIONS).map((entry, i) => {
      let nearest = Infinity
      for (let j = 0; j < claimed.length; j++) {
        if (i === j) continue
        nearest = Math.min(nearest, entry.pos.distanceTo(claimed[j].pos))
      }
      let radius = Number.isFinite(nearest) ? Math.min(nearest * NEIGHBOR_REACH, MAX_REGION_RADIUS) : DEFAULT_REGION_RADIUS
      // Systems of the same nation that lie near each other are joined into one
      // region: each bubble grows until it overlaps its nearest same-nation
      // neighbour (if within LINK_DISTANCE). Where another nation is in the way
      // the halfway-plane cut still applies, so this never spills across.
      let nearestSame = Infinity
      for (let j = 0; j < claimed.length; j++) {
        if (i !== j && claimed[j].ownerKey === entry.ownerKey && !entry.contested) nearestSame = Math.min(nearestSame, entry.pos.distanceTo(claimed[j].pos))
      }
      if (nearestSame <= LINK_DISTANCE) radius = Math.max(radius, Math.min((nearestSame / 2) * LINK_OVERLAP, MAX_LINK_RADIUS))
      return { key: entry.id, pos: entry.pos, radius, ownerKey: entry.ownerKey, colors: entry.colors, contested: entry.contested, label: entry.label }
    })
  }, [claimsByStar, stars])
}

function RegionBubble({ region, index, regions, showNames }: { region: Region; index: number; regions: Region[]; showNames: boolean }) {
  const material = useMemo(() => {
    const ownerIds = new Map<string, number>()
    const owners = regions.map((r) => {
      if (!ownerIds.has(r.ownerKey)) ownerIds.set(r.ownerKey, ownerIds.size + 1)
      return ownerIds.get(r.ownerKey)!
    })
    const centers = Array.from({ length: MAX_REGIONS }, (_, i) => (regions[i] ? new Vector4(regions[i].pos.x, regions[i].pos.y, regions[i].pos.z, regions[i].radius) : new Vector4()))
    const ownerArr = Array.from({ length: MAX_REGIONS }, (_, i) => owners[i] ?? 0)
    return new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uCenters: { value: centers },
        uOwner: { value: ownerArr },
        uCount: { value: regions.length },
        uSelf: { value: index },
        uColorA: { value: new Color(region.colors[0]) },
        uColorB: { value: new Color(region.colors[1]) },
        uContested: { value: region.contested ? 1 : 0 },
      },
    })
  }, [region, index, regions])

  // With nation names off, the border itself names its owner on hover. (With
  // names on the bubble is not hoverable, so it never gets in the way.)
  const setTip = useHoverTipStore((s) => s.setTip)
  const hoverProps = showNames
    ? { raycast: () => null }
    : {
        onPointerMove: (e: ThreeEvent<PointerEvent>) => setTip({ x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, text: region.label }),
        onPointerOut: () => setTip(null),
      }
  return (
    <mesh position={region.pos} renderOrder={-1} material={material} {...hoverProps}>
      <sphereGeometry args={[region.radius, 48, 32]} />
    </mesh>
  )
}

// One name per nation, under its capital's system when that's claimed,
// otherwise under its first claimed star; a contested system is labelled with
// both claimants. Anchored to the star (a fixed screen offset below its own
// marker label), not to the bubble, so it never lands next to another star.
function NationLabels({ regions, claimsByStar }: { regions: Region[]; claimsByStar: Map<string, SystemClaim> }) {
  const labels = useMemo(() => {
    const out = new Map<string, { text: string; color: string; pos: Vector3; contested: boolean }>()
    for (const region of regions) {
      const claim = claimsByStar.get(region.key)
      if (!claim || claim.kind === 'unclaimed') continue
      if (claim.kind === 'contested') {
        const names = claim.countryIds.map((id) => ownerInfoOf(id)?.name ?? id)
        out.set(`contested:${region.key}`, { text: `Contested: ${names.join(' / ')}`, color: '#ffd27a', pos: region.pos, contested: true })
        continue
      }
      const country = ownerInfoOf(claim.countryId)
      if (!country) continue
      const isCapital = country.capitalStarId === region.key
      if (out.has(claim.countryId) && !isCapital) continue
      out.set(claim.countryId, { text: country.name, color: country.color, pos: region.pos, contested: false })
    }
    return [...out.entries()].map(([id, l]) => ({ id, ...l }))
  }, [regions, claimsByStar])

  return (
    <>
      {labels.map((l) => (
        <group key={l.id} position={[l.pos.x, l.pos.y, l.pos.z]}>
          <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`territory-label${l.contested ? ' contested' : ''}`} style={{ color: l.color, borderColor: l.color }}>
              {l.text}
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}

// `stars`: the neighbourhood being drawn (ours by default).
export function TerritoryDiscs({ claimsByStar, stars = STARS }: { claimsByStar: Map<string, SystemClaim>; stars?: StarData[] }) {
  const regions = useRegions(claimsByStar, stars)
  const showNames = useMapModeStore((s) => s.showNationNames)
  // A hover tip belongs to the current mode; drop it when the mode flips or this unmounts.
  useEffect(() => () => useHoverTipStore.getState().setTip(null), [showNames])
  return (
    <>
      {regions.map((r, i) => (
        <RegionBubble key={r.key} region={r} index={i} regions={regions} showNames={showNames} />
      ))}
      {showNames && <NationLabels regions={regions} claimsByStar={claimsByStar} />}
    </>
  )
}
