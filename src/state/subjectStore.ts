import { create } from 'zustand'
import { type SubjectType, type Subjection } from '../data/subjectData'

// Live subject relationships — session-only, like every other store here.
// A nation appears as a subject of at most one suzerain at a time; nothing
// stops a suzerain from having several subjects.

interface SubjectState {
  subjections: Subjection[]
  establishSubject: (suzerainId: string, subjectId: string, type: SubjectType, simDays: number) => void
  releaseSubject: (subjectId: string, simDays: number) => void
  changeSubjectType: (subjectId: string, type: SubjectType) => void
  setSeparateMarket: (subjectId: string, separateMarket: boolean) => void
  reset: () => void
}

export const useSubjectStore = create<SubjectState>((set) => ({
  subjections: [],

  establishSubject: (suzerainId, subjectId, type, simDays) =>
    set((s) => ({
      subjections: [
        ...s.subjections.filter((sub) => sub.subjectId !== subjectId),
        { suzerainId, subjectId, type, sinceSimDays: simDays, separateMarket: false },
      ],
    })),

  releaseSubject: (subjectId) => set((s) => ({ subjections: s.subjections.filter((sub) => sub.subjectId !== subjectId) })),

  changeSubjectType: (subjectId, type) =>
    set((s) => ({ subjections: s.subjections.map((sub) => (sub.subjectId === subjectId ? { ...sub, type } : sub)) })),

  setSeparateMarket: (subjectId, separateMarket) =>
    set((s) => ({ subjections: s.subjections.map((sub) => (sub.subjectId === subjectId ? { ...sub, separateMarket } : sub)) })),

  reset: () => set({ subjections: [] }),
}))

export function subjectionOf(subjections: Subjection[], subjectId: string): Subjection | undefined {
  return subjections.find((sub) => sub.subjectId === subjectId)
}

export function suzerainOf(subjections: Subjection[], subjectId: string): string | undefined {
  return subjectionOf(subjections, subjectId)?.suzerainId
}

export function subjectsOf(subjections: Subjection[], suzerainId: string): Subjection[] {
  return subjections.filter((sub) => sub.suzerainId === suzerainId)
}

// True if `a` is a subject of `b`, or `b` is a subject of `a` (order doesn't
// matter to callers that just want "these two are in one hierarchy").
export function isSubjectOf(a: string, b: string): boolean {
  const subjections = useSubjectStore.getState().subjections
  return subjectionOf(subjections, a)?.suzerainId === b || subjectionOf(subjections, b)?.suzerainId === a
}
