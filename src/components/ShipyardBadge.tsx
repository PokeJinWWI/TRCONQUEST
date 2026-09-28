import { COUNTRIES } from '../data/countryData'
import { RELATION_COLORS } from '../data/shipData'
import { useFleetTabStore } from '../state/fleetTabStore'
import { useRelationTo } from '../state/shipRelations'
import { usePlayerStore } from '../state/playerStore'
import { useShipyardStore } from '../state/shipyardStore'
import { useViewStore } from '../state/viewStore'

// The shipyard's icon on the map: a drydock gantry beside the name of the world
// a nation builds its ships at (its capital — see ShipyardPanel). The player's
// own is clickable: it opens Military > Navy > Shipyard, and shows how many
// hulls are on order. Other nations' yards show as an icon in their relation
// colour, so a system's yards read at a glance.
function YardIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 14h12" />
      <path d="M4 14V4h8v10" />
      <path d="M2 4h12" />
      <path d="M6 8h4" />
      <path d="M8 4V2" />
    </svg>
  )
}

function YardBadge({ countryId, own }: { countryId: string; own: boolean }) {
  const relation = useRelationTo(countryId)
  const color = RELATION_COLORS[relation]
  // A string, so the marker re-renders only when the counts change.
  const counts = useShipyardStore((s) => {
    const orders = s.ordersFor(countryId)
    return `${orders.filter((o) => o.startedSimDays !== null).length}/${orders.length}`
  })
  const [building, total] = counts.split('/').map(Number)
  const name = COUNTRIES.find((c) => c.id === countryId)?.name ?? 'Shipyard'
  const title = own
    ? `Your shipyard${total > 0 ? ` — ${building} building, ${total - building} waiting` : ' — idle'}. Click to open.`
    : `${name}'s shipyard`
  return (
    <span
      className={`shipyard-badge${own ? ' own' : ''}`}
      style={{ ['--badge-color' as string]: color }}
      title={title}
      onClick={
        own
          ? (e) => {
              // The marker underneath selects its body on click.
              e.stopPropagation()
              useFleetTabStore.getState().setTab('shipyard')
              useViewStore.getState().setNavCategory('Military', 'Navy')
            }
          : undefined
      }
    >
      <YardIcon />
      {own && total > 0 && <span className="shipyard-badge-count">{total}</span>}
    </span>
  )
}

export function ShipyardBadge({ bodyName }: { bodyName: string }) {
  const player = usePlayerStore((s) => s.selectedCountryId)
  // The sandbox has no nations, so no yards.
  const sandbox = usePlayerStore((s) => s.sandbox)
  const yards = COUNTRIES.filter((c) => c.capitalBodyName === bodyName)
  if (sandbox || yards.length === 0) return null
  return (
    <>
      {yards.map((c) => (
        <YardBadge key={c.id} countryId={c.id} own={c.id === player} />
      ))}
    </>
  )
}
