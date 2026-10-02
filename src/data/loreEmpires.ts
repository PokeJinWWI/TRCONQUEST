// Hand-written empires for the wider galaxy. An entry here REPLACES the
// generated empire in its slot (data/generatedEmpires.ts), so lore can be added
// one empire at a time without touching the generator.
//
// Only `slot`, `id`, `name` and `color` are required. Anything left out keeps
// what the generator gave that slot: leave out `homeStarId` and the empire
// lives where the generated one did; leave out `researched` or `influence` and
// it keeps the generated ones. Stars named here are reserved: no generated
// empire is ever given them. Star ids are those of data/galaxyGen.ts
// (`<neighbourhood id>-s<n>`).
export interface LoreEmpire {
  // Which of the EMPIRE_COUNT slots (0-based) this empire takes.
  slot: number
  id: string
  name: string
  color: string
  homeStarId?: string
  // Every system it owns, home included. Defaults to just the home system
  // when `homeStarId` is given.
  ownedStarIds?: string[]
  // Tech ids (data/techData.ts).
  researched?: string[]
  influence?: number
}

export const LORE_EMPIRES: LoreEmpire[] = []
