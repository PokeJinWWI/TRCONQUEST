// What every nation starts the game with — identical for all of them, so the
// demo starts even and any difference comes from play (or the AI's choices),
// not from a lopsided seed. Tuning, not balance-verified; adjust freely.
//
// Ship class ids (see shipData.SHIP_CLASSES), all spawned in orbit around the
// nation's capital. The warships start as one fleet (scene/gameSetup.ts), the
// troop transport as its own.
// The Corvette is the only warship a nation can build at the start (the larger hulls
// are research: techData's hull ladder), so it is the only one it starts with.
// One troop transport so every nation can mount an invasion from day one;
// its starting assault armies are in armyData.STARTING_ASSAULT_ARMIES.
export const STARTING_NAVY: readonly string[] = ['corvette', 'corvette', 'corvette', 'corvette', 'corvette', 'troop-transport']
