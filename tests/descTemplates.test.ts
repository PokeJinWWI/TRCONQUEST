import { setDescriptionTable, descriptionOf } from '../src/i18n/descriptionLookup'
import { DESCRIPTIONS } from '../src/i18n/descriptions'
let fails = 0
const check = (n: string, ok: boolean) => { if (!ok) { fails++; console.log('FAIL', n) } else console.log('ok', n) }
setDescriptionTable(DESCRIPTIONS)
const t = 'Each card is a place on Venus.  Press + Build here on any of yours: the district it needs is developed for you. Room for 10 more district levels on this world.'
check('template ja', descriptionOf(t, 'ja')?.includes('Venus上') === true && descriptionOf(t, 'ja')?.includes('10地区') === true)
check('singular', descriptionOf(t.replace('10 more district levels', '1 more district level'), 'zh-Hans')?.includes('1个') === true)
check('no room clause', !!descriptionOf('Each card is a place on Mars. Press + Build here on any of yours: the district it needs is developed for you.', 'zh-Hant'))
check('unknown', descriptionOf('Something else entirely that is not a description at all, honestly.', 'ja') === undefined)
if (fails) process.exit(1)
