// Tuning for the surface route network (scene/infrastructureNet.ts): what a road or a
// railway costs, carries and needs, and how a placed building feels being cut off.
import type { GoodCost, ResourceCost } from './shipyardData'
import type { TerrainId } from './groundData'

export type RouteKind = 'road' | 'rail'
export const ROUTE_KINDS: RouteKind[] = ['road', 'rail']

export interface RouteSpec {
  name: string
  // Freight units per month the route carries.
  capacity: number
  // Per fine cell of length (times the ground's difficulty): what it takes to build and to keep up.
  // Complex mode pays in the economy's goods from the capital stockpile, Simple in strategic resources
  // (the shipyard's dual payment: scene/shipyardLogic.paysFromEconomy), each month of upkeep the same way.
  build: { goods: GoodCost; resources: ResourceCost }
  upkeep: { goods: GoodCost; resources: ResourceCost }
  // Days of work per cell (times the ground's difficulty).
  daysPerCell: number
}

export const ROUTE_SPECS: Record<RouteKind, RouteSpec> = {
  road: {
    name: 'Road',
    capacity: 30,
    build: { goods: { concrete: 2, tools: 0.4 }, resources: { minerals: 4 } },
    upkeep: { goods: { concrete: 0.05 }, resources: { minerals: 0.1 } },
    daysPerCell: 6,
  },
  rail: {
    name: 'Railway',
    capacity: 120,
    build: { goods: { steel: 3, concrete: 1.5, tools: 0.6 }, resources: { minerals: 6, alloys: 2 } },
    upkeep: { goods: { steel: 0.06, concrete: 0.03 }, resources: { minerals: 0.15, alloys: 0.05 } },
    daysPerCell: 10,
  },
}

// How hard a patch of ground is to build across (1 = open plain).
export const ROUTE_DIFFICULTY: Record<TerrainId, number> = {
  plains: 1,
  desert: 1.1,
  forest: 1.5,
  tundra: 1.3,
  plateau: 1.4,
  rock: 1.2,
  mountains: 3,
  urban: 0.8,
  industrial: 0.9,
  mining: 1.3,
  farmland: 1,
  aerostat: 1,
  ocean: Infinity,
  lava: Infinity,
  cloud: Infinity,
}

// Freight a placed building slot sends to the nearest hub each month (what it needs carried).
export const FREIGHT_PER_SLOT = 10

// A site within this many cells of a hub (a spaceport or a city) needs no route: the local
// roads every settlement has (the base infrastructure of economy/transport.INFRA_BASE).
export const LOCAL_ACCESS_CELLS = 6

// How much of its output a placed building produces with no way to its hub.
export const ISOLATION_FACTOR = 0.5
// A route in disrepair (upkeep unpaid) carries this share of its capacity.
export const DISREPAIR_FACTOR = 0.5

// A placed building on a site an enemy's ground forces hold produces nothing for its owner while they hold it.
export const CAPTURED_FACTOR = 0
