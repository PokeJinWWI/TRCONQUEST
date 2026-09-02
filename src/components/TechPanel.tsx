import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { usePlayerTech } from '../hooks/usePlayerTech'
import { useTechStore } from '../state/techStore'
import { useViewStore } from '../state/viewStore'
import { TechTreeGraph } from './TechTreeGraph'
import {
  PHYSICS_TECHS,
  SOCIETY_TECHS,
  ENGINEERING_TECHS,
  canResearch,
  visibleNodeIds,
  prerequisitesMet,
  anomalousUnlocked,
  type TechCategory,
  type TechNode,
} from '../data/techData'

const CATEGORY_TECHS: Record<TechCategory, TechNode[]> = {
  physics: PHYSICS_TECHS,
  society: SOCIETY_TECHS,
  engineering: ENGINEERING_TECHS,
}

const CATEGORY_LABELS: Record<TechCategory, string> = {
  physics: 'Physics',
  society: 'Society',
  engineering: 'Engineering',
}

function subcategoryToCategory(subcategory: string | null): TechCategory {
  if (subcategory === 'Society') return 'society'
  if (subcategory === 'Engineering') return 'engineering'
  return 'physics'
}

// Every node reachable from `root` by following child links — used purely to
// group the flat TechNode list into columns for display. A convergent node
// (see exotic-matter-theory, reachable from either Quantum or Atomic) shows
// up under both roots it's actually reachable from, which is an honest
// reflection of the tree, not a display bug.
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

// The nation-level Technology category — three independent research trees
// (Physics/Society/Engineering), each with its own research-point pool (see
// techStore.ts). Mirrors NationEconomyPanel's own join pattern exactly:
// usePlayerEconomy() for the country id, a dedicated hook (usePlayerTech)
// for this system's own per-country state.
export function NationTechPanel({ subcategory }: { subcategory: string | null }) {
  const { country } = usePlayerEconomy()
  const tech = usePlayerTech()
  const researchNode = useTechStore((s) => s.researchNode)
  const freeResearchMode = useTechStore((s) => s.freeResearchMode)
  // Tab-scoped store state, not local useState — see viewStore.ts's own
  // comment on techTreeOpen for why: a workspace-tab switch unmounts and
  // remounts this whole panel, which would otherwise silently drop the tree
  // back closed.
  const showTree = useViewStore((s) => s.techTreeOpen)
  const setShowTree = useViewStore((s) => s.setTechTreeOpen)

  const category = subcategoryToCategory(subcategory)
  const techs = CATEGORY_TECHS[category]

  if (techs.length === 0) {
    return (
      <div className="econ-panel">
        <div className="econ-subtitle">{CATEGORY_LABELS[category]}</div>
        <div className="nav-placeholder">No research trees here yet.</div>
      </div>
    )
  }

  if (!country) {
    return <div className="nav-placeholder">No country selected.</div>
  }

  const visible = visibleNodeIds(techs, tech.researched)
  const roots = techs.filter((n) => n.prerequisites.length === 0)

  return (
    <div className="econ-panel tech-panel">
      <div className="inspect-row">
        <span className="inspect-label">{CATEGORY_LABELS[category]} Research</span>
        <span className="inspect-value">{tech.researchPoints[category]} pts</span>
      </div>
      <button type="button" className="tech-tree-view-btn" onClick={() => setShowTree(true)}>
        Tree View
      </button>
      {showTree && (
        <TechTreeGraph
          categoryLabel={CATEGORY_LABELS[category]}
          techs={techs}
          researched={tech.researched}
          researchPoints={tech.researchPoints[category]}
          freeResearchMode={freeResearchMode}
          onResearch={(nodeId) => researchNode(country.id, nodeId)}
          onClose={() => setShowTree(false)}
        />
      )}
      <div className="inspect-divider" />
      <div className="tech-branch-grid">
        {roots.map((root) => (
          <div className="tech-branch" key={root.id}>
            <div className="combat-orders-title">{root.name}</div>
            {branchNodes(root, techs)
              .filter((node) => visible.has(node.id))
              .map((node) => {
                const isResearched = tech.researched.has(node.id)
                const eligible = canResearch(node, tech.researched, tech.researchPoints[category], freeResearchMode)
                // A visible-but-not-yet-reachable node (the "grandchild"
                // preview one hop past its own unmet prerequisite, or
                // Anomalous before its aggregate threshold) shows only its
                // name and a locked marker — no cost, no button — matching
                // the "two nodes into the future" rule: you can see it
                // exists, not act on it yet. A node whose prerequisites ARE
                // met but that's simply unaffordable right now still gets a
                // real (disabled) button, so the player can see what they're
                // saving up for.
                const previewOnly =
                  !isResearched && (!prerequisitesMet(node, tech.researched) || (node.locked === true && !anomalousUnlocked(tech.researched)))
                return (
                  <div className={`inspect-row tech-node${isResearched ? ' tech-node-done' : ''}`} key={node.id} title={node.description}>
                    <span className="inspect-label">
                      {node.name}
                      {node.locked && !isResearched ? ' 🔒' : ''}
                    </span>
                    {isResearched ? (
                      <span className="inspect-value econ-pos">Researched</span>
                    ) : previewOnly ? (
                      <span className="inspect-value">—</span>
                    ) : (
                      <button
                        type="button"
                        className="tech-research-btn"
                        disabled={!eligible}
                        onClick={() => researchNode(country.id, node.id)}
                      >
                        {freeResearchMode ? 0 : node.cost} pts
                      </button>
                    )}
                  </div>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}
