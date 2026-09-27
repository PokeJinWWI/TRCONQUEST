import { useEffect, useState } from 'react'
import { DataTexture, LinearFilter, RepeatWrapping, ClampToEdgeWrapping, RGBAFormat, TextureLoader, type Texture, UnsignedByteType } from 'three'
import { topographyOf } from './bodyTopography'

// The real map's picture of a body (public/maps/<body>.png, made by
// scripts/terrain/build.ts): 1024×512 greyscale, equirectangular, north up;
// 0 is water, 3–255 land relief (or brightness where there is no elevation
// map). Loaded only when a view of that body opens, then kept. The globe, flat
// map and orbital hologram shade their ground with it (HoloGlobe GROUND_GLSL):
// coasts at the picture's detail, relief as light and shade. Looks only — the
// game still plays on the map nodes.

export interface BodyPicture {
  texture: Texture | null
  // The picture draws the body's seas (its value 0 is water).
  water: boolean
}

// Bound in place of a picture while none is loaded (a sampler needs a texture).
export const NO_PICTURE = (() => {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType)
  t.needsUpdate = true
  return t
})()

const loaded = new Map<string, Texture>()
const pending = new Map<string, Promise<Texture>>()

function load(path: string): Promise<Texture> {
  const hit = pending.get(path)
  if (hit) return hit
  const p = new TextureLoader().loadAsync(`${import.meta.env.BASE_URL}${path}`).then((t) => {
    t.wrapS = RepeatWrapping // across the date line
    t.wrapT = ClampToEdgeWrapping
    t.minFilter = LinearFilter
    t.magFilter = LinearFilter
    t.generateMipmaps = false
    loaded.set(path, t)
    return t
  })
  pending.set(path, p)
  return p
}

export function useBodyPicture(bodyName: string | undefined): BodyPicture {
  const topo = bodyName ? topographyOf(bodyName) : null
  const path = topo?.picture ?? null
  const [texture, setTexture] = useState<Texture | null>(() => (path ? (loaded.get(path) ?? null) : null))
  useEffect(() => {
    if (!path) {
      setTexture(null)
      return
    }
    let live = true
    const hit = loaded.get(path)
    if (hit) setTexture(hit)
    else load(path).then((t) => live && setTexture(t)).catch(() => live && setTexture(null))
    return () => {
      live = false
    }
  }, [path])
  // Only the ocean worlds' pictures draw water; Titan's seas come from named
  // outlines on the map nodes, so its picture only shades.
  return { texture: path ? texture : null, water: topo?.kind === 'water' }
}

// The uniforms a ground material needs for it, kept current as it loads.
export function pictureUniforms(pic: BodyPicture) {
  return { uPicture: { value: pic.texture ?? NO_PICTURE }, uPictureOn: { value: pic.texture ? 1 : 0 }, uPictureWater: { value: pic.water ? 1 : 0 } }
}
