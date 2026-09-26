import { useEffect, useMemo } from 'react'
import { Line } from '@react-three/drei'
import { DataTexture, FloatType, NearestFilter, RGBAFormat, ShaderMaterial, UnsignedByteType, Vector2 } from 'three'
import { FLAT_HEIGHT, FLAT_WIDTH } from './mapProjection'
import { flatLookup, TRI_TEX_WIDTH } from './flatLookup'
import { COAST_UNIFORM, GROUND_GLSL, LIFT_UNIFORM, OCEAN_UNIFORM, TEX_WIDTH, useNodeTexture, type HoloNode } from './HoloGlobe'

// The rectangular (equirectangular) planetary map: the same hologram shading
// as the globe (HoloGlobe), drawn on a flat plane. Every pixel finds its
// triangle of the surface mesh in a lookup baked once (flatLookup.ts), so the
// terrain, coasts and front-line tints are exactly the globe's, just unrolled.
// A 15° graticule (brighter equator) marks the coordinates.

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
${GROUND_GLSL}
uniform sampler2D uLookup;
uniform sampler2D uTris;
uniform vec2 uTriSize;
varying vec2 vUv;

void main() {
  vec4 L = texture2D(uLookup, vUv);
  float t = floor(L.r * 255.0 + 0.5) * 256.0 + floor(L.g * 255.0 + 0.5);
  float row = floor((t + 0.5) / uTriSize.x);
  float tcol = t - row * uTriSize.x;
  vec4 ids = texture2D(uTris, (vec2(tcol, row) + 0.5) / uTriSize);
  vec3 w = vec3(L.b, L.a, max(0.0, 1.0 - L.b - L.a));
  vec4 a = node(floor(ids.x + 0.5));
  vec4 b = node(floor(ids.y + 0.5));
  vec4 c = node(floor(ids.z + 0.5));

  float lon = (vUv.x - 0.5) * 6.2831853;
  float lat = (vUv.y - 0.5) * 3.1415926;
  vec3 pos = 5.0 * vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
  vec3 col = groundColor(w, a, b, c, pos, lat * 320.0, 0.045);

  // Graticule every 15 degrees, the equator and prime meridian a little brighter.
  vec2 deg = vec2(lon, lat) * 57.29578;
  vec2 fw = fwidth(deg);
  vec2 dist = abs(fract(deg / 15.0 + 0.5) - 0.5) * 15.0;
  vec2 line = 1.0 - smoothstep(vec2(0.0), fw * 1.3, dist);
  col += max(line.x, line.y) * vec3(0.06, 0.32, 0.42) * 0.55;
  vec2 axis = 1.0 - smoothstep(vec2(0.0), fw * 1.6, abs(deg));
  col += max(axis.x, axis.y) * vec3(0.1, 0.5, 0.6) * 0.45;
  gl_FragColor = vec4(col, 1.0);
}
`

export function FlatMapSurface({ nodeAt, version, glow = COAST_UNIFORM }: { nodeAt: (node: number) => HoloNode; version: unknown; glow?: number[] }) {
  const { texture, rows } = useNodeTexture(nodeAt, version)
  const lookup = useMemo(() => {
    const lk = flatLookup()
    const pixels = new DataTexture(lk.pixels, lk.width, lk.height, RGBAFormat, UnsignedByteType)
    pixels.minFilter = NearestFilter
    pixels.magFilter = NearestFilter
    pixels.generateMipmaps = false
    pixels.needsUpdate = true
    const tris = new DataTexture(lk.triangles, TRI_TEX_WIDTH, lk.triRows, RGBAFormat, FloatType)
    tris.minFilter = NearestFilter
    tris.magFilter = NearestFilter
    tris.generateMipmaps = false
    tris.needsUpdate = true
    return { pixels, tris, triRows: lk.triRows }
  }, [])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uNodes: { value: texture },
          uTexSize: { value: new Vector2(TEX_WIDTH, rows) },
          uOcean: { value: OCEAN_UNIFORM },
          uCoast: { value: glow },
          uLift: { value: LIFT_UNIFORM },
          uLookup: { value: lookup.pixels },
          uTris: { value: lookup.tris },
          uTriSize: { value: new Vector2(TRI_TEX_WIDTH, lookup.triRows) },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture, rows, lookup, glow.join()],
  )
  useEffect(
    () => () => {
      material.dispose()
      lookup.pixels.dispose()
      lookup.tris.dispose()
    },
    [material, lookup],
  )
  const w = FLAT_WIDTH / 2
  const h = FLAT_HEIGHT / 2
  return (
    <>
      <mesh material={material}>
        <planeGeometry args={[FLAT_WIDTH, FLAT_HEIGHT]} />
      </mesh>
      <Line
        points={[
          [-w, -h, 0.02],
          [w, -h, 0.02],
          [w, h, 0.02],
          [-w, h, 0.02],
          [-w, -h, 0.02],
        ]}
        color="#6fe3ff"
        lineWidth={1.5}
        transparent
        opacity={0.7}
      />
    </>
  )
}
