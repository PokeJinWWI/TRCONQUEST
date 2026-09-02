import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { canResearch, prerequisitesMet, anomalousUnlocked, visibleNodeIds, type TechNode } from '../data/techData'

// A real node-link diagram — the thing a flat list genuinely can't show: a
// node converging from two different branches (Exotic Matter Theory,
// reachable via either Quantum or Atomic; Hyperium Synthesis, needing BOTH
// Hyperspace Theory and Exotic Matter Theory together) reads as two lines
// meeting at one box here, where the list view can only place it once and
// hope the description conveys the rest.
//
// Rendered via a portal straight to document.body — triggered from inside a
// DraggableWindow, whose own root has a CSS `transform` (see that
// component), which creates a new containing block for `position: fixed`
// descendants. Without the portal this overlay would be positioned relative
// to that small window instead of the viewport.

const COL_WIDTH = 210
const ROW_HEIGHT = 64
const NODE_WIDTH = 168
const NODE_HEIGHT = 44
const LANE_GAP = 22
const PADDING = 28

interface NodeLayout {
  node: TechNode
  x: number
  y: number
}

interface GraphLayout {
  nodes: NodeLayout[]
  edges: { from: string; to: string; convergent: boolean }[]
  lanes: { name: string; y: number }[]
  width: number
  height: number
}

// Longest-path-from-a-root depth, used purely to pick which column a node
// draws in — not a gameplay concept, just a layout one. For a node with
// multiple prerequisite SETS (an OR of alternatives), its depth follows
// whichever alternative becomes ready soonest (the MIN across sets of the
// MAX depth within each set, since a set's readiness is gated by its
// slowest member).
function computeDepths(techs: TechNode[]): Map<string, number> {
  const depths = new Map<string, number>()
  const byId = new Map(techs.map((n) => [n.id, n]))
  const visiting = new Set<string>()

  function depthOf(id: string): number {
    if (depths.has(id)) return depths.get(id)!
    const node = byId.get(id)
    if (!node) return 0
    if (node.prerequisites.length === 0) {
      depths.set(id, 0)
      return 0
    }
    if (visiting.has(id)) return 0 // guards a malformed cycle rather than recursing forever
    visiting.add(id)
    let best = Infinity
    for (const set of node.prerequisites) {
      const setDepth = Math.max(0, ...set.map((parentId) => depthOf(parentId)))
      best = Math.min(best, setDepth)
    }
    visiting.delete(id)
    const depth = best + 1
    depths.set(id, depth)
    return depth
  }

  for (const n of techs) depthOf(n.id)
  return depths
}

// Every node reachable from `root` by following child links — same BFS
// TechPanel.tsx's own branchNodes uses, duplicated locally so this module
// doesn't need a cross-component import for one small helper.
function branchNodes(root: TechNode, techs: TechNode[]): TechNode[] {
  const result: TechNode[] = [root]
  const seen = new Set([root.id])
  const queue = [root.id]
  while (queue.length > 0) {
    const parentId = queue.shift()!
    for (const node of techs) {
      if (seen.has(node.id)) continue
      if (node.prerequisites.some((set) => set.includes(parentId))) {
        seen.add(node.id)
        result.push(node)
        queue.push(node.id)
      }
    }
  }
  return result
}

function computeLayout(techs: TechNode[], visible: ReadonlySet<string>): GraphLayout {
  const depths = computeDepths(techs)
  const roots = techs.filter((n) => n.prerequisites.length === 0)
  const visibleNodes = techs.filter((n) => visible.has(n.id))

  // Which lane (root-branch column-group) each node belongs to — the first
  // root whose branch reaches it, in root order. A convergent node ends up
  // in whichever branch is listed first; its OTHER incoming edge still
  // draws correctly regardless of which lane it visually sits in.
  const laneOf = new Map<string, number>()
  roots.forEach((root, i) => {
    for (const n of branchNodes(root, techs)) if (!laneOf.has(n.id)) laneOf.set(n.id, i)
  })

  const cells = new Map<string, TechNode[]>()
  for (const n of visibleNodes) {
    const key = `${laneOf.get(n.id) ?? 0}:${depths.get(n.id) ?? 0}`
    const arr = cells.get(key) ?? []
    arr.push(n)
    cells.set(key, arr)
  }

  const laneMaxStack = new Map<number, number>()
  for (const [key, arr] of cells) {
    const lane = Number(key.split(':')[0])
    laneMaxStack.set(lane, Math.max(laneMaxStack.get(lane) ?? 1, arr.length))
  }

  const laneYOffset = new Map<number, number>()
  const lanes: { name: string; y: number }[] = []
  let y = PADDING
  roots.forEach((root, i) => {
    if (![...laneOf.values()].includes(i)) return // a lane with nothing visible in it yet takes no space
    laneYOffset.set(i, y)
    lanes.push({ name: root.name, y: y + ((laneMaxStack.get(i) ?? 1) * ROW_HEIGHT) / 2 - ROW_HEIGHT / 2 })
    y += (laneMaxStack.get(i) ?? 1) * ROW_HEIGHT + LANE_GAP
  })

  const nodes: NodeLayout[] = []
  const positionOf = new Map<string, { x: number; y: number }>()
  for (const [key, arr] of cells) {
    const [laneStr, depthStr] = key.split(':')
    const lane = Number(laneStr)
    const depth = Number(depthStr)
    const baseY = laneYOffset.get(lane) ?? PADDING
    arr.forEach((n, idx) => {
      const pos = { x: PADDING + depth * COL_WIDTH, y: baseY + idx * ROW_HEIGHT }
      positionOf.set(n.id, pos)
      nodes.push({ node: n, ...pos })
    })
  }

  const edges: GraphLayout['edges'] = []
  for (const n of visibleNodes) {
    for (const set of n.prerequisites) {
      for (const parentId of set) {
        if (visible.has(parentId)) edges.push({ from: parentId, to: n.id, convergent: n.prerequisites.length > 1 || set.length > 1 })
      }
    }
  }

  const maxDepth = Math.max(0, ...nodes.map((n) => depths.get(n.node.id) ?? 0))
  return {
    nodes,
    edges,
    lanes,
    width: PADDING * 2 + NODE_WIDTH + maxDepth * COL_WIDTH,
    height: Math.max(y - LANE_GAP + PADDING, 200),
  }
}

