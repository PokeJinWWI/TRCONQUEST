import { create } from 'zustand'
import type { NationIntel } from '../scene/surveyLogic'

// What each nation has explored and surveyed, in two layers:
//  - `discovered`: what its ships have actually found (the truth; written by
//    hooks/useSurveyResolver as science ships work). The AI and the game's own
//    rules read this layer.
//  - `known`: what has reached the nation's capital by signal — a discovery
//    made far away takes the FTL comms delay to arrive (`reports`), and is
//    instant with Hyper Comms. The player's UI reads this layer, so a system a
//    ship has already explored can still show as unexplored to the player for a
//    while.
// A nation's own systems need no entry here (see scene/surveyLogic.ts).
export type SurveyFact = { kind: 'explored'; starId: string } | { kind: 'surveyed'; bodyName: string }

export interface SurveyReport {
  nationId: string
  fact: SurveyFact
  arrivesSimDays: number
}

type Layer = Record<string, NationIntel>

function withFact(layer: Layer, nationId: string, fact: SurveyFact): Layer {
  const cur = layer[nationId] ?? { explored: new Set<string>(), surveyed: new Set<string>() }
  if (fact.kind === 'explored' ? cur.explored.has(fact.starId) : cur.surveyed.has(fact.bodyName)) return layer
  const next: NationIntel =
    fact.kind === 'explored'
      ? { explored: new Set(cur.explored).add(fact.starId), surveyed: cur.surveyed }
      : { explored: cur.explored, surveyed: new Set(cur.surveyed).add(fact.bodyName) }
  return { ...layer, [nationId]: next }
}

interface SurveyState {
  discovered: Layer
  known: Layer
  // Discoveries still in flight to the capital.
  reports: SurveyReport[]
  // Records a discovery: written to `discovered` at once, and to `known` when
  // its signal arrives (`arrivesSimDays` <= `simDays` means immediately).
  discover: (nationId: string, fact: SurveyFact, arrivesSimDays: number, simDays: number) => void
  // Moves every report whose signal has arrived into `known`.
  deliverReports: (simDays: number) => void
}

export const useSurveyStore = create<SurveyState>((set) => ({
  discovered: {},
  known: {},
  reports: [],
  discover: (nationId, fact, arrivesSimDays, simDays) =>
    set((s) => {
      const discovered = withFact(s.discovered, nationId, fact)
      if (arrivesSimDays <= simDays) return { discovered, known: withFact(s.known, nationId, fact) }
      return { discovered, reports: [...s.reports, { nationId, fact, arrivesSimDays }] }
    }),
  deliverReports: (simDays) =>
    set((s) => {
      const due = s.reports.filter((r) => r.arrivesSimDays <= simDays)
      if (due.length === 0) return s
      let known = s.known
      for (const r of due) known = withFact(known, r.nationId, r.fact)
      return { known, reports: s.reports.filter((r) => r.arrivesSimDays > simDays) }
    }),
}))
