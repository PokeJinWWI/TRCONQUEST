import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { usePlayerTech } from '../hooks/usePlayerTech'
import { useTechStore } from '../state/techStore'
import { useViewStore } from '../state/viewStore'
import { CATEGORY_LABELS, TechTreeGraph, formatResearch } from './TechTreeGraph'
import { usePlayerStore } from '../state/playerStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import {
  TECHS_BY_CATEGORY,
  canResearch,
  visibleNodeIds,
  prerequisitesMet,
  anomalousUnlocked,
  localRoots,
  externalPrerequisites,
  findTech,
  type TechCategory,
  type TechNode,
} from '../data/techData'

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

// What is queued, in order, with a remove button each.
function ResearchQueue({ queue, onRemove }: { queue: string[]; onRemove: (id: string) => void }) {
  if (queue.length === 0) return null
  return (
    <div className="tech-queue">
      <div className="combat-orders-title">Research queue</div>
      {queue.map((id, i) => {
        const node = findTech(id)
        if (!node) return null
        return (
          <div key={id} className="inspect-row">
            <span className="inspect-label">
              {i + 1}. {node.name} <span className={`tech-pool tech-cat-${node.category}`}>({CATEGORY_LABELS[node.category]}, {node.cost})</span>
            </span>
            <button type="button" className="abs-x" title="Take it out of the queue" onClick={() => onRemove(id)}>
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
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
  const queueTech = useTechStore((s) => s.queueTech)
  const unqueueTech = useTechStore((s) => s.unqueueTech)
  const freeResearchMode = useTechStore((s) => s.freeResearchMode)
  // Tab-scoped store state, not local useState — see viewStore.ts's own
  // comment on techTreeOpen for why: a workspace-tab switch unmounts and
  // remounts this whole panel, which would otherwise silently drop the tree
  // back closed.
  const showTree = useViewStore((s) => s.techTreeOpen)
  const setShowTree = useViewStore((s) => s.setTechTreeOpen)

  const playerId = usePlayerStore((s) => s.selectedCountryId)
  // Research earned last month, per tree (Simple mode's labs; Complex has none).
  const monthly = useAbstractEconomyStore((s) => (playerId ? s.reports[playerId]?.researchByTree : undefined)) ?? null

  const category = subcategoryToCategory(subcategory)
  const techs = TECHS_BY_CATEGORY[category]

  if (!country) {
    return <div className="nav-placeholder">No country selected.</div>
  }

  const roots = localRoots(techs)
  // A tree's first techs always show (with what they still need from another
  // tree), so a tree built on another one never reads as empty.
  const visible = new Set([...visibleNodeIds(techs, tech.researched), ...roots.map((n) => n.id)])

  return (
    <div className="econ-panel tech-panel">
      <div className="inspect-row">
        <span className="inspect-label">{CATEGORY_LABELS[category]} Research</span>
        <span className="inspect-value">
          {formatResearch(tech.researchPoints[category])} pts{monthly ? ` (+${monthly[category].toFixed(1)}/mo)` : ''}
        </span>
      </div>
      <button type="button" className="tech-tree-view-btn" onClick={() => setShowTree(true)}>
        Tree View
      </button>
      <ResearchQueue queue={tech.queue ?? []} onRemove={(id) => unqueueTech(country.id, id)} />
      {showTree && (
        <TechTreeGraph
          queue={tech.queue ?? []}
          onQueue={(nodeId) => ((tech.queue ?? []).includes(nodeId) ? unqueueTech(country.id, nodeId) : queueTech(country.id, nodeId))}
          initialTree={category}
          researched={tech.researched}
          researchPoints={tech.researchPoints}
          monthly={monthly}
          freeResearchMode={freeResearchMode}
          onResearch={(nodeId) => researchNode(country.id, nodeId)}
          onClose={() => setShowTree(false)}
        />
      )}
      <div className="inspect-divider" />
      {techs.length === 0 && <div className="nav-placeholder">No research in this tree yet.</div>}
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
                const external = externalPrerequisites(node, techs)
                const queuePos = (tech.queue ?? []).indexOf(node.id)
                const needs = external.length > 0 ? `Needs ${external.map((t) => `${t.name} (${CATEGORY_LABELS[t.category]})`).join(', ')}. ` : ''
                return (
                  <div className={`inspect-row tech-node${isResearched ? ' tech-node-done' : ''}`} key={node.id} title={`${needs}${node.description}`}>
                    <span className="inspect-label">
                      {node.name}
                      {node.locked && !isResearched ? ' 🔒' : ''}
                    </span>
                    {isResearched ? (
                      <span className="inspect-value econ-pos">Researched</span>
                    ) : eligible ? (
                      <button type="button" className="tech-research-btn" onClick={() => researchNode(country.id, node.id)} title="Research it now">
                        {freeResearchMode ? 0 : node.cost} pts
                      </button>
                    ) : queuePos >= 0 ? (
                      <button type="button" className="tech-research-btn queued" onClick={() => unqueueTech(country.id, node.id)} title="Queued: researched as soon as it can be. Click to take it out of the queue.">
                        Queued #{queuePos + 1}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="tech-research-btn"
                        onClick={() => queueTech(country.id, node.id)}
                        title={`${previewOnly ? (external.length > 0 && !prerequisitesMet(node, tech.researched) ? `Needs ${external[0].name} first. ` : 'Needs its prerequisites first. ') : `Needs ${node.cost} pts (have ${formatResearch(tech.researchPoints[category])}). `}Queue it (and what it still needs) to be researched as soon as it can be.`}
                      >
                        Queue · {freeResearchMode ? 0 : node.cost}
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
