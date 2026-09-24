// What every nation starts the game with — identical for all of them, so the
// demo starts even and any difference comes from play (or the AI's choices),
// not from a lopsided seed. Tuning, not balance-verified; adjust freely.
//
// Ship class ids (see shipData.SHIP_CLASSES), all spawned in orbit around the
// nation's capital and grouped into one fleet there automatically (ships
// resting together at one spot join the same fleet — see shipStore).
// One troop transport so every nation can mount an invasion from day one;
// its starting assault armies are in armyData.STARTING_ASSAULT_ARMIES.
export const STARTING_NAVY: readonly string[] = ['cruiser', 'destroyer', 'destroyer', 'frigate', 'corvette', 'troop-transport']
