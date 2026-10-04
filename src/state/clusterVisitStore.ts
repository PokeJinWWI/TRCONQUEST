import { create } from 'zustand'
import { SOLAR_NEIGHBORHOOD_ID } from '../data/galaxyGen'

// Which clusters each nation has visited: one of its ships rested beside it
// (hooks/useSurveyResolver records it). A nation's own neighbourhood always counts.
// What Turing Scouts' Auto-explore reads for the Intercluster scope
// (scene/autoExplore.ts); it holds nothing about what is IN a cluster.
interface ClusterVisitState {
  visited: Record<string, ReadonlySet<string>>
  markVisited: (nationId: string, clusterId: string) => void
  isVisited: (nationId: string, clusterId: string) => boolean
}

export const useClusterVisitStore = create<ClusterVisitState>((set, get) => ({
  visited: {},
  markVisited: (nationId, clusterId) => {
    if (clusterId === SOLAR_NEIGHBORHOOD_ID || get().visited[nationId]?.has(clusterId)) return
    set((s) => ({ visited: { ...s.visited, [nationId]: new Set(s.visited[nationId] ?? []).add(clusterId) } }))
  },
  isVisited: (nationId, clusterId) => clusterId === SOLAR_NEIGHBORHOOD_ID || !!get().visited[nationId]?.has(clusterId),
}))
