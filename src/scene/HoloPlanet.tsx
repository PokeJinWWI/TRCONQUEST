import { useEffect, useMemo } from 'react'
import { Color, ShaderMaterial, Vector2 } from 'three'
import { useTerritoryStore } from '../state/territoryStore'
import { groundSurface } from './groundLogic'
import { buildGeometry, GROUND_GLSL, TEX_WIDTH, useNodeTexture, VERT as GLOBE_VERT, type HoloNode } from './HoloGlobe'
import { TERRAIN_IDS, type BodySurface } from './planetTerrain'

// A planet or moon as a hologram sphere, in the same language as the planetary
// map (HoloGlobe) but with no terrain: a dark glassy body that brightens toward
// its rim, a fine latitude/longitude graticule (the equator and prime meridian
// heavier), a faint scanline hatch and a rim glow — all in the world's own
// colour (Mars rust, Venus blue), lifted a little so it glows.
const LIFT = 0.18

// The shaders write colours straight to the screen, so this is sRGB-encoded
// (not three's linear working values).
export function hologramTint(color: string): Color {
  return new Color(color).lerp(new Color('#ffffff'), LIFT).convertLinearToSRGB()
}

const VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;
void main() {
  vPos = position;
  vNormal = normalMatrix * normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vPos;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float rim = 1.0 - ndv;

  // Glassy body: near-black at the middle, glowing toward the limb.
  vec3 col = vec3(0.004, 0.012, 0.02) + uColor * (0.13 + 0.36 * pow(rim, 1.7));

  // Graticule every 15 degrees; lines thin out toward the poles.
  vec3 p = normalize(vPos);
  vec2 deg = vec2(atan(-p.z, p.x), asin(clamp(p.y, -1.0, 1.0))) * 57.29578;
  vec2 g = deg / 15.0;
  vec2 fw = fwidth(g);
  vec2 d = abs(fract(g + 0.5) - 0.5);
  vec2 line = 1.0 - smoothstep(vec2(0.0), fw * 1.25, d);
  float poleFade = 1.0 - smoothstep(0.78, 0.98, abs(p.y));
  float lines = max(line.x * poleFade, line.y);
  vec2 axis = 1.0 - smoothstep(vec2(0.0), fw * 1.7, abs(deg / 15.0));
  float heavy = max(axis.x * poleFade, axis.y);
  vec3 lineCol = mix(uColor, vec3(1.0), 0.25);
  col += lineCol * lines * 0.55 + lineCol * heavy * 0.35;

  // Scanline hatch and rim glow.
  col *= 0.94 + 0.06 * sin(p.y * 900.0);
  col += pow(rim, 3.0) * uColor * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
`

// --- With terrain -----------------------------------------------------------
//
// The same sphere, but with the world's land lit up on dark water like the
// planetary map: every body with a surface shows its continents (Earth its real
// ones), in the world's own colour — brighter for ice and peaks, darker for
// forest. Read from the same generated surface as the ground map.
const TERRAIN_LIGHT: Record<string, number> = {
  plains: 1,
  forest: 0.72,
  desert: 1.08,
  tundra: 1.18,
  mountains: 1.12,
  urban: 1.35,
  rock: 0.88,
  cloud: 0.8,
  aerostat: 1.12,
}

// A terrain's colour on a world of this colour (sRGB 0-255), the colour first
// lifted toward white so the land glows.
function landColor(terrain: string, base: Color): [number, number, number] {
  if (terrain === 'lava') return [255, 107, 61]
  const k = TERRAIN_LIGHT[terrain] ?? 1
  const c = base.clone()
  if (terrain === 'tundra' || terrain === 'mountains') c.lerp(new Color(1, 1, 1), 0.22)
  return [Math.min(255, Math.round(c.r * 255 * k)), Math.min(255, Math.round(c.g * 255 * k)), Math.min(255, Math.round(c.b * 255 * k))]
}

const TERRAIN_FRAG = /* glsl */ `
${GROUND_GLSL}
uniform vec3 uColor;
uniform float uRadius;
varying vec3 vIds;
varying vec3 vBary;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vView;

void main() {
  vec4 a = node(floor(vIds.x + 0.5));
  vec4 b = node(floor(vIds.y + 0.5));
  vec4 c = node(floor(vIds.z + 0.5));
  vec3 p = normalize(vPos);
  vec3 col = groundColor(vBary, a, b, c, p * 5.0, p.y * 240.0, 0.0);

  // A fine graticule over it.
  vec2 deg = vec2(atan(-p.z, p.x), asin(clamp(p.y, -1.0, 1.0))) * 57.29578;
  vec2 g = deg / 15.0;
  vec2 fw = fwidth(g);
  vec2 d = abs(fract(g + 0.5) - 0.5);
  vec2 line = 1.0 - smoothstep(vec2(0.0), fw * 1.25, d);
  float poleFade = 1.0 - smoothstep(0.78, 0.98, abs(p.y));
  col += mix(uColor, vec3(1.0), 0.3) * max(line.x * poleFade, line.y) * 0.22;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float rim = 1.0 - ndv;
  // Brightest facing us, easing toward the limb, then the rim glow on top.
  col *= 0.62 + 0.38 * pow(ndv, 0.7);
  col += pow(rim, 3.0) * uColor * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
`

function TerrainPlanet({ surface, color, radius }: { surface: BodySurface; color: string; radius: number }) {
  const tint = useMemo(() => hologramTint(color), [color])
  const base = useMemo(() => new Color(color).lerp(new Color('#ffffff'), 0.06).convertLinearToSRGB(), [color])
  const nodeAt = useMemo(() => {
    const cache = new Map<string, [number, number, number]>()
    return (i: number): HoloNode => {
      const id = TERRAIN_IDS[surface.terrain[i]]
      let rgb = cache.get(id)
      if (!rgb) {
        rgb = landColor(id, base)
        cache.set(id, rgb)
      }
      // Ocean (and lava) is drawn as water/land by the shader from the land value.
      return { r: rgb[0], g: rgb[1], b: rgb[2], land: id !== 'ocean', landValue: surface.landValue?.[i] }
    }
  }, [surface, base])
  const { texture, rows } = useNodeTexture(nodeAt, nodeAt)
  const geometry = useMemo(() => buildGeometry(radius), [radius])
  const ocean = useMemo(() => [tint.r * 0.1 + 0.004, tint.g * 0.1 + 0.014, tint.b * 0.1 + 0.022], [tint])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: GLOBE_VERT,
        fragmentShader: TERRAIN_FRAG,
        uniforms: {
          uNodes: { value: texture },
          uTexSize: { value: new Vector2(TEX_WIDTH, rows) },
          uOcean: { value: ocean },
          uCoast: { value: [tint.r, tint.g, tint.b] },
          uLift: { value: [0.02, 0.02, 0.02] },
          uColor: { value: tint },
          uRadius: { value: radius },
        },
      }),
    [texture, rows, ocean, tint, radius],
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

export function HoloPlanet({ color, radius, bodyName }: { color: string; radius: number; bodyName?: string }) {
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const surface = useMemo(() => (bodyName ? groundSurface(bodyName, owners) : null), [bodyName, owners])
  if (surface) return <TerrainPlanet surface={surface} color={color} radius={radius} />
  return <PlainPlanet color={color} radius={radius} />
}

function PlainPlanet({ color, radius }: { color: string; radius: number }) {
  const tint = useMemo(() => hologramTint(color), [color])
  const material = useMemo(() => new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uColor: { value: tint } } }), [tint])
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh material={material}>
      <sphereGeometry args={[radius, 64, 48]} />
    </mesh>
  )
}
