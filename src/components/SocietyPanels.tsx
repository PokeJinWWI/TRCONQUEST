import { Bi } from './Bi'
import { TimeChart } from './TimeChart'
import { useMemo, useState } from 'react'
import { nationCultureOf } from '../economy/acceptance'
import { CULTURES, RELIGIONS } from '../economy/demographics'
import { formatPop } from '../economy/format'
import type { Pop } from '../economy/economyTypes'
import { SOCIAL_STRATUM_LABEL, workforceOf, type PopLaws } from '../economy/popRules'
import { popGrowthPerYear, worldWorkforce } from '../economy-abstract/abstractEconomy'
import { NEED_TIERS, SPECIES_TEMPLATES } from '../economy/species'
import { cultureView, politicsView, popRows, religionView, societyViewComplex, societyViewSimple, type Mood, type PopSort, type SocietyView } from '../scene/societyView'
import { useAbstractEconomyStore, worldsOf } from '../state/abstractEconomyStore'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { useTerritoryStore } from '../state/territoryStore'

// Society: the nation's people (docs: Vic3-style pops). Social classes, the pop table, politics, culture, religion and species. One data hook
// for both economies; the panels read the shared view models (scene/societyView.ts). Simple mode shows what it models (strata, workforce,
// literacy, mood) and says so where it does not model a thing, rather than inventing one.

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`

interface SocietyData {
  countryId: string
  simple: boolean
  pops: Pop[]
  laws: Partial<PopLaws> | undefined
  view: SocietyView | null
  // The nation's people over time, one value a month (the newest last), and the tick of the newest.
  history: { literacy: number[]; turmoil: number[]; workforceShare: number[]; upperWealthShare: number[]; tick: number }
}

function useSocietyData(): SocietyData | null {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const simple = usePlayerStore((s) => s.economyModel === 'abstract')
  const worlds = useEconomyStore((s) => s.worlds)
  const countries = useEconomyStore((s) => s.countries)
  const simpleState = useAbstractEconomyStore((s) => (countryId ? s.byCountry[countryId] : undefined))
  const simpleReport = useAbstractEconomyStore((s) => (countryId ? s.reports[countryId] : undefined))
  const simpleWorlds = useAbstractEconomyStore((s) => s.worlds)
  const simpleHistory = useAbstractEconomyStore((s) => (countryId ? s.history[countryId] : undefined))
  const simpleTick = useAbstractEconomyStore((s) => s.tick)
  const complexHistory = useEconomyStore((s) => (countryId ? s.history[countryId] : undefined))
  const complexTick = useEconomyStore((s) => s.tick)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const controllers = useTerritoryStore((s) => s.bodyController)
  return useMemo(() => {
    if (!countryId) return null
    if (simple) {
      if (!simpleState || !simpleReport) return null
      const mine = worldsOf(countryId, simpleWorlds, owners, controllers)
      const population = mine.reduce((n, w) => n + w.population, 0)
      const workforce = mine.reduce((n, w) => n + worldWorkforce(w), 0)
      const view = societyViewSimple({ population, workforce, literacy: simpleState.literacy ?? 0.6, strata: { workers: simpleReport.strata.workers, specialists: simpleReport.strata.specialists, unemployed: simpleReport.strata.unemployed }, approval: simpleReport.approval, growthPerYear: popGrowthPerYear(simpleReport.approval, simpleState.welfare, simpleReport.foodSatisfaction) })
      const h = simpleHistory ?? []
      return { countryId, simple, pops: [], laws: simpleState.popLaws, view, history: { literacy: h.map((p) => p.literacy ?? 0), turmoil: h.map((p) => p.turmoil ?? 0), workforceShare: [], upperWealthShare: [], tick: simpleTick } }
    }
    const pops = worlds.filter((w) => w.ownerId === countryId).flatMap((w) => w.pops)
    const laws = countries.find((c) => c.id === countryId)?.popLaws
    const h = (complexHistory ?? []).filter((p) => p.literacy !== undefined)
    return {
      countryId, simple, pops, laws, view: pops.length > 0 ? societyViewComplex(pops, nationCultureOf(pops), laws) : null,
      history: { literacy: h.map((p) => p.literacy ?? 0), turmoil: h.map((p) => p.turmoil ?? 0), workforceShare: h.map((p) => p.workforceShare ?? 0), upperWealthShare: h.map((p) => p.upperWealthShare ?? 0), tick: complexTick },
    }
  }, [countryId, simple, worlds, countries, simpleState, simpleReport, simpleWorlds, owners, controllers, simpleHistory, simpleTick, complexHistory, complexTick])
}

function MoodBar({ mood }: { mood: Mood }) {
  return (
    <span className="demo-bar-track" title={`${pct(mood.loyalists)} loyalists · ${pct(mood.neutral)} neutral · ${pct(mood.radicals)} radicals`} style={{ display: 'inline-flex', width: 90 }}>
      <span style={{ width: pct(mood.loyalists), background: '#4ade80', height: '100%' }} />
      <span style={{ width: pct(mood.neutral), background: '#8a8f96', height: '100%' }} />
      <span style={{ width: pct(mood.radicals), background: '#ff6b4a', height: '100%' }} />
    </span>
  )
}

const NOT_MODELLED = (what: string) => (
  <div className="ship-panel-hint">Simple mode does not model {what}: it keeps strata, a workforce and a nation-wide literacy. Switch to Complex mode for the full picture.</div>
)

// ---- Social classes -------------------------------------------------------------------------------------------------------------------------

export function SocialClassesPanel() {
  const data = useSocietyData()
  if (!data || !data.view) return <div className="nav-placeholder">No population data.</div>
  const v = data.view
  return (
    <div className="econ-panel">
      <div className="econ-fiscal-headline">
        <span title="Everyone"><Bi en="Population" /> <b>{formatPop(v.population)}</b></span>
        <span title="People who staff jobs and earn wages or dividends"><Bi en="Workforce" /> <b>{formatPop(v.workforce)}</b></span>
        <span title="Children, the elderly and carers: no job, half a worker's needs. Your workforce laws move this"><Bi en="Dependents" /> <b>{formatPop(v.dependents)}</b></span>
        <span title="Share of people who can read and write"><Bi en="Literacy" /> <b>{pct(v.literacy)}</b></span>
        <span title="Share of people who are radicals"><Bi en="Turmoil" /> <b className={v.turmoil > 0.2 ? 'econ-neg' : ''}>{pct(v.turmoil)}</b></span>
      </div>
      {v.birthPerThousand !== null && (
        <div className="abs-dim" style={{ margin: '2px 0 6px' }}>Births {v.birthPerThousand.toFixed(1)} and deaths {v.deathPerThousand?.toFixed(1)} per thousand a year.</div>
      )}
      {v.strata.map((s) => (
        <div key={s.stratum} className="pl-district" style={{ marginBottom: 8 }}>
          <div className="pl-district-head" title={s.blurb}>
            <span className="pl-district-name">{s.label}</span>
            <span className="pl-district-slots">{pct(s.share)} of people</span>
            <MoodBar mood={s.mood} />
          </div>
          <div className="pl-stat-grid">
            <div className="pl-stat"><span><Bi en="People" /></span><b>{formatPop(s.population)}</b></div>
            <div className="pl-stat" title="Workforce / dependents"><span><Bi en="Work / dep" /></span><b>{formatPop(s.workforce)} / {formatPop(s.dependents)}</b></div>
            {s.literacy !== null && <div className="pl-stat"><span><Bi en="Literacy" /></span><b>{pct(s.literacy)}</b></div>}
            {s.sol !== null && <div className="pl-stat"><span><Bi en="Standard of living" /></span><b>{pct(s.sol)}</b></div>}
            {s.wealthShare !== null && <div className="pl-stat" title="Share of all the nation's wealth"><span><Bi en="Wealth" /></span><b>{pct(s.wealthShare)}</b></div>}
            {s.strengthShare !== null && <div className="pl-stat" title="Share of the nation's political strength"><span><Bi en="Clout" /></span><b>{pct(s.strengthShare)}</b></div>}
          </div>
          {s.classes.length > 0 && (
            <table className="econ-table">
              <thead><tr><th><Bi en="Profession" /></th><th><Bi en="Pop" /></th><th><Bi en="Work / dep" /></th><th><Bi en="Wealth lvl" /></th><th><Bi en="Literacy" /></th><th><Bi en="Mood" /></th></tr></thead>
              <tbody>
                {s.classes.map((c) => (
                  <tr key={c.cls}>
                    <td style={{ textTransform: 'capitalize' }}>{c.cls}</td>
                    <td>{formatPop(c.population)}</td>
                    <td>{formatPop(c.workforce)} / {formatPop(c.dependents)}</td>
                    <td title={`${c.wealthPerPerson.toFixed(1)} per person`}>{c.wealthLevel}</td>
                    <td>{pct(c.literacy)}</td>
                    <td><MoodBar mood={c.mood} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {v.topWealthShare !== null && <div className="abs-dim" title="A plain measure of how unequal the nation is">The {SOCIAL_STRATUM_LABEL.upper.toLowerCase()} holds {pct(v.topWealthShare)} of the nation's wealth.</div>}
      {data.history.literacy.length > 1 && (
        <>
          <TimeChart title="Literacy" endTick={data.history.tick} includeZero format={(x) => pct(x, 1)} series={[{ label: 'Literacy', color: '#6fe3ff', values: data.history.literacy }]} tip="Share of people who can read and write. It follows living standards, the schools you build and your schooling laws." />
          <TimeChart title="Turmoil" endTick={data.history.tick} includeZero format={(x) => pct(x, 1)} series={[{ label: 'Radicals', color: '#ff6b4a', values: data.history.turmoil }]} tip="Share of people who are radicals: below the standard of living they expect." />
          {data.history.workforceShare.length > 1 && <TimeChart title="Workforce share" endTick={data.history.tick} format={(x) => pct(x, 1)} series={[{ label: 'In the workforce', color: '#ffd23f', values: data.history.workforceShare }]} tip="Share of people who staff jobs. Your workforce laws move it a little each month." />}
          {data.history.upperWealthShare.length > 1 && <TimeChart title="Wealth held by the upper class" endTick={data.history.tick} includeZero format={(x) => pct(x, 1)} series={[{ label: 'Upper class', color: '#c77dff', values: data.history.upperWealthShare }]} tip="How unequal the nation is." />}
        </>
      )}
      {data.simple && NOT_MODELLED('professions, wealth or an upper class')}
    </div>
  )
}

// ---- Population (the pop table) ------------------------------------------------------------------------------------------------------------

const SORTS: { key: PopSort; label: string }[] = [
  { key: 'population', label: 'Size' },
  { key: 'class', label: 'Profession' },
  { key: 'literacy', label: 'Literacy' },
  { key: 'sol', label: 'Living standard' },
  { key: 'wealth', label: 'Wealth' },
  { key: 'mood', label: 'Angriest' },
]

export function PopulationPanel() {
  const data = useSocietyData()
  const [sort, setSort] = useState<PopSort>('population')
  const [limit, setLimit] = useState(30)
  const rows = useMemo(() => (data && !data.simple ? popRows(data.pops, nationCultureOf(data.pops), data.laws, sort) : []), [data, sort])
  if (!data) return <div className="nav-placeholder">No population data.</div>
  if (data.simple) return <div className="econ-panel">{NOT_MODELLED('individual pops')}</div>
  return (
    <div className="econ-panel">
      <div className="pl-site-districts">
        <span className="abs-dim"><Bi en="Sort" /></span>
        {SORTS.map((s) => (
          <button key={s.key} type="button" className={`pl-develop${sort === s.key ? ' active' : ''}`} onClick={() => setSort(s.key)}>{s.label}</button>
        ))}
      </div>
      <table className="econ-table">
        <thead>
          <tr><th><Bi en="Profession" /></th><th><Bi en="Culture" /></th><th><Bi en="Religion" /></th><th><Bi en="Pop" /></th><th title="Workforce / dependents"><Bi en="Work / dep" /></th><th><Bi en="Literacy" /></th><th><Bi en="Wealth lvl" /></th><th><Bi en="SoL" /></th><th><Bi en="Mood" /></th></tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r) => (
            <tr key={r.id} title={`${SOCIAL_STRATUM_LABEL[r.stratum]} · ${r.status === 'full' ? 'fully accepted' : r.status.replace(/-/g, ' ')}`}>
              <td style={{ textTransform: 'capitalize' }}>{r.cls}</td>
              <td>{r.culture}</td>
              <td>{r.religion}</td>
              <td>{formatPop(r.population)}</td>
              <td>{formatPop(r.workforce)} / {formatPop(r.dependents)}</td>
              <td>{pct(r.literacy)}</td>
              <td>{r.wealthLevel}</td>
              <td className={r.sol >= 0.6 ? 'econ-pos' : r.sol >= 0.35 ? '' : 'econ-neg'}>{pct(r.sol)}</td>
              <td className={r.mood < -0.2 ? 'econ-neg' : r.mood > 0.2 ? 'econ-pos' : ''}>{r.mood < -0.05 ? `${pct(-r.mood)} radical` : r.mood > 0.05 ? `${pct(r.mood)} loyal` : 'neutral'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && <button type="button" className="laws-enact-btn" onClick={() => setLimit(limit + 40)}>Show more ({rows.length - limit} left)</button>}
      <div className="abs-dim">{rows.length} pops · {formatPop(data.pops.reduce((n, p) => n + workforceOf(p), 0))} in the workforce</div>
    </div>
  )
}

// ---- Politics ------------------------------------------------------------------------------------------------------------------------------

export function SocietyPoliticsPanel() {
  const data = useSocietyData()
  if (!data || !data.view) return <div className="nav-placeholder">No population data.</div>
  const v = data.view
  const groups = data.simple ? [] : politicsView(data.pops, nationCultureOf(data.pops), data.laws)
  return (
    <div className="econ-panel">
      <div className="econ-fiscal-headline">
        <span title="Share of people who are radicals"><Bi en="Turmoil" /> <b className={v.turmoil > 0.2 ? 'econ-neg' : ''}>{pct(v.turmoil)}</b></span>
      </div>
      <div className="ship-panel-hint">Loyalists are content, radicals are angry: people expect a standard of living that rises with their literacy, and move one step a month toward loyal when they have more and toward radical when they have less. Radicals make a world less safe to live in and slow assimilation.</div>
      <div className="econ-subtitle"><Bi en="Interest groups" /></div>
      {groups.map((g) => (
        <div key={g.id} className="demo-bar-row">
          <span className="demo-bar-label" style={{ color: g.color }}>{g.name}</span>
          <span className="demo-bar-track"><span className="demo-bar-fill" style={{ width: pct(g.share), background: g.color }} /></span>
          <span className="demo-bar-val">{pct(g.share)}</span>
          <MoodBar mood={g.mood} />
        </div>
      ))}
      <div className="econ-subtitle" style={{ marginTop: 10 }}><Bi en="By social class" /></div>
      {v.strata.map((s) => (
        <div key={s.stratum} className="demo-bar-row">
          <span className="demo-bar-label">{s.label}</span>
          <span className="demo-bar-track"><span className="demo-bar-fill" style={{ width: pct(s.strengthShare ?? s.share), background: '#6fe3ff' }} /></span>
          <span className="demo-bar-val" title={s.strengthShare !== null ? 'Share of political strength' : 'Share of people'}>{pct(s.strengthShare ?? s.share)}</span>
          <MoodBar mood={s.mood} />
        </div>
      ))}
      {data.simple && NOT_MODELLED('interest groups or political strength')}
    </div>
  )
}

// ---- Culture and religion ------------------------------------------------------------------------------------------------------------------

export function CulturePanel() {
  const data = useSocietyData()
  if (!data) return <div className="nav-placeholder">No population data.</div>
  if (data.simple) return <div className="econ-panel">{NOT_MODELLED('cultures or acceptance')}</div>
  const nation = nationCultureOf(data.pops)
  const rows = cultureView(data.pops, nation, data.laws)
  return (
    <div className="econ-panel">
      <div className="ship-panel-hint">Your nation's own culture is always fully accepted. Others are accepted as far as your cultural policy allows (Laws): the less accepted, the less clout, the lower the pay and the fewer skilled jobs, and the faster they assimilate into the national culture.</div>
      <table className="econ-table">
        <thead><tr><th><Bi en="Culture" /></th><th><Bi en="People" /></th><th><Bi en="Share" /></th><th><Bi en="Acceptance" /></th><th title="Share that adopts the national culture each year"><Bi en="Assimilating" /></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td><span style={{ color: c.color }}>●</span> {c.name}{c.primary ? ' (national)' : ''}</td>
              <td>{formatPop(c.population)}</td>
              <td>{pct(c.share, 1)}</td>
              <td title={`Score ${c.score} of 100`} className={c.status === 'full' ? 'econ-pos' : c.status === 'second-class' ? '' : 'econ-neg'}>{c.statusLabel}</td>
              <td>{c.primary ? '-' : `${pct(c.assimilationPerYear, 1)} a year`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ReligionPanel() {
  const data = useSocietyData()
  if (!data) return <div className="nav-placeholder">No population data.</div>
  if (data.simple) return <div className="econ-panel">{NOT_MODELLED('religions')}</div>
  const rows = religionView(data.pops, nationCultureOf(data.pops), data.laws)
  return (
    <div className="econ-panel">
      <div className="ship-panel-hint">The biggest faith is the state religion. People of other faiths slowly convert to it; religious schools (Laws) speed that up.</div>
      <table className="econ-table">
        <thead><tr><th><Bi en="Religion" /></th><th><Bi en="People" /></th><th><Bi en="Share" /></th><th title="Share that converts to the state religion each year"><Bi en="Converting" /></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><span style={{ color: r.color }}>●</span> {r.name}{r.state ? ' (state)' : ''}</td>
              <td>{formatPop(r.population)}</td>
              <td>{pct(r.share, 1)}</td>
              <td>{r.state ? '-' : `${pct(r.conversionPerYear, 1)} a year`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Species -------------------------------------------------------------------------------------------------------------------------------

export function SpeciesPanel() {
  const data = useSocietyData()
  if (!data) return <div className="nav-placeholder">No population data.</div>
  if (data.simple) return <div className="econ-panel">{NOT_MODELLED('species')}</div>
  const total = data.pops.reduce((n, p) => n + p.populationSize, 0)
  const ids = [...new Set(data.pops.map((p) => p.speciesTemplateId))]
  return (
    <div className="econ-panel">
      {ids.map((id) => {
        const t = SPECIES_TEMPLATES[id]
        const size = data.pops.filter((p) => p.speciesTemplateId === id).reduce((n, p) => n + p.populationSize, 0)
        return (
          <div key={id} className="pl-district" style={{ marginBottom: 8 }}>
            <div className="pl-district-head"><span className="pl-district-name">{t?.name ?? id}</span><span className="pl-district-slots">{formatPop(size)} · {pct(total > 0 ? size / total : 0)}</span></div>
            {t && NEED_TIERS.map((tier) => (
              <div key={tier} className="inspect-row">
                <span className="inspect-label" style={{ textTransform: 'capitalize' }}>{tier}</span>
                <span className="inspect-value">{t.needs[tier].map((g) => g.label).join(', ') || 'none'}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

void CULTURES
void RELIGIONS
