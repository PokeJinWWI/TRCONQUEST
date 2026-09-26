// The game's glossary: plain-language explanations of concepts and screens,
// shown as hover tooltips (components/TooltipLayer.tsx) on any short label
// whose text is one of these terms — "Tax rate", "GDP", "Stability", a nav
// button… — in both economy modes. Keys are matched case-insensitively after
// stripping punctuation and anything in brackets (see glossaryLookup). Keep
// the text true for BOTH modes, or say which mode it's about.

export interface GlossaryEntry {
  term: string
  text: string
}

const ENTRIES: { terms: string[]; term: string; text: string }[] = [
  // --- National accounts ---------------------------------------------------------
  { terms: ['gdp', 'gdp (usd)', 'gross domestic product', 'nominal gdp', 'nominal'], term: 'GDP', text: "Gross domestic product — the value of everything a nation produces in a year. The main measure of how big an economy is. 'Nominal' GDP is measured in today's prices, so inflation alone makes it grow." },
  { terms: ['real gdp', 'real'], term: 'Real GDP', text: 'GDP measured in starting prices, with inflation stripped out. It only grows when the nation actually produces more.' },
  { terms: ['real growth', 'growth'], term: 'Real growth', text: 'How fast real GDP is growing, per year. Positive means the economy is really getting bigger; negative is a recession.' },
  { terms: ['nominal growth'], term: 'Nominal growth', text: 'How fast GDP is growing in current prices — real growth plus inflation.' },
  { terms: ['inflation', 'inflation (per year)'], term: 'Inflation', text: 'How fast prices are rising, per year. A little (around 2%) is normal. High inflation makes people unhappy, erodes savings and weakens the currency. Printing money to cover a deficit is the usual cause.' },
  { terms: ['deflation'], term: 'Deflation', text: 'Falling prices. Sounds nice, but it usually means demand has collapsed and makes debts heavier.' },
  { terms: ['price level', 'cpi', 'price level (cpi, 1.00 = base)'], term: 'Price level', text: 'How expensive things are compared to the start of the game (1.00). It rises with inflation.' },
  { terms: ['output gap'], term: 'Output gap', text: 'How far the economy is running above or below its normal capacity. Above capacity tends to push inflation up; below means idle resources.' },
  // --- Budget ----------------------------------------------------------------------
  { terms: ['tax rate', 'tax', 'taxes'], term: 'Tax rate', text: "The share of the economy's income the state collects. Taxes pay for everything the government does — the military, services, welfare, interest on debt. Higher taxes mean more revenue, but take money out of people's and businesses' pockets." },
  { terms: ['income tax'], term: 'Income tax', text: "Tax on people's wages and earnings — usually a state's biggest source of revenue." },
  { terms: ['business tax', 'corporate tax'], term: 'Business tax', text: "Tax on companies' profits." },
  { terms: ['excise'], term: 'Excise', text: 'Taxes on specific goods (fuel, luxuries…) collected when they are sold.' },
  { terms: ['war taxes'], term: 'War taxes', text: 'Emergency wartime taxes: more revenue, but people resent them — a standing hit to happiness/stability.' },
  { terms: ['revenue', 'rev'], term: 'Revenue', text: 'Money the state takes in — mostly taxes.' },
  { terms: ['expenditure', 'spending', 'exp'], term: 'Expenditure', text: 'Money the state spends: the military, civil services, welfare, and interest on its debt.' },
  { terms: ['balance', 'yearly balance', 'budget balance'], term: 'Budget balance', text: 'Revenue minus spending. Positive is a surplus (money left over); negative is a deficit that has to be borrowed or printed.' },
  { terms: ['deficit'], term: 'Deficit', text: 'Spending more than you take in. The gap is covered by borrowing (debt) or printing money (inflation).' },
  { terms: ['surplus'], term: 'Surplus', text: 'Taking in more than you spend. The extra can pay down debt or build up reserves.' },
  { terms: ['treasury', 'government pool (treasury)'], term: 'Treasury', text: "The state's cash on hand. If it would go negative, the shortfall is borrowed or printed." },
  { terms: ['reserves'], term: 'Reserves', text: 'A savings buffer kept aside in good times, to draw on in a crisis or to pay off debt.' },
  { terms: ['welfare', 'welfare level'], term: 'Welfare', text: 'Pensions, healthcare, unemployment support and the like. It costs money but makes people happier (the poor and unemployed most).' },
  { terms: ['civil'], term: 'Civil spending', text: 'Running the state: administration, police, courts, infrastructure upkeep.' },
  { terms: ['military'], term: 'Military', text: 'The armed forces. In the budget: what it costs to maintain them. In production: the share of industry making war material (alloys).' },
  { terms: ['debt servicing', 'debt service'], term: 'Debt servicing', text: 'Interest paid on the national debt each year — money that buys nothing.' },
  // --- Debt & credit ---------------------------------------------------------------
  { terms: ['national debt', 'debt'], term: 'National debt', text: "Everything the state owes from past borrowing. It costs interest every year; too much of it hurts the credit rating." },
  { terms: ['debt / gdp', 'debt/gdp', 'debt-to-gdp', 'debt to gdp'], term: 'Debt-to-GDP', text: "National debt as a share of one year's GDP — the usual yardstick for how heavy a debt is. Under ~60% is comfortable; well over 100% is dangerous." },
  { terms: ['debt ceiling'], term: 'Debt ceiling', text: 'How much debt (as a share of GDP) lenders will tolerate at your credit rating. Past it you are in fiscal crisis.' },
  { terms: ['credit rating', 'rating'], term: 'Credit rating', text: 'How safe lenders think your debt is, from AAA (very safe) down to CCC (near default). A worse rating means a lower debt ceiling and costlier borrowing.' },
  { terms: ['bonds', 'bond market', 'gov. securities'], term: 'Bonds', text: 'IOUs the state sells to borrow money: the buyer lends now and is repaid later with interest.' },
  { terms: ['foreign holders'], term: 'Foreign holders', text: "Your debt owned by foreigners — money that flows abroad as interest." },
  // --- Money & banking (mostly Complex mode) -----------------------------------------
  { terms: ['money creation', 'money printing', 'money-financed deficit'], term: 'Money creation', text: 'Covering a deficit by creating new money instead of borrowing. Quick and debt-free, but more money chasing the same goods means inflation.' },
  { terms: ['central bank'], term: 'Central bank', text: 'The institution that issues the currency, sets interest rates and supervises banks — it fights inflation and keeps the financial system stable.' },
  { terms: ['policy interest rate', 'policy rate', 'interest rate'], term: 'Interest rate', text: 'The price of borrowing money. Raising it cools the economy and fights inflation; cutting it encourages borrowing and growth.' },
  { terms: ['real rate'], term: 'Real interest rate', text: 'The interest rate minus inflation — what borrowing really costs.' },
  { terms: ['base money (m0)', 'm0', 'base money'], term: 'Base money (M0)', text: 'Cash plus the reserves banks hold at the central bank — the money the central bank creates directly.' },
  { terms: ['broad money (m2)', 'm2', 'broad money'], term: 'Broad money (M2)', text: 'All money in the economy including bank deposits — much larger than base money, because banks lend deposits out again.' },
  { terms: ['reserve ratio', 'reserve requirement'], term: 'Reserve requirement', text: 'The share of deposits banks must keep in reserve instead of lending out. Higher = safer banks but less lending.' },
  { terms: ['bank deposits', 'system deposits'], term: 'Deposits', text: 'Money people and businesses keep in banks.' },
  { terms: ['loans outstanding', 'system loans'], term: 'Loans', text: 'Money banks have lent out that has not been repaid yet.' },
  { terms: ['currency in circulation'], term: 'Currency in circulation', text: 'Physical cash in people\'s hands.' },
  // --- Currency & trade -----------------------------------------------------------
  { terms: ['currency'], term: 'Currency', text: "A nation's money. Each nation has its own, and its value against other currencies floats." },
  { terms: ['exchange rate', 'exchange rate (tsc per unit)'], term: 'Exchange rate', text: 'What one unit of your currency is worth in Terra Standard Credits (TSC). A stronger currency makes imports cheaper and exports earn less.' },
  { terms: ['tsc', 'terra standard credit'], term: 'Terra Standard Credit (TSC)', text: 'The common yardstick every currency is priced against.' },
  { terms: ['forex', 'fx'], term: 'Forex', text: 'Foreign exchange — the market where currencies are traded against each other.' },
  { terms: ['fx reserves'], term: 'FX reserves', text: 'Foreign currency the central bank holds, used to defend its own currency\'s value.' },
  { terms: ['peg target', 'peg'], term: 'Currency peg', text: 'A promise to hold the currency at a fixed rate, defended by spending FX reserves. If the reserves run out, the peg breaks.' },
  { terms: ['fundamentals'], term: 'Fundamentals', text: 'Where the economy is pulling your exchange rate: low inflation, stability, low debt and a trade surplus make a currency stronger.' },
  { terms: ['trade balance', 'trade / mo'], term: 'Trade balance', text: 'Exports minus imports. A surplus earns money and strengthens the currency; a deficit does the opposite.' },
  { terms: ['imports', 'imports / mo', 'import'], term: 'Imports', text: 'Goods bought from abroad.' },
  { terms: ['exports', 'exports / mo', 'export'], term: 'Exports', text: 'Goods sold abroad.' },
  { terms: ['trade'], term: 'Trade', text: 'Buying and selling goods with other markets.' },
  // --- Markets & business (Complex mode) ----------------------------------------------
  { terms: ['market', 'markets'], term: 'Market', text: 'Where goods are bought and sold; prices rise when demand outruns supply and fall when supply outruns demand.' },
  { terms: ['supply'], term: 'Supply', text: 'How much of a good is on offer.' },
  { terms: ['demand'], term: 'Demand', text: 'How much of a good people and businesses want to buy.' },
  { terms: ['price'], term: 'Price', text: 'What one unit of a good costs.' },
  { terms: ['stock exchange'], term: 'Stock exchange', text: 'Where shares of companies are bought and sold.' },
  { terms: ['corporations'], term: 'Corporations', text: 'Companies that own buildings, earn profits and pay dividends to their owners.' },
  { terms: ['dividends'], term: 'Dividends', text: 'Profits a company pays out to its shareholders.' },
  { terms: ['bureaucracy'], term: 'Bureaucracy', text: 'Administrative capacity needed to run your buildings and territory.' },
  { terms: ['standard of living'], term: 'Standard of living', text: 'Complex mode: how well pops live — how much of their needs they can afford.' },
  { terms: ['pops', 'domestic pops'], term: 'Pops', text: 'Groups of people who work, earn, consume and hold political views.' },
  // --- Society ----------------------------------------------------------------------
  { terms: ['population'], term: 'Population', text: 'How many people live in the nation (or on this world).' },
  { terms: ['workforce'], term: 'Workforce', text: 'People of working age — about half the population. They fill the jobs buildings offer.' },
  { terms: ['jobs'], term: 'Jobs', text: 'Positions buildings offer. More jobs than workers leaves buildings understaffed; fewer leaves people unemployed.' },
  { terms: ['unemployed', 'unemployment'], term: 'Unemployed', text: 'Workers without a job. They still need food and goods, produce nothing, and are unhappy.' },
  { terms: ['workers'], term: 'Workers', text: 'Simple mode stratum: people working farms, mines, power plants and factories.' },
  { terms: ['specialists'], term: 'Specialists', text: 'Simple mode stratum: skilled people working research labs and refineries. They want more consumer goods and electronics.' },
  { terms: ['strata', 'stratum'], term: 'Strata', text: 'Social classes, by the kind of job a household works. Each has its own needs and happiness.' },
  { terms: ['happiness', 'satisfaction'], term: 'Happiness', text: 'How content a group of people is (0–100%). Shortages, unemployment, inflation and war taxes lower it; welfare raises it.' },
  { terms: ['approval'], term: 'Approval', text: "The population's overall happiness (weighted by head count). Stability follows it." },
  { terms: ['stability'], term: 'Stability', text: 'Order and calm. Above 50% it boosts output; below 50% it hurts output; below 25% there is unrest and taxes go uncollected.' },
  { terms: ['upkeep', 'pop upkeep', 'pop upkeep (per month)'], term: 'Pop upkeep', text: 'What people consume each month. Food keeps them alive — a food shortage starves them. Consumer goods and electronics keep them happy.' },
  { terms: ['needs'], term: 'Needs', text: 'What people must consume to live and be content.' },
  // --- Industry (Simple mode) ------------------------------------------------------
  { terms: ['production units', 'pu', 'production'], term: 'Production Units', text: 'Simple mode: industrial capacity from factories. The allocation splits it into construction (civilian), alloys (military) and consumer goods + electronics (consumer).' },
  { terms: ['construction', 'construction queue'], term: 'Construction', text: 'Building new buildings. Each project takes a set number of construction points; each can absorb at most 40 a month, so queue several to use them all.' },
  { terms: ['efficiency'], term: 'Efficiency', text: 'An output multiplier from stability and your economy type.' },
  { terms: ['inputs supplied'], term: 'Inputs supplied', text: 'Share of the minerals and energy industry needs that could be supplied. Below 100%, every factory slows.' },
  { terms: ['economy type'], term: 'Economy type', text: 'Simple mode: Market (more production and faster construction, specialists happier, workers less), Corporatist (balanced), or Planned (steadier, workers happier, higher tax yield, less production).' },
  { terms: ['civilian'], term: 'Civilian production', text: 'Factory output spent on construction points — building your economy.' },
  { terms: ['consumer'], term: 'Consumer production', text: 'Factory output making consumer goods and electronics for the population.' },
  { terms: ['research'], term: 'Research', text: 'Points spent unlocking technologies. In Simple mode, research labs produce them into your chosen tree.' },
  { terms: ['stockpile', 'goods'], term: 'Stockpile', text: 'Goods in storage. Ships, armies, industry and people all draw from it.' },
  { terms: ['food'], term: 'Food', text: 'Keeps people alive. A shortage starves the population.' },
  { terms: ['minerals'], term: 'Minerals', text: 'Raw material for industry and construction.' },
  { terms: ['energy'], term: 'Energy', text: 'Powers industry, labs, refineries and ships.' },
  { terms: ['alloys'], term: 'Alloys', text: 'Refined structural metal — what ship hulls and military equipment are built from.' },
  { terms: ['electronics'], term: 'Electronics', text: 'Circuits and computers — used by research labs and wanted by the population.' },
  { terms: ['consumer goods'], term: 'Consumer goods', text: 'Everyday manufactured products people want — shortages make them unhappy.' },
  { terms: ['exotic matter'], term: 'Exotic Matter', text: 'Rare matter that fuels warp drives.' },
  { terms: ['hyperium'], term: 'Hyperium', text: 'Extremely rare fuel for hyperdrives.' },
  // --- Screens ---------------------------------------------------------------------
  { terms: ['situations'], term: 'Situations', text: 'Ongoing events and crises affecting your nation.' },
  { terms: ['government'], term: 'Government', text: 'How your nation is ruled: its branches, offices, laws and institutions.' },
  { terms: ['economy'], term: 'Economy', text: "Your nation's economy: budget, production, construction, trade." },
  { terms: ['technology'], term: 'Technology', text: 'Research trees. Spend research points to unlock new capabilities.' },
  { terms: ['society'], term: 'Society', text: 'Your people: demographics, culture, religion, species.' },
  { terms: ['demographics'], term: 'Demographics', text: 'Who your people are — how many, what they do, how happy they are.' },
  { terms: ['diplomacy'], term: 'Diplomacy', text: 'Relations with other nations: war, peace and events.' },
  { terms: ['international organizations'], term: 'International Organizations', text: 'Alliances and bodies between nations.' },
  { terms: ['characters'], term: 'Characters', text: 'Notable people in your nation.' },
  { terms: ['map modes'], term: 'Map Modes', text: 'Change what the map colours show (political, relations, …).' },
  { terms: ['settings'], term: 'Settings', text: 'Game options.' },
  { terms: ['outliner'], term: 'Outliner', text: 'A quick list of your battles, fleets, armies and colonies — click one to jump to it.' },
  { terms: ['battles'], term: 'Battles', text: 'Fights you are in right now, in space and on the ground. Click one to open it.' },
  { terms: ['fleets'], term: 'Fleets', text: 'Your groups of ships.' },
  { terms: ['armies'], term: 'Armies', text: 'Ground forces — they garrison worlds and invade enemy ones.' },
  { terms: ['colonies'], term: 'Colonies', text: 'The worlds you own.' },
  // --- War ----------------------------------------------------------------------------
  { terms: ['war score'], term: 'War score', text: 'Who is winning a war: territory occupied plus battles won. It decides what peace terms the enemy will accept.' },
  { terms: ['exhaustion', 'war exhaustion'], term: 'War exhaustion', text: 'How tired of the war a nation is, from time and losses. Exhausted nations accept worse peace terms.' },
  { terms: ['occupied by enemy', 'occupying', 'occupation'], term: 'Occupation', text: 'A world held by an enemy army. It still belongs to its owner but produces nothing for them until liberated or ceded in a peace deal.' },
  { terms: ['shields'], term: 'Shields', text: 'Energy barrier that absorbs damage first and recharges.' },
  { terms: ['armor'], term: 'Armor', text: 'Physical plating that absorbs damage after shields fail.' },
]

const INDEX = new Map<string, GlossaryEntry>()
for (const e of ENTRIES) for (const t of e.terms) INDEX.set(t, { term: e.term, text: e.text })

// Normalize visible label text for lookup: lowercase, drop bracketed bits,
// arrows/bullets, colons and any numbers or amounts attached to the label.
export function normalizeTerm(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[▸▾▲▼•·:]/g, ' ')
    // Drop numbers and amounts glued to a label ("Inflation 2.78%", "GDP $70.95B", "Research 7.9/mo").
    .replace(/[−+-]?[$€]?\d[\d.,]*\s*[%a-z]{0,2}(\/mo|\/yr)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function glossaryLookup(text: string): GlossaryEntry | undefined {
  const raw = text.toLowerCase().replace(/\s+/g, ' ').trim()
  return INDEX.get(raw) ?? INDEX.get(normalizeTerm(text))
}
