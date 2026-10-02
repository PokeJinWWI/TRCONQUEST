// Government > Leaders: the people who serve the nation, by kind. Categories
// are data: add a line to LEADER_CATEGORIES for a new kind.
//
// Checked against the existing Character data (economyStore `characters`,
// CharactersPanel): those are corporation leaders and unaffiliated people of
// the Complex economy — none is a governor, envoy, spy, fleet commander or
// scientist — so no category has real entries yet. Each shows the standard
// "Not yet available" placeholder. No appointment, effects or stats exist; when
// a kind gets real data, give its entry an `entries` function and the panel
// lists what it returns.
import type { ReactNode } from 'react'

interface LeaderCategory {
  id: string
  label: string
  // What this kind of leader is (shown under the heading).
  description: string
  // Real entries, when a data source exists. Absent = not yet available.
  entries?: () => ReactNode[]
}

export const LEADER_CATEGORIES: LeaderCategory[] = [
  { id: 'governors', label: 'Governors (planet)', description: 'Each governs one world.' },
  { id: 'envoys', label: 'Envoys', description: 'Represent the nation to other nations.' },
  { id: 'spies', label: 'Spies', description: 'Work in secret abroad.' },
  { id: 'fleet-commanders', label: 'Fleet Commanders', description: 'Lead fleets.' },
  { id: 'scientists', label: 'Scientists', description: 'Lead research.' },
]

export function LeadersPanel() {
  return (
    <div className="econ-panel leaders-panel">
      {LEADER_CATEGORIES.map((c) => {
        const entries = c.entries?.() ?? []
        return (
          <div key={c.id} className="leaders-section" data-leader-category={c.id}>
            <div className="econ-subtitle" title={c.description}>
              {c.label}
            </div>
            {entries.length > 0 ? entries : <div className="nav-placeholder">Not yet available</div>}
          </div>
        )
      })}
    </div>
  )
}