export function TechTreeGraph({
  categoryLabel,
  techs,
  researched,
  researchPoints,
  freeResearchMode = false,
  onResearch,
  onClose,
}: {
  categoryLabel: string
  techs: TechNode[]
  researched: ReadonlySet<string>
  researchPoints: number
  // Dev console's "zero all tech costs" toggle — see techStore.ts's
  // freeResearchMode. Optional/defaulted so this component's other caller
  // (if one is ever added) isn't forced to know it exists.
  freeResearchMode?: boolean
  onResearch: (nodeId: string) => void
  onClose: () => void
}) {
  const visible = useMemo(() => visibleNodeIds(techs, researched), [techs, researched])
  const layout = useMemo(() => computeLayout(techs, visible), [techs, visible])
  const positionById = useMemo(() => new Map(layout.nodes.map((n) => [n.node.id, n])), [layout])

  const overlay = (
    <div className="tech-tree-overlay" role="dialog" aria-label={`${categoryLabel} tech tree`}>
      <div className="tech-tree-header">
        <span className="tech-tree-title">{categoryLabel} — Tree View</span>
        <span className="tech-tree-points">{researchPoints} pts</span>
        <button type="button" className="tech-tree-close" onClick={onClose} aria-label="Close tree view">
          ×
        </button>
      </div>
      <div className="tech-tree-scroll">
        {techs.length === 0 ? (
          <div className="nav-placeholder">No research tree here yet.</div>
        ) : (
          <svg width={layout.width} height={layout.height} className="tech-tree-svg">
            {layout.edges.map((edge, i) => {
              const from = positionById.get(edge.from)
              const to = positionById.get(edge.to)
              if (!from || !to) return null
              const x1 = from.x + NODE_WIDTH
              const y1 = from.y + NODE_HEIGHT / 2
              const x2 = to.x
              const y2 = to.y + NODE_HEIGHT / 2
              const midX = (x1 + x2) / 2
              return (
                <path
                  key={i}
                  className={`tech-tree-edge${edge.convergent ? ' convergent' : ''}`}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                />
              )
            })}
            {layout.lanes.map((lane, i) => (
              <text key={i} className="tech-tree-lane-label" x={PADDING} y={Math.max(10, lane.y - ROW_HEIGHT / 2 - 6)}>
                {lane.name}
              </text>
            ))}
            {layout.nodes.map(({ node, x, y }) => {
              const isResearched = researched.has(node.id)
              const eligible = canResearch(node, researched, researchPoints, freeResearchMode)
              const previewOnly = !isResearched && (!prerequisitesMet(node, researched) || (node.locked === true && !anomalousUnlocked(researched)))
              const stateClass = isResearched ? 'researched' : previewOnly ? 'preview' : eligible ? 'eligible' : 'unaffordable'
              return (
                <g
                  key={node.id}
                  transform={`translate(${x}, ${y})`}
                  className={`tech-tree-node ${stateClass}`}
                  onClick={() => !previewOnly && !isResearched && onResearch(node.id)}
                >
                  <title>{node.description}</title>
                  <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={4} />
                  <text x={8} y={17} className="tech-tree-node-name">
                    {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
                    {node.locked && !isResearched ? ' 🔒' : ''}
                  </text>
                  <text x={8} y={33} className="tech-tree-node-status">
                    {isResearched ? 'Researched' : previewOnly ? '—' : `${freeResearchMode ? 0 : node.cost} pts`}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
