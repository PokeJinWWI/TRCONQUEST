import { create } from 'zustand'
import { getOrgPreset, type InternationalOrg, type OrgPillar } from '../data/internationalOrgData'

// Live international organizations — session-only, like every other store
// here. A nation may belong to more than one organization at once (e.g. a
// trade organization and a separate defense alliance).

interface InternationalOrgState {
  orgs: InternationalOrg[]
  founded: (leaderId: string, presetId: string, name: string, simDays: number) => string
  join: (orgId: string, countryId: string) => void
  leave: (orgId: string, countryId: string) => void
  setDelegatedCommand: (orgId: string, memberId: string, delegated: boolean) => void
  disband: (orgId: string) => void
  reset: () => void
}

let orgCounter = 0

export const useInternationalOrgStore = create<InternationalOrgState>((set) => ({
  orgs: [],

  founded: (leaderId, presetId, name, simDays) => {
    orgCounter += 1
    const preset = getOrgPreset(presetId)
    const id = `org-${orgCounter}-${Math.round(simDays)}`
    const org: InternationalOrg = {
      id,
      presetId,
      name,
      leaderId,
      memberIds: [leaderId],
      pillars: preset.pillars,
      authorityModel: preset.authorityModel,
      foundedSimDays: simDays,
      delegatedCommand: {},
    }
    set((s) => ({ orgs: [...s.orgs, org] }))
    return id
  },

  join: (orgId, countryId) =>
    set((s) => ({
      orgs: s.orgs.map((o) => (o.id === orgId && !o.memberIds.includes(countryId) ? { ...o, memberIds: [...o.memberIds, countryId] } : o)),
    })),

  leave: (orgId, countryId) =>
    set((s) => ({
      orgs: s.orgs
        .map((o) =>
          o.id === orgId
            ? {
                ...o,
                memberIds: o.memberIds.filter((id) => id !== countryId),
                delegatedCommand: { ...o.delegatedCommand, [countryId]: false },
                leaderId: o.leaderId === countryId ? (o.memberIds.find((id) => id !== countryId) ?? o.leaderId) : o.leaderId,
              }
            : o,
        )
        .filter((o) => o.memberIds.length > 0),
    })),

  setDelegatedCommand: (orgId, memberId, delegated) =>
    set((s) => ({
      orgs: s.orgs.map((o) => (o.id === orgId ? { ...o, delegatedCommand: { ...o.delegatedCommand, [memberId]: delegated } } : o)),
    })),

  disband: (orgId) => set((s) => ({ orgs: s.orgs.filter((o) => o.id !== orgId) })),

  reset: () => set({ orgs: [] }),
}))

export function orgsOf(orgs: InternationalOrg[], countryId: string): InternationalOrg[] {
  return orgs.filter((o) => o.memberIds.includes(countryId))
}

// True if `a` and `b` share any organization that carries `pillar`.
export function shareOrgPillar(orgs: InternationalOrg[], a: string, b: string, pillar: OrgPillar): boolean {
  return orgs.some((o) => o.pillars.includes(pillar) && o.memberIds.includes(a) && o.memberIds.includes(b))
}

// Whether `leaderId` may command `ownerId`'s fleets — the org leader, with
// the joint-command pillar, and only for a member who opted in.
export function canCommand(orgs: InternationalOrg[], leaderId: string, ownerId: string): boolean {
  if (leaderId === ownerId) return true
  return orgs.some(
    (o) => o.leaderId === leaderId && o.pillars.includes('joint-command') && o.memberIds.includes(ownerId) && o.delegatedCommand[ownerId] === true,
  )
}
