import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ALL_TECHS,
  TECHS_BY_CATEGORY,
  canResearch,
  prerequisitesMet,
  anomalousUnlocked,
  visibleNodeIds,
  localRoots,
  externalPrerequisites,
  type TechCategory,
  type TechNode,
} from '../data/techData'
// Research points: whole numbers are plenty for a pool.
export function formatResearch(points: number): string {
  return Math.floor(points).toLocaleString()
}

export type TreeChoice = TechCategory | 'all'
export const CATEGORY_LABELS: Record<TechCategory, string> = { physics: 'Physics', society: 'Society', engineering: 'Engineering' }
const TREE_CHOICES: { id: TreeChoice; label: string }[] = [
  { id: 'physics', label: 'Physics' },
  { id: 'society', label: 'Society' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'all', label: 'All' },
]

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
const LANE_GAP = 26
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
    // A node whose prerequisites all sit in another tree starts this one.
    const local = node.prerequisites.map((set) => set.filter((p) => byId.has(p))).filter((set) => set.length > 0)
    if (local.length === 0 || local.length < node.prerequisites.length) {
      depths.set(id, 0)
      return 0
    }
    if (visiting.has(id)) return 0 // guards a malformed cycle rather than recursing forever
    visiting.add(id)
    let best = Infinity
    for (const set of local) {
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
  const roots = localRoots(techs)
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
    // The label sits just above the lane's first row.
    lanes.push({ name: root.name, y })
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
  initialTree,
  researched,
  researchPoints,
  monthly,
  freeResearchMode = false,
  onResearch,
  onClose,
  queue,
  onQueue,
}: {
  // Queued research, in order, and toggling a node in or out of the queue.
  queue: readonly string[]
  onQueue: (nodeId: string) => void
  initialTree: TreeChoice
  researched: ReadonlySet<string>
  researchPoints: Record<TechCategory, number>
  // Research earned per month in each tree (Simple mode), if known.
  monthly?: Record<TechCategory, number> | null
  // Dev console's "zero all tech costs" toggle — see techStore.ts's
  // freeResearchMode.
  freeResearchMode?: boolean
  onResearch: (nodeId: string) => void
  onClose: () => void
}) {
  const [tree, setTree] = useState<TreeChoice>(initialTree)
  const techs = tree === 'all' ? ALL_TECHS : TECHS_BY_CATEGORY[tree]
  const visible = useMemo(() => new Set([...visibleNodeIds(techs, researched), ...localRoots(techs).map((n) => n.id)]), [techs, researched])
  const layout = useMemo(() => computeLayout(techs, visible), [techs, visible])
  const positionById = useMemo(() => new Map(layout.nodes.map((n) => [n.node.id, n])), [layout])
  const pools: TechCategory[] = tree === 'all' ? ['physics', 'society', 'engineering'] : [tree]
  const title = tree === 'all' ? 'All research' : CATEGORY_LABELS[tree]

  const overlay = (
    <div className="tech-tree-overlay" role="dialog" aria-label={`${title} tech tree`}>
      <div className="tech-tree-header">
        <span className="tech-tree-title">{title} — Tree View</span>
        <div className="tech-tree-switch">
          {TREE_CHOICES.map((c) => (
            <button key={c.id} type="button" className={`nav-subtab${tree === c.id ? ' active' : ''}`} onClick={() => setTree(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <span className="tech-tree-points">
          {pools.map((p) => (
            <span key={p} className={`tech-pool tech-cat-${p}`}>
              {tree === 'all' ? `${CATEGORY_LABELS[p]} ` : ''}
              {formatResearch(researchPoints[p])} pts{monthly ? ` (+${monthly[p].toFixed(1)}/mo)` : ''}
            </span>
          ))}
        </span>
        <button type="button" className="tech-tree-close" onClick={onClose} aria-label="Close tree view">
          ×
        </button>
      </div>
      <div className="tech-tree-scroll">
        {techs.length === 0 ? (
          <div className="nav-placeholder">No research in this tree yet.</div>
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
              <text key={i} className="tech-tree-lane-label" x={PADDING} y={Math.max(10, lane.y - 5)}>
                {lane.name}
              </text>
            ))}
            {layout.nodes.map(({ node, x, y }) => {
              const isResearched = researched.has(node.id)
              const eligible = canResearch(node, researched, researchPoints[node.category], freeResearchMode)
              const previewOnly = !isResearched && (!prerequisitesMet(node, researched) || (node.locked === true && !anomalousUnlocked(researched)))
              const stateClass = isResearched ? 'researched' : previewOnly ? 'preview' : eligible ? 'eligible' : 'unaffordable'
              const external = externalPrerequisites(node, techs)
              const needs = external.length > 0 ? `Needs ${external.map((t) => `${t.name} (${CATEGORY_LABELS[t.category]})`).join(', ')}. ` : ''
              const queuePos = queue.indexOf(node.id)
              const status = isResearched
                ? 'Researched'
                : queuePos >= 0
                  ? `Queued #${queuePos + 1}`
                  : previewOnly
                    ? (external.length > 0 ? `needs ${external[0].name}` : '—')
                    : `${freeResearchMode ? 0 : node.cost} ${tree === 'all' ? CATEGORY_LABELS[node.category] : 'pts'}`
              return (
                <g
                  key={node.id}
                  transform={`translate(${x}, ${y})`}
                  className={`tech-tree-node ${stateClass}${queuePos >= 0 ? ' queued' : ''} tech-cat-${node.category}`}
                  onClick={() => {
                    if (isResearched) return
                    if (eligible) onResearch(node.id)
                    else onQueue(node.id)
                  }}
                  data-tooltip={`${CATEGORY_LABELS[node.category]}. ${needs}${node.description}${isResearched ? '' : eligible ? ' Click to research.' : queuePos >= 0 ? ' Queued: click to take it out of the queue.' : ' Click to queue it (and what it still needs).'}`}
                >
                  <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={4} />
                  <line x1={2} y1={3} x2={2} y2={NODE_HEIGHT - 3} className="tech-cat-bar" />
                  <text x={8} y={17} className="tech-tree-node-name">
                    {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
                    {node.locked && !isResearched ? ' 🔒' : ''}
                  </text>
                  <text x={8} y={33} className="tech-tree-node-status">
                    {status.length > 26 ? `${status.slice(0, 25)}…` : status}
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
