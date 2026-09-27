// Named-feature codes in the real-map data (data/bodyTopography.ts), from the
// IAU Gazetteer of Planetary Nomenclature: what a node sits on, when it matters
// for its terrain. Index 0 = nothing named.
export const FEATURE_CODES = ['none', 'mountain', 'volcano', 'sea', 'plain'] as const
export type FeatureCode = (typeof FEATURE_CODES)[number]
