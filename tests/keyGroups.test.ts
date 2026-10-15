// The Ground panel's key-node grouping (scene/keyGroups.ts).
//
// Run:  npx tsx tests/keyGroups.test.ts
import { groupKeyNodes } from '../src/scene/keyGroups'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const nodes = [
  { kind: 'city', node: 1, name: 'Tonko', holder: 'b' },
  { kind: 'spaceport', node: 2, name: 'Choan', holder: 'a' },
  { kind: 'capital', node: 3, name: 'Akakyo', holder: 'a' },
  { kind: 'city', node: 4, name: 'Daido', holder: 'a' },
  { kind: 'fortress', node: 5, name: 'Olympus', holder: 'b' },
]
const label = (k: (typeof nodes)[number]) => k.name
const holder = (k: (typeof nodes)[number]) => k.holder
const byType = groupKeyNodes(nodes, 'type', label, holder)
check('by type: capital, city, spaceport, fortress, in that order', byType.map((g) => g.key).join() === 'capital,city,spaceport,fortress')
check('...each group sorted by name with its label', byType[1].items.map((i) => i.name).join() === 'Daido,Tonko' && byType[1].label === 'City')
check('by name: one flat list', groupKeyNodes(nodes, 'name', label, holder).length === 1 && groupKeyNodes(nodes, 'name', label, holder)[0].items.map((i) => i.name).join() === 'Akakyo,Choan,Daido,Olympus,Tonko')
check('by holder: holders together, names within', groupKeyNodes(nodes, 'holder', label, holder)[0].items.map((i) => i.holder).join('') === 'aaabb')
check('nothing is lost', byType.reduce((n, g) => n + g.items.length, 0) === nodes.length)
console.log(failures ? `\n${failures} FAILED` : '\nAll key group checks passed')
process.exit(failures ? 1 : 0)
