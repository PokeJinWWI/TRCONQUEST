import { useEffect, useMemo } from 'react'
import { AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, DataTexture, NearestFilter, RGBAFormat, ShaderMaterial, UnsignedByteType, Vector2 } from 'three'
import { surfaceMesh } from './surfaceMesh'

// The planetary map's globe, drawn as a hologram rather than a smooth blend of
// vertex colours (which blurred every biome into its neighbours). Each node's
// colour goes in a small texture, and the fragment shader reads the three
// nodes of the triangle it is in:
//   - land or water is a contour through the nodes' land values, so coastlines
//     are crisp lines (and roughened with a little noise so they read as
//     coasts, not polygon edges);
//   - within the land, each pixel takes the colour of its nearest land node,
//     so terrain and front-line tints come out as sharp cells;
//   - a scanline hatch, a glowing coast line and a rim glow finish the look.
// Rendering only — the simulation still reads the same node terrain.

export const TEX_WIDTH = 64

export const VERT = /* glsl */ `
attribute vec3 aIds;
attribute vec3 aBary;
varying vec3 vIds;
varying vec3 vBary;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vIds = aIds;
  vBary = aBary;
  vPos = position;
  vNormal = normalMatrix * normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

// The node texture and the ground shading, shared by the globe and the flat map.
export const GROUND_GLSL = /* glsl */ `
uniform sampler2D uNodes;
uniform vec2 uTexSize;
uniform vec3 uOcean;
uniform vec3 uCoast;
uniform vec3 uLift;

vec4 node(float id) {
  float row = floor((id + 0.5) / uTexSize.x);
  float col = id - row * uTexSize.x;
  return texture2D(uNodes, (vec2(col, row) + 0.5) / uTexSize);
}
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// A pixel of the map: w are its weights in the triangle whose corners are the
// nodes a, b, c; pos is its place on the globe (the sphere the map is drawn
// on, radius 5), only used to seed the coast noise.
vec3 groundColor(vec3 w, vec4 a, vec4 b, vec4 c, vec3 pos, float hatchCoord, float aaMin) {
  // Land/water contour, its edge roughened a little.
  float land = w.x * a.a + w.y * b.a + w.z * c.a;
  float n = vnoise(pos * 34.0) * 0.6 + vnoise(pos * 85.0) * 0.4;
  land += (n - 0.5) * 0.26;
  float aa = max(fwidth(land) * 0.8, aaMin) + 1e-4;
  float m = smoothstep(0.5 - aa, 0.5 + aa, land);
  float coast = 1.0 - smoothstep(0.0, aa * 2.4, abs(land - 0.5));

  // Nearest land node's colour: crisp cells.
  float sa = step(0.5, a.a) + w.x;
  float sb = step(0.5, b.a) + w.y;
  float sc = step(0.5, c.a) + w.z;
  vec3 ground = sa >= sb && sa >= sc ? a.rgb : (sb >= sc ? b.rgb : c.rgb);

  float hatch = 0.93 + 0.07 * sin(hatchCoord);
  vec3 col = mix(uOcean, ground * hatch * 1.12 + uLift, m);
  return col + coast * uCoast * 0.55;
}
`

const FRAG = /* glsl */ `
${GROUND_GLSL}
varying vec3 vIds;
varying vec3 vBary;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vView;
uniform vec3 uRim;

void main() {
  vec4 a = node(floor(vIds.x + 0.5));
  vec4 b = node(floor(vIds.y + 0.5));
  vec4 c = node(floor(vIds.z + 0.5));
  vec3 col = groundColor(vBary, a, b, c, vPos, vPos.y * 240.0, 0.0);

  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  col *= 0.72 + 0.28 * ndv;
  col += pow(1.0 - ndv, 3.0) * uRim * 0.85;
  gl_FragColor = vec4(col, 1.0);
}
`

const HALO_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vNormal = normalMatrix * normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

// A shell behind the globe: brightest where it meets the globe's edge, fading
// to nothing at its own rim — the glow around a hologram.
const HALO_FRAG = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
uniform float uCore;
uniform vec3 uGlow;
void main() {
  float d = abs(dot(normalize(vNormal), normalize(vView)));
  float i = pow(clamp(d / uCore, 0.0, 1.0), 1.6);
  gl_FragColor = vec4(uGlow * i * 0.55, 1.0);
}
`

