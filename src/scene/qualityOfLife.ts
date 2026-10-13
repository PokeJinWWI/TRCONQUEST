// Quality of life: how pleasant a place is to live, apart from how much its people can buy. These are DISPLAYED and (in section D)
// weighed by migration; they are NOT part of the standard of living, which stays the needs-basket score (economy/economyTick).
// Pure: scene/qualityOfLifeNow.ts gathers the inputs from the running game.
//
//   Housing          room for the people against how many there are (settlement capacity vs population)
//   Infrastructure   how much of what the sites make reaches a hub (transport access)
//   Safety           unrest from displaced people, occupation, a war fought over the world, an enemy fleet in orbit
//   Habitability     how kind the surface is (economy/habitability)
//   Public services  the share of healthcare and education the state funds (Complex)
//   Rights & freedoms: a placeholder until the game has systems of government
export interface QolInput {
  habitability: number
  // People housed against the room there is (millions); null = no settlements to judge.
  housing: { population: number; room: number } | null
  // Transport access of each of the nation's sites on the body, 0..1.
  access: readonly number[]
  // Unrest points from displaced people (state/unrestStore), 0 = none.
  unrest: number
  occupied: boolean
  atWar: boolean
  enemyInOrbit: boolean
  // Funded share (0..1) of healthcare and education; null where the economy has no such setting (Simple mode).
  services: { healthcare: number; education: number } | null
}

export interface QolIndicator {
  id: 'housing' | 'infrastructure' | 'safety' | 'habitability' | 'services' | 'rights'
  label: string
  // 0..1, or null while it cannot be judged.
  value: number | null
  note: string
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
export const UNREST_QOL_PER_POINT = 0.05

export function qualityOfLife(input: QolInput): QolIndicator[] {
  const housing: QolIndicator = (() => {
    if (!input.housing || input.housing.population <= 0) return { id: 'housing', label: 'Housing', value: null, note: 'No settlements to judge' }
    const ratio = input.housing.room / input.housing.population
    return { id: 'housing', label: 'Housing', value: clamp01(ratio), note: ratio >= 1 ? 'Room for everyone' : `Crowded: room for ${Math.round(clamp01(ratio) * 100)}% of the people` }
  })()
  const infrastructure: QolIndicator = input.access.length === 0
    ? { id: 'infrastructure', label: 'Infrastructure', value: null, note: 'No sites to judge' }
    : { id: 'infrastructure', label: 'Infrastructure', value: clamp01(input.access.reduce((n, a) => n + a, 0) / input.access.length), note: 'Average share of output that reaches a hub' }
  const safety = clamp01(1 - Math.min(0.5, input.unrest * UNREST_QOL_PER_POINT) - (input.occupied ? 0.35 : 0) - (input.atWar ? 0.1 : 0) - (input.enemyInOrbit ? 0.15 : 0))
  const safetyNotes = [input.unrest > 0 ? 'unrest from displaced people' : '', input.occupied ? 'occupied' : '', input.atWar ? 'at war' : '', input.enemyInOrbit ? 'an enemy fleet in orbit' : ''].filter(Boolean)
  return [
    housing,
    infrastructure,
    { id: 'safety', label: 'Safety', value: safety, note: safetyNotes.length > 0 ? safetyNotes.join(', ') : 'Peaceful' },
    { id: 'habitability', label: 'Habitability', value: clamp01(input.habitability), note: input.habitability >= 0.99 ? 'A kind world' : 'People spend on life support just to stay alive here' },
    input.services
      ? { id: 'services', label: 'Public services', value: clamp01((input.services.healthcare + input.services.education) / 2), note: `Healthcare ${Math.round(input.services.healthcare * 100)}% and education ${Math.round(input.services.education * 100)}% funded by the state` }
      : { id: 'services', label: 'Public services', value: null, note: 'Not modelled in Simple mode' },
  ]
}

// A nation's quality of life: each indicator averaged over its worlds, weighted by population, then the placeholder row.
export function nationQualityOfLife(worlds: readonly { weight: number; indicators: readonly QolIndicator[] }[]): QolIndicator[] {
  const ids: QolIndicator['id'][] = ['housing', 'infrastructure', 'safety', 'habitability', 'services']
  const out: QolIndicator[] = ids.map((id) => {
    let sum = 0
    let weight = 0
    let label = id as string
    let note = ''
    for (const w of worlds) {
      const ind = w.indicators.find((i) => i.id === id)
      if (!ind) continue
      label = ind.label
      note = ind.note
      if (ind.value === null) continue
      sum += ind.value * w.weight
      weight += w.weight
    }
    return { id, label, value: weight > 0 ? sum / weight : null, note: weight > 0 ? 'Average over its worlds, by population' : note || 'Cannot be judged yet' }
  })
  out.push({ id: 'rights', label: 'Rights & freedoms', value: null, note: 'Needs government systems (not yet in the game)' })
  return out
}
