import { useMemo } from 'react'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { CULTURES, RELIGIONS } from '../economy/demographics'
import { SPECIES_TEMPLATES } from '../economy/species'
import { formatPop } from '../economy/format'
import type { Pop } from '../economy/economyTypes'

const CLASS_LABEL: Record<string, string> = {
  subsistence: 'Subsistence',
  labor: 'Labor',
  technical: 'Technical',
  professional: 'Professional',
  investor: 'Investor',
  political: 'Political',
}
const CLASS_COLOR: Record<string, string> = {
  subsistence: '#8a8f96',
  labor: '#ff6b4a',
  technical: '#6fe3ff',
  professional: '#4ade80',
  investor: '#ffd23f',
  political: '#c77dff',
}

// One labelled proportional bar in a breakdown.
function Bar({ label, value, total, color, right }: { label: string; value: number; total: number; color: string; right?: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="demo-bar-row">
      <span className="demo-bar-label">{label}</span>
      <span className="demo-bar-track">
        <span className="demo-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="demo-bar-val">{right ?? `${Math.round(pct)}%`}</span>
    </div>
  )
}

function groupSum<T extends string>(pops: Pop[], key: (p: Pop) => T): Map<T, number> {
  const m = new Map<T, number>()
  for (const p of pops) m.set(key(p), (m.get(key(p)) ?? 0) + p.populationSize)
  return m
}

// Society → Demographics: the whole empire's population, broken down the ways a
// ruler cares about — occupation (class), culture, religion, species — plus the
// living-standards distribution and headline welfare numbers, aggregated across
// every world the player's country owns.
export function DemographicsPanel() {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const worlds = useEconomyStore((s) => s.worlds)

  const pops = useMemo(() => worlds.filter((w) => w.ownerId === countryId).flatMap((w) => w.pops), [worlds, countryId])

  if (!countryId) return <div className="nav-placeholder">No nation selected.</div>
  if (pops.length === 0) return <div className="nav-placeholder">No population data.</div>

  const total = pops.reduce((s, p) => s + p.populationSize, 0)
  const avgSoL = pops.reduce((s, p) => s + p.standardOfLiving * p.populationSize, 0) / total
  const avgEdu = pops.reduce((s, p) => s + p.educationLevel * p.populationSize, 0) / total

  const byClass = groupSum(pops, (p) => p.class)
  const byCulture = groupSum(pops, (p) => p.cultureId)
  const byReligion = groupSum(pops, (p) => p.religionId)
  const bySpecies = groupSum(pops, (p) => p.speciesTemplateId)

  // Standard-of-living distribution buckets.
  const buckets = [
    { label: 'Destitute (<25%)', color: '#ff6b4a', lo: 0, hi: 0.25 },
    { label: 'Poor (25–45%)', color: '#ffb454', lo: 0.25, hi: 0.45 },
    { label: 'Modest (45–65%)', color: '#ffd23f', lo: 0.45, hi: 0.65 },
    { label: 'Comfortable (65–85%)', color: '#9be36f', lo: 0.65, hi: 0.85 },
    { label: 'Prosperous (>85%)', color: '#4ade80', lo: 0.85, hi: 1.01 },
  ]
  const bucketPop = buckets.map((b) => pops.filter((p) => p.standardOfLiving >= b.lo && p.standardOfLiving < b.hi).reduce((s, p) => s + p.populationSize, 0))

  const sorted = <T extends string>(m: Map<T, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="econ-panel">
      <div className="econ-fiscal-headline">
        <span>
          Population <b>{formatPop(total)}</b>
        </span>
        <span>
          Avg SoL <b>{Math.round(avgSoL * 100)}%</b>
        </span>
        <span>
          Avg education <b>{Math.round(avgEdu * 100)}%</b>
        </span>
        <span>
          Cohorts <b>{pops.length}</b>
        </span>
      </div>

      <div className="econ-subtitle">Standard of living</div>
      {buckets.map((b, i) => (
        <Bar key={b.label} label={b.label} value={bucketPop[i]} total={total} color={b.color} right={formatPop(bucketPop[i])} />
      ))}

      <div className="econ-subtitle" style={{ marginTop: 10 }}>
        Occupations (class)
      </div>
      {sorted(byClass).map(([cls, v]) => (
        <Bar key={cls} label={CLASS_LABEL[cls] ?? cls} value={v} total={total} color={CLASS_COLOR[cls] ?? '#6fe3ff'} />
      ))}

      <div className="econ-subtitle" style={{ marginTop: 10 }}>
        Culture
      </div>
      {sorted(byCulture).map(([id, v]) => (
        <Bar key={id} label={CULTURES[id]?.name ?? id} value={v} total={total} color={CULTURES[id]?.color ?? '#6fe3ff'} />
      ))}

      <div className="econ-subtitle" style={{ marginTop: 10 }}>
        Religion
      </div>
      {sorted(byReligion).map(([id, v]) => (
        <Bar key={id} label={RELIGIONS[id]?.name ?? id} value={v} total={total} color={RELIGIONS[id]?.color ?? '#8a8f96'} />
      ))}

      <div className="econ-subtitle" style={{ marginTop: 10 }}>
        Species
      </div>
      {sorted(bySpecies).map(([id, v]) => (
        <Bar key={id} label={SPECIES_TEMPLATES[id]?.name ?? id} value={v} total={total} color="#8fd0ff" />
      ))}
    </div>
  )
}