// Flat, one-triangle-at-a-time copy of the fine mesh: each triangle carries its
// three node ids and a barycentric coordinate per corner.
export function buildGeometry(radius: number): BufferGeometry {
  const mesh = surfaceMesh()
  const tris = mesh.faces.length / 3
  const pos = new Float32Array(tris * 9)
  const ids = new Float32Array(tris * 9)
  const bary = new Float32Array(tris * 9)
  for (let t = 0; t < tris; t++) {
    const corner = [mesh.faces[t * 3], mesh.faces[t * 3 + 1], mesh.faces[t * 3 + 2]]
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3
      for (let d = 0; d < 3; d++) {
        pos[o + d] = mesh.positions[corner[k] * 3 + d] * radius
        ids[o + d] = corner[d]
      }
      bary[o + k] = 1
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aIds', new BufferAttribute(ids, 3))
  g.setAttribute('aBary', new BufferAttribute(bary, 3))
  return g
}

export interface HoloNode {
  r: number
  g: number
  b: number
  land: boolean
  // How much of the node's cell is land (0-1), when the coast is known better
  // than one node: the map's coast runs along the half-way contour of these.
  landValue?: number
}

// The per-node colour texture the shaders read. `nodeAt(i)` gives node i's
// display colour (0-255, sRGB) and whether it is land; it is called for every
// node whenever `version` changes.
export function useNodeTexture(nodeAt: (node: number) => HoloNode, version: unknown) {
  const mesh = surfaceMesh()
  const rows = Math.ceil(mesh.count.fine / TEX_WIDTH)
  const texture = useMemo(() => {
    const tex = new DataTexture(new Uint8Array(TEX_WIDTH * rows * 4), TEX_WIDTH, rows, RGBAFormat, UnsignedByteType)
    tex.minFilter = NearestFilter
    tex.magFilter = NearestFilter
    tex.generateMipmaps = false
    return tex
  }, [rows])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => {
    const data = texture.image.data as Uint8Array
    for (let i = 0; i < mesh.count.fine; i++) {
      const n = nodeAt(i)
      data[i * 4] = n.r
      data[i * 4 + 1] = n.g
      data[i * 4 + 2] = n.b
      data[i * 4 + 3] = Math.round((n.landValue ?? (n.land ? 1 : 0)) * 255)
    }
    texture.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, texture, mesh])
  return { texture, rows }
}

export const OCEAN_UNIFORM = [0.012, 0.078, 0.114]
// The map's own coast glow and land lift (teal); worlds seen from orbit pass their own.
export const COAST_UNIFORM = [0.35, 0.95, 1.0]
export const TEAL_GLOW: [number, number, number] = [0.1, 0.75, 0.95]
export const LIFT_UNIFORM = [0.0, 0.05, 0.06]

// The globe.
export function HoloGlobe({ radius, nodeAt, version, glow = TEAL_GLOW }: { radius: number; nodeAt: (node: number) => HoloNode; version: unknown; glow?: [number, number, number] }) {
  const { texture, rows } = useNodeTexture(nodeAt, version)
  const geometry = useMemo(() => buildGeometry(radius), [radius])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uNodes: { value: texture }, uTexSize: { value: new Vector2(TEX_WIDTH, rows) }, uOcean: { value: OCEAN_UNIFORM }, uCoast: { value: glow }, uLift: { value: LIFT_UNIFORM }, uRim: { value: glow } },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture, rows, glow.join()],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <mesh geometry={geometry} material={material} />
}

// The soft glow around the globe (not pickable).
export function HoloHalo({ radius, glow = [0.1, 0.75, 0.95] }: { radius: number; glow?: [number, number, number] }) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: { uCore: { value: 0.46 }, uGlow: { value: glow } },
        side: BackSide,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [glow.join()],
  )
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh raycast={() => null} material={material}>
      <sphereGeometry args={[radius * 1.12, 48, 32]} />
    </mesh>
  )
}
