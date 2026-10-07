// The cluster a nation calls home: the one its capital star is in. Null for no nation
// (the sandbox's player faction has no capital, so no "home").
import { getCountry } from '../data/countryData'
import { clusterOfStar } from './clusters'

export function homeClusterOf(countryId: string | null | undefined): string | null {
  const country = countryId ? getCountry(countryId) : undefined
  return country ? clusterOfStar(country.capitalStarId) : null
}
