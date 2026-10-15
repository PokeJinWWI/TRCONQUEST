// Dev-only (main.tsx loads it only when import.meta.env.DEV, so a production build never contains it): every zustand store on `window.__trc`,
// for driving the game from the browser tool without editing main.tsx.
//
//   __trc.stores.player.getState().selectCountry('imperial-state-of-mars')     (name = file name without "Store")
//   __trc.stores.view.getState().enterGround('Mars')
//   await __trc.load('scene/standalone')                                        (any module under src/, as an ES module)
//   __trc.start('complex' | 'abstract', 'imperial-state-of-mars')               (pick the mode and the nation)
//   window.__trcScene                                                           ({camera, canvasSize, controls, GLOBE_RADIUS} of the open ground globe)
type AnyStore = { getState: () => unknown }
const modules = import.meta.glob('./state/*Store.ts', { eager: true }) as Record<string, Record<string, unknown>>
const stores: Record<string, AnyStore> = {}
for (const [path, mod] of Object.entries(modules)) {
  const key = path.replace('./state/', '').replace(/Store\.ts$/, '')
  for (const value of Object.values(mod)) {
    if (typeof value === 'function' && typeof (value as unknown as AnyStore).getState === 'function') {
      stores[key] = value as unknown as AnyStore
      break
    }
  }
}
const base = import.meta.env.BASE_URL.replace(/\/$/, '')
const api = {
  stores,
  load: (path: string) => import(/* @vite-ignore */ `${base}/src/${path.replace(/^\//, '').replace(/\.tsx?$/, '')}.ts`),
  start: (mode: 'complex' | 'abstract', nation: string) => {
    const player = stores.player.getState() as { setEconomyModel: (m: string) => void; selectCountry: (id: string) => void }
    player.setEconomyModel(mode)
    player.selectCountry(nation)
  },
}
;(window as unknown as { __trc: typeof api }).__trc = api
