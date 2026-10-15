// Every nation opens "ready to play" (Complex mode): no massive overproduction, jobs staffed, the budget near balance, nobody in a slump.
// The numbers come from scripts/economy/startAudit.ts (two years of a real game: the nations' AI on). The seed's plants are fitted to what is
// wanted by scripts/economy/calibrate.ts (the "fit" stage: mothballed plants in economy/seedCalibration.ts); rerun it when the seed or the tick
// changes. Before the fit, 24-37% of everything a nation made was beyond what anyone wanted.
//
// Run:  npx tsx tests/startEconomy.test.ts
import { auditNations } from '../scripts/economy/startAudit'
import { SEED_CALIBRATION } from '../src/economy/seedCalibration'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== The starting economies ===')
{
  check('the calibration fitted mothballed plants for the nations\' worlds', Object.values(SEED_CALIBRATION).filter((w) => Object.keys(w.idle ?? {}).length > 0).length >= 4)
  const audits = auditNations(24)
  check('all five nations are audited', audits.length === 5, audits.map((a) => a.id).join(', '))
  for (const a of audits) {
    const tag = a.id.slice(0, 14)
    check(`${tag}: no more than a quarter of what it makes is beyond what is wanted`, a.surplusValueShare <= 0.25, `${(a.surplusValueShare * 100).toFixed(0)}% (it used to be 24-37%)`)
    check(`${tag}: at most a handful of goods pile up unsold`, a.over.length <= 8, `${a.over.length}: ${a.over.map((r) => r.good).join(', ')}`)
    check(`${tag}: nine in ten of the labour force is in work`, a.employment >= 0.88, `${(a.employment * 100).toFixed(1)}%`)
    check(`${tag}: the budget is near balance (deficit under 8%, surplus under 15% of GDP)`, a.balancePctGdp >= -0.08 && a.balancePctGdp <= 0.15, `${(a.balancePctGdp * 100).toFixed(1)}%`)
    check(`${tag}: people live decently (average standard of living over 55%)`, a.avgSoL >= 0.55, `${(a.avgSoL * 100).toFixed(0)}%`)
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nAll start economy checks passed')
process.exit(failures ? 1 : 0)
