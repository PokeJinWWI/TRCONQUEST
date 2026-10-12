// What is under the pointer on the ground map, for the build lens: the district (site) whose footprint covers the node, else the
// one whose zone does, else a site standing exactly there; nothing means open ground (rural). Pure over the data it is given.
export interface LensSiteCells {
  siteId: string
  // Cells the district covers now.
  footprint: readonly number[]
  // Cells it may grow into.
  zone: readonly number[]
  node: number | null
}

export type LensTargetKind = 'footprint' | 'zone' | 'node'
export interface LensTarget {
  siteId: string
  via: LensTargetKind
}

export function resolveTarget(sites: readonly LensSiteCells[], node: number): LensTarget | null {
  for (const s of sites) if (s.footprint.includes(node)) return { siteId: s.siteId, via: 'footprint' }
  for (const s of sites) if (s.node === node) return { siteId: s.siteId, via: 'node' }
  for (const s of sites) if (s.zone.includes(node)) return { siteId: s.siteId, via: 'zone' }
  return null
}
