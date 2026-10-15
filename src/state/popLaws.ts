// Laws on who works (economy/popRules.ts), one door for both economies: read a nation's laws, change one. Complex keeps them on the
// Country, Simple on the nation's economy state; the rules and the panel are the same.
import { DEFAULT_POP_LAWS, popLawsOrDefault, type PopLaws } from '../economy/popRules'
import { useAbstractEconomyStore } from './abstractEconomyStore'
import { useEconomyStore } from './economyStore'
import { isAbstractEconomy } from './playerStore'

export function popLawsOf(countryId: string): PopLaws {
  if (isAbstractEconomy()) return popLawsOrDefault(useAbstractEconomyStore.getState().byCountry[countryId]?.popLaws)
  return popLawsOrDefault(useEconomyStore.getState().countries.find((c) => c.id === countryId)?.popLaws)
}

export function setPopLaw(countryId: string, key: keyof PopLaws, value: string): void {
  if (isAbstractEconomy()) useAbstractEconomyStore.getState().setPopLaw(countryId, key, value)
  else useEconomyStore.getState().setPopLaw(countryId, key, value)
}

// The laws as the panel reads them, re-rendering when they change.
export function usePopLaws(countryId: string): PopLaws {
  const simple = isAbstractEconomy()
  const simpleLaws = useAbstractEconomyStore((s) => s.byCountry[countryId]?.popLaws)
  const complexLaws = useEconomyStore((s) => s.countries.find((c) => c.id === countryId)?.popLaws)
  return popLawsOrDefault(simple ? simpleLaws : complexLaws) ?? DEFAULT_POP_LAWS
}
