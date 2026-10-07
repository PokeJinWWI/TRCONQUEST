import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { usePlayerTech } from '../hooks/usePlayerTech'
import { usePlayerResources } from '../hooks/usePlayerResources'
import { useTechStore } from '../state/techStore'
import { usePlayerMaterialMask } from '../hooks/usePlayerMaterialMask'
import { useViewStore } from '../state/viewStore'
import { CATEGORY_LABELS, TechTreeGraph, formatResearch } from './TechTreeGraph'
import { requestToggleTech } from '../scene/sandboxTech'
import { usePlayerStore } from '../state/playerStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore } from '../state/economyStore'
import {
  TECHS_BY_CATEGORY,
  canResearch,
  resourceShortfall,
  researchTerms,
  visibleNodeIds,
  prerequisitesMet,
  anomalousUnlocked,
  techSummary,
  localRoots,
  externalPrerequisites,
  findTech,
  researchEtas,
  shownCost,
  formatEta,
  queuePlan,
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

// What is queued, per research type. Within a type the ones that can go now
// come first; one that needs a tech from another tree waits behind them until
// that tech is done. Each shows roughly how long it will take.
function ResearchQueue({ queue, researched, points, monthly, free, onRemove }: { queue: string[]; researched: ReadonlySet<string>; points: Record<TechCategory, number>; monthly: Record<TechCategory, number> | null; free: boolean; onRemove: (id: string) => void }) {
  const mask = usePlayerMaterialMask()
  if (queue.length === 0) return null
  const rate = monthly ?? { physics: 0, society: 0, engineering: 0 }
  const etas = researchEtas(queue, researched, points, rate, 360, free)
  const have = new Set(researched)
  return (
    <div className="tech-queue">
      <div className="combat-orders-title">Research queue</div>
      {(['physics', 'society', 'engineering'] as TechCategory[]).map((cat) => {
        const ids = queue.filter((id) => findTech(id)?.category === cat)
        if (ids.length === 0) return null
        // Ready ones first (by when they finish, then queue order).
        const sorted = [...ids].sort((a, b) => {
          const na = findTech(a)!
          const nb = findTech(b)!
          const ra = prerequisitesMet(na, have) ? 0 : 1
          const rb = prerequisitesMet(nb, have) ? 0 : 1
          return ra - rb || (etas.get(a) ?? 1e9) - (etas.get(b) ?? 1e9) || queue.indexOf(a) - queue.indexOf(b)
        })
        return (
          <div key={cat}>
            <div className={`tech-pool tech-cat-${cat}`}>{CATEGORY_LABELS[cat]}</div>
            {sorted.map((id, i) => {
              const node = findTech(id)!
              const waitingOn = externalPrerequisites(node, TECHS_BY_CATEGORY[cat]).filter((p) => !have.has(p.id))[0] ?? (prerequisitesMet(node, have) ? null : node.prerequisites[0]?.map((p) => findTech(p)).find((p) => p && !have.has(p.id)))
              return (
                <div key={id} className="inspect-row" title={mask(techSummary(node))}>
                  <span className="inspect-label">
                    {i + 1}. {mask(node.name)} <span className="abs-dim">({shownCost(node, free)} pts, {formatEta(etas.get(id))})</span>
                    {waitingOn ? <span className="abs-dim"> · waits for {mask(waitingOn.name)}</span> : null}
                  </span>
                  <button type="button" className="abs-x" title="Take it out of the queue" onClick={() => onRemove(id)}>
                    ×
                  </button>
                </div>
              )
            })}
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
  const resources = usePlayerResources().amounts
  // Names an undiscovered material "???" here, in the research UI only.
  const mask = usePlayerMaterialMask()
  // Tab-scoped store state, not local useState — see viewStore.ts's own
  // comment on techTreeOpen for why: a workspace-tab switch unmounts and
  // remounts this whole panel, which would otherwise silently drop the tree
  // back closed.
  const showTree = useViewStore((s) => s.techTreeOpen)
  const setShowTree = useViewStore((s) => s.setTechTreeOpen)

  const playerId = usePlayerStore((s) => s.selectedCountryId)
  // The Sandbox: every tech is shown and a click toggles it (scene/sandboxTech.ts), no economy country needed.
  const sandbox = usePlayerStore((s) => s.sandbox)
  const countryId = playerId ?? ''
  // Research earned last month, per tree: Simple mode's labs, or Complex mode's
  // educated workforce + research buildings (economy/research.ts).
  const complexMode = usePlayerStore((s) => s.economyModel === 'complex')
  const abstractMonthly = useAbstractEconomyStore((s) => (playerId ? s.reports[playerId]?.researchByTree : undefined))
  const complexMonthly = useEconomyStore((s) => (playerId ? s.researchRate[playerId] : undefined))
  const monthly = (complexMode ? complexMonthly : abstractMonthly) ?? null

  const category = subcategoryToCategory(subcategory)
  const techs = TECHS_BY_CATEGORY[category]

  if (!country && !sandbox) {
    return <div className="nav-placeholder">No country selected.</div>
  }

  const roots = localRoots(techs)
  // A tree's first techs always show (with what they still need from another
  // tree), so a tree built on another one never reads as empty.
  // Roughly how long a tech would take if queued now (with what it needs).
  const rate = monthly ?? { physics: 0, society: 0, engineering: 0 }
  const etaIfQueued = (id: string): number | null => {
    const q = [...(tech.queue ?? []), ...queuePlan(id, tech.researched, tech.queue ?? [])]
    return researchEtas(q, tech.researched, tech.researchPoints, rate, 240, freeResearchMode).get(id) ?? null
  }
  const visible = sandbox ? new Set(techs.map((n) => n.id)) : new Set([...visibleNodeIds(techs, tech.researched), ...roots.map((n) => n.id)])

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
      <ResearchQueue queue={tech.queue ?? []} researched={tech.researched} points={tech.researchPoints} monthly={monthly} free={freeResearchMode} onRemove={(id) => unqueueTech(countryId, id)} />
      {showTree && (
        <TechTreeGraph
          queue={tech.queue ?? []}
          onQueue={(nodeId) => ((tech.queue ?? []).includes(nodeId) ? unqueueTech(countryId, nodeId) : queueTech(countryId, nodeId))}
          initialTree={category}
          researched={tech.researched}
          researchPoints={tech.researchPoints}
          monthly={monthly}
          freeResearchMode={freeResearchMode}
          resources={resources}
          sandbox={sandbox}
          onResearch={(nodeId) => (sandbox ? requestToggleTech(nodeId) : researchNode(countryId, nodeId))}
          onClose={() => setShowTree(false)}
        />
      )}
      <div className="inspect-divider" />
      {techs.length === 0 && <div className="nav-placeholder">No research in this tree yet.</div>}
      <div className="tech-branch-grid">
        {roots.map((root) => (
          <div className="tech-branch" key={root.id}>
            <div className="combat-orders-title">{mask(root.name)}</div>
            {branchNodes(root, techs)
              .filter((node) => visible.has(node.id))
              .map((node) => {
                const isResearched = tech.researched.has(node.id)
                const shortfall = !tech.researched.has(node.id) && !freeResearchMode ? resourceShortfall(node, resources) : null
                const eligible = canResearch(node, tech.researched, tech.researchPoints[category], freeResearchMode) && !shortfall
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
                  !sandbox && !isResearched && (!prerequisitesMet(node, tech.researched) || (node.locked === true && !anomalousUnlocked(tech.researched)))
                const external = externalPrerequisites(node, techs)
                // What it is actually waiting for: the first tech still missing from the
                // prerequisite set closest to done (not one it already has).
                const missing = prerequisitesMet(node, tech.researched)
                  ? undefined
                  : findTech([...node.prerequisites.map((set) => set.filter((id) => !tech.researched.has(id)))].sort((x, y) => x.length - y.length)[0]?.[0] ?? '')
                const queuePos = (tech.queue ?? []).indexOf(node.id)
                const needs = external.length > 0 ? `Needs ${external.map((t) => `${mask(t.name)} (${CATEGORY_LABELS[t.category]})`).join(', ')}. ` : ''
                return (
                  <div className={`inspect-row tech-node${isResearched ? ' tech-node-done' : ''}`} key={node.id} title={`${needs}${mask(techSummary(node))}`}>
                    <span className="inspect-label">
                      {mask(node.name)}
                      {node.locked && !isResearched ? ' 🔒' : ''}
                    </span>
                    {sandbox ? (
                      <button
                        type="button"
                        className="tech-research-btn"
                        disabled={!isResearched && !freeResearchMode && !eligible}
                        onClick={() => requestToggleTech(node.id)}
                        title={isResearched ? 'Sandbox: un-research it (and whatever needs it)' : freeResearchMode ? 'Sandbox: research it (and what it needs), free' : 'Research it (costs apply: Free Research is off)'}
                      >
                        {isResearched ? 'Researched · click to undo' : freeResearchMode ? 'Research · 0' : `Research · ${node.cost}`}
                      </button>
                    ) : isResearched ? (
                      <span className="inspect-value econ-pos">Researched</span>
                    ) : eligible ? (
                      <button type="button" className="tech-research-btn" onClick={() => researchNode(countryId, node.id)} title="Research it now">
                        {freeResearchMode ? 0 : node.cost} pts
                      </button>
                    ) : queuePos >= 0 ? (
                      <button type="button" className="tech-research-btn queued" onClick={() => unqueueTech(countryId, node.id)} title="Queued: researched as soon as it can be. Click to take it out of the queue.">
                        Queued #{queuePos + 1}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="tech-research-btn"
                        onClick={() => queueTech(countryId, node.id)}
                        title={mask(`${previewOnly ? (missing ? `Needs ${missing.name} first. ` : 'Needs its prerequisites first. ') : `${shortfall ? `${shortfall}. ` : ''}Needs ${shownCost(node, freeResearchMode)} pts (have ${formatResearch(tech.researchPoints[category])}). `}Queue it (and what it still needs) to be researched as soon as it can be: ${formatEta(etaIfQueued(node.id))}.`)}
                      >
                        Queue · {freeResearchMode ? 0 : node.cost}
                      </button>
                    )}
                    {node.shortcut && !previewOnly && !isResearched && !sandbox && (() => {
                      // The second way in (TechNode.shortcut): fewer points, plus resources burned.
                      const terms = researchTerms(node, true)
                      const short = freeResearchMode ? null : resourceShortfall({ resourceCost: terms.resourceCost }, resources)
                      const can = canResearch(node, tech.researched, tech.researchPoints[category], freeResearchMode, true) && !short
                      const price = Object.entries(terms.resourceCost).map(([id, n]) => `${n} ${id === 'hyperium' ? 'hyperium' : id}`).join(', ')
                      return (
                        <button type="button" className="tech-research-btn" disabled={!can} onClick={() => researchNode(countryId, node.id, true)} title={`The shortcut: ${terms.cost} pts and ${price} (consumed) instead of ${node.cost.toLocaleString()} pts.${short ? ` ${short}.` : ''}`}>
                          Shortcut · {freeResearchMode ? 0 : terms.cost} pts + {price}
                        </button>
                      )
                    })()}
                    {shortfall && !previewOnly && !isResearched && <span className="abs-dim tech-shortfall"> {mask(shortfall)}</span>}
                    {node.gives && !previewOnly && (
                      <div className="abs-dim tech-gives" style={{ flexBasis: '100%' }}>
                        Gives: {node.gives.map((g) => mask(g)).join(' · ')}
                      </div>
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
