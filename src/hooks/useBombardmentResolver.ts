import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { useArmyStore } from '../state/armyStore'
import { useDefenseStore } from '../state/defenseStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useBombardmentStore } from '../state/bombardmentStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore } from '../state/economyStore'
import { atWar, useDiplomacyStore } from '../state/diplomacyStore'
import { warBetweenIn } from '../state/diplomacyStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { economyModel } from '../state/playerStore'
import { bombardmentStep } from '../scene/bombardment'
import { isArmed, orbitedBody } from '../scene/armyLogic'
import { BOMBARD_EXHAUSTION_PER_DAMAGE, BOMBARD_OPINION_PER_DAY, DEFENSE_DEFS } from '../data/defenseData'
import { ownerDisplay } from '../data/countryRoster'

// Orbital bombardment, once per sim-day (scene/bombardment.ts): ships set to
// bombard pour damage onto enemy worlds they hold the orbit of — installations,
// ground units, devastation (pushed into whichever economy the game runs),
// and, at full stance, population. The victim's opinion of the bomber drops and
// its war exhaustion rises. Pure rules there; store I/O here.
const bombarding = new Set<string>() // `${body}|${attacker}` currently under way (for the one-off event)

export function resolveBombardment(fromSimDays: number, toSimDays: number): void {
  const days = Math.floor(toSimDays) - Math.floor(fromSimDays)
  if (days <= 0) return
  const ships = useShipStore.getState().ships
  const hasBombarders = ships.some((s) => s.bombardStance && s.bombardStance !== 'off')
  const bomb = useBombardmentStore.getState()
  if (!hasBombarders && Object.keys(bomb.devastation).length === 0) return

  const territory = useTerritoryStore.getState()
  const installations = useDefenseStore.getState().installations
  const armies = useArmyStore.getState().armies
  const res = bombardmentStep({
    days,
    simDays: toSimDays,
    ships: ships.map((s) => ({
      id: s.id,
      ownerId: s.ownerId,
      bodyName: orbitedBody(s),
      armed: isArmed(s),
      weapons: resolveShipClass(s.classId)?.combat.weapons.length ?? 0,
      stance: s.bombardStance ?? 'off',
    })),
    installations,
    armies,
    devastation: bomb.devastation,
    owners: territory.bodyOwner,
    controllers: territory.bodyController,
    holders: territory.nodeHolders,
    atWar,
  })

  if (res.installations !== installations) useDefenseStore.getState().setInstallations(res.installations)
  if (res.armies !== armies) useArmyStore.getState().setArmies(res.armies, useArmyStore.getState().resolvedThroughStep)
  bomb.update(res.devastation, res.strikes)
  if (economyModel() === 'abstract') useAbstractEconomyStore.getState().setDevastation(res.devastation)
  else useEconomyStore.getState().setDevastation(res.devastation)
  if (Object.keys(res.popLoss).length > 0) {
    if (economyModel() === 'abstract') useAbstractEconomyStore.getState().killPopulation(res.popLoss)
    else useEconomyStore.getState().killPopulation(res.popLoss)
  }

  const diplomacy = useDiplomacyStore.getState()
  const now = new Set<string>()
  for (const strike of res.strikes) {
    const key = `${strike.bodyName}|${strike.attackerId}`
    now.add(key)
    diplomacy.adjustOpinion(strike.victimId, strike.attackerId, BOMBARD_OPINION_PER_DAY * days * (strike.full ? 2 : 1))
    const war = warBetweenIn(diplomacy.wars, strike.attackerId, strike.victimId)
    if (war) diplomacy.addExhaustion(war.id, strike.victimId, strike.damage * BOMBARD_EXHAUSTION_PER_DAMAGE)
    if (!bombarding.has(key)) {
      diplomacy.pushEvent('bombardment', [strike.attackerId, strike.victimId], `${ownerDisplay(strike.attackerId).name} began ${strike.full ? 'a full' : 'an orbital'} bombardment of ${strike.bodyName}`, toSimDays)
    }
  }
  bombarding.clear()
  for (const k of now) bombarding.add(k)
  for (const gone of res.destroyedInstallations) {
    diplomacy.pushEvent('installation-destroyed', [], `${DEFENSE_DEFS[gone.kind].name} on ${gone.bodyName} was destroyed from orbit`, toSimDays)
  }
}

export function useBombardmentResolver() {
  useEffect(() => {
    let last = useGameTimeStore.getState().simDays
    return useGameTimeStore.subscribe((state) => {
      if (state.simDays < last) {
        last = state.simDays
        return
      }
      if (Math.floor(state.simDays) === Math.floor(last)) return
      resolveBombardment(last, state.simDays)
      last = state.simDays
    })
  }, [])
}
