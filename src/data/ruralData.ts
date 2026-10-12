// Tuning for rural life (scene/ruralLife.ts): the people who live on the land outside any district, shown as scattered homesteads
// and farmsteads. Nothing here is stored: it follows from a world's population and what it grows.

// Share of a world's people who live in the countryside: a floor, plus more the larger the farming share of its developed land.
export const RURAL_BASE_SHARE = 0.1
export const RURAL_FARMING_SHARE = 0.5
export const RURAL_MAX_SHARE = 0.6

// Each mark on the map stands for about this many million rural people (a cluster of homesteads and farmsteads).
export const MILLION_PEOPLE_PER_MARK = 2
// The map draws at most this many.
export const MAX_RURAL_MARKS = 400
