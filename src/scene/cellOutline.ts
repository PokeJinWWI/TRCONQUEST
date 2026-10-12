// The fill and the outline of a set of ground cells, pure. A cell of the fine grid is the patch of ground around its node: inside each
// triangle of the mesh the cell of a corner is the quad between the corner, the midpoints of its two edges and the triangle's centre.
// So a set of cells is drawn exactly (no seams, no stray points) as those quads, and its border is the segments between the centre and
// the midpoint of every edge that joins a cell in the set to one outside it. Coordinates are on the unit sphere; the caller lifts and
// projects them (globe or flat map).
import { surfaceMesh } from './surfaceMesh'

export interface CellShape {
  // Triangles, 9 numbers each (three xyz points).
  tris: number[]
  // Border segments, 6 numbers each (two xyz points).
  lines: number[]
}

export type FaceFilter = (a: number, b: number, c: number) => boolean

export function cellShape(cells: ReadonlySet<number>, skipFace?: FaceFilter): CellShape {
  const mesh = surfaceMesh()
  const pos = mesh.positions
  const faces = mesh.faces
  const tris: number[] = []
  const lines: number[] = []
  const P = (i: number): [number, number, number] => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
  const mid = (p: number[], q: number[]): [number, number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f]
    const b = faces[f + 1]
    const c = faces[f + 2]
    const ia = cells.has(a)
    const ib = cells.has(b)
    const ic = cells.has(c)
    if (!ia && !ib && !ic) continue
    if (skipFace?.(a, b, c)) continue
    const pa = P(a)
    const pb = P(b)
    const pc = P(c)
    const g: [number, number, number] = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3]
    const mab = mid(pa, pb)
    const mbc = mid(pb, pc)
    const mca = mid(pc, pa)
    // The cell's quad in this triangle: corner, the two edge midpoints beside it, the centre.
    if (ia) tris.push(...pa, ...mab, ...g, ...pa, ...g, ...mca)
    if (ib) tris.push(...pb, ...mbc, ...g, ...pb, ...g, ...mab)
    if (ic) tris.push(...pc, ...mca, ...g, ...pc, ...g, ...mbc)
    if (ia !== ib) lines.push(...mab, ...g)
    if (ib !== ic) lines.push(...mbc, ...g)
    if (ic !== ia) lines.push(...mca, ...g)
  }
  return { tris, lines }
}
