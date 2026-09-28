// Subjects as a gameplay action: releasing a world you own as a brand-new
// subject nation (e.g. releasing the Moon from Mars as a vassal "Kingdom of
// Luna"), and the day-to-day subject actions (independence, changing type,
// granting a separate market). Mirrors peace.ts's split: pure rule here,
// store I/O funneled through this one file.
import { getCountry, registerCountry, type Country } from '../data/countryData'
import { SUBJECT_OFFER_MIN_OPINION, SUBJECT_OFFER_MIN_POWER_RATIO, type SubjectType } from '../data/subjectData'
import { useDiplomacyStore, relationIn } from '../state/diplomacyStore'
import { useSubjectStore, suzerainOf } from '../state/subjectStore'
import { useTerritoryStore } from '../state/territoryStore'
import { bodyStarId } from './territory'

export type ReleaseSubjectResult = { ok: true; subjectId: string } | { ok: false; reason: string }

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'new-nation'
}

// A small deterministic palette so a released nation doesn't clash with its
// suzerain's own color — hashed from the id, so the same name always gets
// the same color within a session.
const RELEASE_COLORS = ['#b98ad1', '#d1b98a', '#8ad1c0', '#d18a9e', '#a0d18a', '#8aa8d1']
function colorFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return RELEASE_COLORS[Math.abs(hash) % RELEASE_COLORS.length]
}

// Releases `bodyName` (which `suzerainId` must currently own and hold, and
// which can't be its capital) as a new nation of `name`, immediately made a
// `type` subject of `suzerainId`. Registers the new nation into COUNTRIES
// (see data/countryData.registerCountry) so every panel, the AI, and army
// homecoming treat it exactly like any founding nation from here on.
export function releaseAsSubject(suzerainId: string, bodyName: string, name: string, type: SubjectType, simDays: number): ReleaseSubjectResult {
  const territory = useTerritoryStore.getState()
  if (territory.bodyOwner[bodyName] !== suzerainId) return { ok: false, reason: 'You do not own that world' }
  if (territory.bodyController[bodyName] && territory.bodyController[bodyName] !== suzerainId) {
    return { ok: false, reason: 'That world is under enemy occupation' }
  }
  const suzerain = getCountry(suzerainId)
  if (!suzerain) return { ok: false, reason: 'Unknown nation' }
  if (suzerain.capitalBodyName === bodyName) return { ok: false, reason: 'You cannot release your own capital' }
  const starId = bodyStarId(bodyName)
  if (!starId) return { ok: false, reason: 'Unknown star system' }
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'Name required' }

  let id = slugify(trimmed)
  if (getCountry(id)) id = `${id}-${Math.round(simDays)}`
  const nation: Country = { id, name: trimmed, color: colorFor(id), capitalStarId: starId, capitalBodyName: bodyName }
  registerCountry(nation)
  territory.cedeBody(bodyName, id)
  useSubjectStore.getState().establishSubject(suzerainId, id, type, simDays)
  useDiplomacyStore.getState().pushEvent('body-ceded', [suzerainId, id], `${suzerain.name} released ${bodyName} as the ${trimmed}, a ${type}`, simDays)
  return { ok: true, subjectId: id }
}

// Whether `suzerainId` could offer subjection to `targetId` right now with no
// war: needs a decisive power edge and the target not to already hate them.
// (Pure threshold check — mirrors evaluatePeace's shape. `power` maps a
// countryId to whatever strength figure the caller is using, e.g. fleet
// power.) Used by both the player's UI and the AI's diplomat.
export function canOfferSubjection(suzerainId: string, targetId: string, power: Map<string, number>): boolean {
  const suzerainPower = power.get(suzerainId) ?? 0
  const targetPower = power.get(targetId) ?? 0
  if (targetPower > 0 && suzerainPower / targetPower < SUBJECT_OFFER_MIN_POWER_RATIO) return false
  if (targetPower === 0 && suzerainPower === 0) return false
  const opinion = relationIn(useDiplomacyStore.getState().relations, suzerainId, targetId).opinion
  return opinion >= SUBJECT_OFFER_MIN_OPINION
}

// Grants independence: the subject leaves its suzerain's hierarchy with no
// other change (territory, market and diplomacy stay as they are).
export function grantIndependence(subjectId: string, simDays: number): void {
  const suzerainId = suzerainOf(useSubjectStore.getState().subjections, subjectId)
  useSubjectStore.getState().releaseSubject(subjectId, simDays)
  if (suzerainId) {
    useDiplomacyStore.getState().pushEvent('peace-signed', [suzerainId, subjectId], `${getCountry(suzerainId)?.name ?? suzerainId} granted independence to ${getCountry(subjectId)?.name ?? subjectId}`, simDays)
  }
}
