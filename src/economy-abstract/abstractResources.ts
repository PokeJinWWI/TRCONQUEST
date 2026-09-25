import type { ResourceId } from '../data/resourceData'
import type { AbstractReport } from './abstractEconomy'

// Stage 3 payment link: the abstract economy's PRODUCTION becomes the strategic
// resources ships and armies are paid for with (resourceStore). Military output
// makes alloys (the war material), civilian output makes energy and minerals,
// consumer output feeds the population, and GDP yields a trickle of the exotic
// strategic goods. So how the player splits production directly governs what
// they can build — raise Military and alloys flow, and the fleet can grow.
//
// Calibrated so the DEFAULT seed allocation lands near the old flat placeholder
// income (energy 200, minerals 150, alloys 60, exotic 6, hyperium 1 per month),
// and scales from there with the player's sliders.
export function abstractResourceFlows(r: AbstractReport, gdp: number): Partial<Record<ResourceId, number>> {
  return {
    alloys: r.militaryProduction * 0.09,
    energy: r.civilianProduction * 0.12,
    minerals: (r.civilianProduction + r.militaryProduction) * 0.06,
    consumerGoods: r.consumerProduction * 0.05,
    food: r.consumerProduction * 0.05,
    exoticMatter: gdp * 0.00075,
    hyperium: gdp * 0.000125,
    special: 0,
  }
}
