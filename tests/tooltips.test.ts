// Verification of the hover-tooltip glossary and the history charts' axes
// (both economy modes).
// Run:  npx tsx tests/tooltips.test.ts

import { glossaryLookup, normalizeTerm } from '../src/data/glossary'
import { monthTicks, niceTicks } from '../src/components/TimeChart'
import { resolveTooltip, titledChain, type TipNode } from '../src/components/TooltipLayer'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('=== 1. Glossary lookup ===')
{
  check('"Tax rate" explains taxes', glossaryLookup('Tax rate')?.term === 'Tax rate')
  check('matching ignores case and a trailing colon', glossaryLookup('TAX RATE:')?.term === 'Tax rate')
  check('bracketed bits are ignored', glossaryLookup('War taxes (active)')?.term === 'War taxes' && glossaryLookup('GDP (USD)')?.term === 'GDP')
  check('arrows are ignored', glossaryLookup('▸ Unemployed')?.term === 'Unemployed')
  check('aliases resolve', glossaryLookup('Debt/GDP')?.term === 'Debt-to-GDP' && glossaryLookup('DEBT / GDP')?.term === 'Debt-to-GDP')
  check('nav categories are explained', ['Economy', 'Government', 'Diplomacy', 'Military', 'Technology', 'Society'].every((t) => !!glossaryLookup(t)))
  check('both modes\' key concepts are there', ['Stability', 'Approval', 'Inflation', 'Credit rating', 'Production Units', 'Interest rate', 'Broad money (M2)', 'Exchange rate'].every((t) => !!glossaryLookup(t)))
  check('numbers attached to a label are ignored', glossaryLookup('Inflation 2.78%')?.term === 'Inflation' && glossaryLookup('GDP $70.95B')?.term === 'GDP' && glossaryLookup('Research 7.9/mo')?.term === 'Research')
  check('unknown text matches nothing', glossaryLookup('Mars') === undefined && glossaryLookup('1st Fleet') === undefined)
  check('normalizeTerm collapses whitespace', normalizeTerm('  Real   growth ') === 'real growth')
}

console.log('\n=== 2. Chart y axis: round-number ticks ===')
{
  const t = niceTicks(0, 9.3)
  check('ticks span the range in round steps', t[0] === 0 && t[t.length - 1] <= 9.3 && t.length >= 3 && t.length <= 6, t.join(', '))
  const m = niceTicks(1234, 5678)
  check('large ranges get round steps', m.every((v) => v % 500 === 0 || v % 1000 === 0), m.join(', '))
  const small = niceTicks(0.018, 0.031)
  check('small ranges work too', small.length >= 2 && small.every((v) => v >= 0.018 - 1e-12 && v <= 0.031 + 1e-12), small.join(', '))
  check('a flat range yields one tick', niceTicks(5, 5).length === 1)
}

console.log('\n=== 3. Chart x axis: month ticks ===')
{
  // 7 samples (6 months) from the start of the game.
  const six = monthTicks(0, 7, 1)
  check('six months show a tick for every month', six.length >= 6 && six.length <= 7, six.map((t) => t.label).join(' | '))
  check('the first tick carries the year', /\d\d$/.test(six[0].label))
  check('no month is skipped (February included)', six.some((t) => t.label.startsWith('Feb')))
  check('months are in order and distinct', new Set(six.map((t) => t.label)).size === six.length)
  const year = monthTicks(0, 13, 2)
  check('a year shows every other month', year.length >= 6 && year.length <= 7, year.map((t) => t.label).join(' | '))
  const span = monthTicks(20, 7, 1)
  check('January is labelled with its year', span.some((t) => t.label.startsWith('Jan ')), span.map((t) => t.label).join(' | '))
  check('ticks move as months pass', monthTicks(1, 7, 1)[0].label !== monthTicks(0, 7, 1)[0].label || monthTicks(1, 7, 1).length !== monthTicks(0, 7, 1).length)
}

console.log('\n=== 4. One tooltip system: one box, never a native one beside it ===')
{
  // A minimal element tree (what resolveTooltip reads).
  const node = (tagName: string, attrs: Record<string, string> = {}, text = '', children: TipNode[] = []): TipNode => {
    const n: TipNode = { tagName, parentElement: null, childElementCount: children.length, textContent: text || children.map((c) => c.textContent).join(''), getAttribute: (a) => attrs[a] ?? null }
    for (const c of children) (c as { parentElement: TipNode | null }).parentElement = n
    return n
  }
  // The Stability meter: <div title=…><div><span>Stability</span><span>55%</span></div>…</div>
  const label = node('SPAN', {}, 'Stability')
  const value = node('SPAN', {}, '55%')
  const head = node('DIV', {}, '', [label, value])
  const meter = node('DIV', { title: 'Order and contentment — see the Social tab.' }, '', [head, node('DIV')])
  node('DIV', { class: 'panel' }, '', [meter])
  const src = resolveTooltip(label)
  check('hovering "Stability" in a titled meter takes over the meter\'s title (so no native tooltip beside ours)', src?.titleEl === meter && src.title?.startsWith('Order') === true)
  check('...and shows the glossary entry in the same box', src?.entry?.term === 'Stability')
  check('...anchored on the meter, so moving to its value keeps the one tooltip', src?.anchor === meter && resolveTooltip(value)?.anchor === meter)
  // A title far up the tree is still found (the browser would show it natively).
  let deep: TipNode = node('SPAN', {}, 'x')
  const leaf = deep
  for (let i = 0; i < 10; i++) deep = node('DIV', {}, '', [deep])
  const top = node('DIV', { title: 'Far away' }, '', [deep])
  check('the nearest title is found however deep', resolveTooltip(leaf)?.titleEl === top)
  // A title already taken over (data-tip) still counts; data-tooltip (SVG) too.
  check('a stashed title (data-tip) still shows', resolveTooltip(node('DIV', { 'data-tip': 'Stashed' }))?.title === 'Stashed')
  check('data-tooltip (styled-only, for SVG) shows', resolveTooltip(node('g', { 'data-tooltip': 'A tech' }))?.title === 'A tech')
  // The glossary never climbs out of a button into its container.
  const btn = node('BUTTON', {}, '', [node('SPAN', {}, 'Go')])
  node('DIV', {}, 'Stability', [btn])
  check('glossary lookup stops at a control', resolveTooltip(btn) === null)
  check('nothing inside the tooltip box itself', resolveTooltip(node('DIV', { class: 'game-tooltip', title: 't' })) === null)
  check('plain text with no title or term gets nothing', resolveTooltip(node('SPAN', {}, 'Mars')) === null)

  // The double-tooltip bug: a titled button inside a titled window. Lifting only
  // the button's title left the window's for the browser to show a moment later.
  const button = node('BUTTON', { title: 'Build for 12 days' }, 'Build')
  const row = node('DIV', {}, '', [button])
  const windowEl = node('DIV', { title: 'Shipyard window' }, '', [row])
  node('DIV', { title: 'Whole page' }, '', [windowEl])
  check('resolveTooltip shows only the nearest title', resolveTooltip(button)?.titleEl === button)
  const chain = titledChain(button)
  check('...but every titled element above the pointer has to be lifted', chain.length === 3 && chain[0] === button, `${chain.length} titled`)
  check('an untitled tree has nothing to lift', titledChain(node('SPAN', {}, 'x')).length === 0)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
