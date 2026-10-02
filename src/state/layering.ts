// One shared stacking counter for everything that floats over the map (HUD
// windows, popup menus): whatever was clicked last gets the highest layer, so
// e.g. opening Map Modes after selecting something puts it above that window.
// Plain module state (not a store): nothing reads it reactively.
let top = 20
export function bringToFrontZIndex(): number {
  top += 1
  return top
}
