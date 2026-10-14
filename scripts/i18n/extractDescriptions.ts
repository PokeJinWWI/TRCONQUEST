// Lists the game's data descriptions that have no translation yet, for scripts/i18n/desc/*.json.
//   npx tsx scripts/i18n/extractDescriptions.ts [techs|resources|starbases|landmarks|recipes|simple|glossary]
import { readdirSync, readFileSync } from 'node:fs'
import { ALL_TECHS } from '../../src/data/techData'
import { RESOURCE_TYPES } from '../../src/data/resourceData'
import { STARBASE_MODULES, STARBASE_TIERS } from '../../src/data/starbaseData'
import { RECIPES } from '../../src/economy/recipes'
import * as Simple from '../../src/data/simplisticEconomyData'
import * as Landmarks from '../../src/data/landmarks'
import { glossaryEntries } from '../../src/data/glossary'

const done = new Set<string>()
for (const f of readdirSync('scripts/i18n/desc')) for (const e of JSON.parse(readFileSync(`scripts/i18n/desc/${f}`, 'utf8')) as { en: string }[]) done.add(e.en)
const pick = (o: unknown, out: string[], depth = 0) => {
  if (depth > 4 || !o || typeof o !== 'object') return
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if ((k === 'description' || k === 'text') && typeof v === 'string') out.push(v)
    else pick(v, out, depth + 1)
  }
}
const sets: Record<string, () => string[]> = {
  techs: () => ALL_TECHS.map((t) => t.description).filter(Boolean) as string[],
  resources: () => RESOURCE_TYPES.map((r) => r.description),
  starbases: () => { const o: string[] = []; pick(STARBASE_MODULES, o); pick(STARBASE_TIERS, o); return o },
  landmarks: () => { const o: string[] = []; pick(Landmarks, o); return o },
  recipes: () => { const o: string[] = []; pick(RECIPES, o); return o },
  simple: () => { const o: string[] = []; pick(Simple, o); return o },
  glossary: () => glossaryEntries().map((e) => e.text),
}
const which = process.argv[2] ?? 'techs'
const list = [...new Set(sets[which]())].filter((s) => s && !done.has(s))
console.log(JSON.stringify(list, null, 0))
