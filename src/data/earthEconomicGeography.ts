// Earth's economic geography: where the development sites of Earth lie (scene/locations.ts places them first, snapped to the nearest
// dry node, then nothing is drawn at random). This is NOT today's map. It is the Earth of the setting: the sea stands 70 m higher and
// centuries of development have followed it, so
//   - Africa is a developed core (the Nile and Great Lakes, the Ethiopian highlands, a Congo industrial belt, greened Sahel farmland),
//   - settlement has moved poleward (Siberia, the Canadian Shield, Greenland's ice-free coast, Patagonia),
//   - the drowned coastal megacities were rebuilt inland on higher ground (the Bangladesh and Shanghai populations live on the Ganges and
//     Yangtze uplands),
//   - the climate bands moved north: temperate farming is in the Prairies, Scandinavia and the Russian steppe, the old breadbaskets dry.
// Each anchor is `[longitude, latitude]` and carries a one-line note so it can be tuned by hand. Every one must end up on dry land
// (tests/locations.test.ts snaps them all and checks). Order matters only for ids: appending keeps the earlier ones.
import type { LocationKind, SiteGood } from './locationData'

export interface EarthAnchor {
  kind: Extract<LocationKind, 'settlement' | 'agricultural' | 'resource' | 'industrial'>
  name: string
  at: [number, number]
  // Resource anchors: what lies there, and how rich (0..1).
  good?: SiteGood
  weight?: number
  note: string
}

const city = (name: string, at: [number, number], note: string): EarthAnchor => ({ kind: 'settlement', name, at, note })
const farm = (name: string, at: [number, number], note: string): EarthAnchor => ({ kind: 'agricultural', name, at, note })
const mine = (name: string, at: [number, number], good: SiteGood, weight: number, note: string): EarthAnchor => ({ kind: 'resource', name, at, good, weight, note })
const works = (name: string, at: [number, number], note: string): EarthAnchor => ({ kind: 'industrial', name, at, note })

export const EARTH_ANCHORS: readonly EarthAnchor[] = [
  // ---- settlements: Africa, a developed core ------------------------------------------------------
  city('Addis Ababa', [38.75, 9.03], 'Highland capital of the African core; cool, high and dry of the sea.'),
  city('Kampala', [32.58, 0.35], 'Great Lakes metropolis on the Lake Victoria rim.'),
  city('Kigali', [30.06, -1.95], 'Highland city of the lakes.'),
  city('Dodoma', [35.74, -6.17], 'Tanzanian plateau city, inland of the drowned coast.'),
  city('Lusaka', [28.29, -15.39], 'Zambian plateau, hub of the copperbelt.'),
  city('Harare', [31.05, -17.83], 'Highveld city.'),
  city('Johannesburg', [28.04, -26.2], 'The Witwatersrand, Africa\'s old industrial heart.'),
  city('Windhoek', [17.08, -22.56], 'Namibian highland.'),
  city('Kinshasa', [15.31, -4.32], 'Congo basin capital, on the upper rim of the drowned river mouth.'),
  city('Lubumbashi', [27.48, -11.66], 'Katanga mining metropolis.'),
  city('Kano', [8.52, 12.0], 'Sahel trade city, the savanna greened by the new rains.'),
  city('Abuja', [7.49, 9.06], 'Nigerian plateau capital, replacing drowned Lagos.'),
  city('Niamey', [2.11, 13.51], 'Sahel city on the greening belt.'),
  city('Khartoum', [32.53, 15.6], 'Nile confluence city (the upper Nile, well above the sea).'),
  city('Luxor', [32.64, 25.7], 'Upper Nile valley city, the old Cairo\'s heir.'),
  // ---- settlements: Eurasia, moved poleward and inland --------------------------------------------
  city('Moscow', [37.62, 55.75], 'Heartland capital; the steppe belt is its granary.'),
  city('Yekaterinburg', [60.6, 56.84], 'Urals gateway city.'),
  city('Novosibirsk', [82.92, 55.03], 'Siberian metropolis of the warming north.'),
  city('Krasnoyarsk', [92.87, 56.01], 'Yenisei city.'),
  city('Yakutsk', [129.73, 62.03], 'Far-northern city, thawed ground opened to farming.'),
  city('Irkutsk', [104.28, 52.29], 'Baikal city.'),
  city('Almaty', [76.89, 43.24], 'Tian Shan foothill city.'),
  city('Tashkent', [69.28, 41.3], 'Central Asian oasis metropolis.'),
  city('Ulaanbaatar', [106.9, 47.92], 'Highland steppe city.'),
  city('Lhasa', [91.12, 29.65], 'Tibetan plateau city, now a major population centre.'),
  city('Kunming', [102.71, 25.04], 'Yunnan highland city.'),
  city('Xi\'an', [108.94, 34.34], 'Wei valley city on the Guanzhong plain, north of the Qinling range; its own city, apart from the Sichuan Basin megalopolis.'),
  city('Harbin', [126.64, 45.76], 'Manchurian city of the warmer north.'),
  city('Delhi', [77.21, 28.61], 'Ganges-Yamuna uplands, home of the drowned Bangladesh populations.'),
  city('Lucknow', [80.95, 26.85], 'Ganges upland city.'),
  city('Hyderabad', [78.49, 17.39], 'Deccan plateau city.'),
  city('Bangalore', [77.59, 12.97], 'Southern plateau city.'),
  city('Tehran', [51.39, 35.69], 'Iranian plateau capital.'),
  city('Ankara', [32.85, 39.93], 'Anatolian plateau capital.'),
  city('Kyiv', [30.52, 50.45], 'Steppe city of the moved breadbasket.'),
  city('Munich', [11.58, 48.14], 'Alpine foreland city, the new German heartland.'),
  city('Östersund', [14.64, 63.18], 'Scandinavian city, farming reaches this far north now.'),
  city('Madrid', [-3.7, 40.42], 'Meseta capital of the dry south-west.'),
  // ---- settlements: the Americas --------------------------------------------------------------------
  city('Denver', [-104.99, 39.74], 'Front Range city.'),
  city('Winnipeg', [-97.14, 49.9], 'Prairie metropolis of the new northern breadbasket.'),
  city('Edmonton', [-113.49, 53.55], 'Northern prairie city.'),
  city('Kansas City', [-94.58, 39.1], 'Plains river city.'),
  city('Atlanta', [-84.39, 33.75], 'Piedmont city, above the drowned Gulf coast.'),
  city('Mexico City', [-99.13, 19.43], 'High valley metropolis.'),
  city('Bogotá', [-74.07, 4.71], 'Andean plateau capital.'),
  city('Quito', [-78.47, -0.18], 'Andean capital on the equator.'),
  city('Brasília', [-47.88, -15.79], 'Planalto capital.'),
  city('Belo Horizonte', [-43.94, -19.92], 'Minas mining metropolis.'),
  city('Córdoba', [-64.18, -31.42], 'Argentine upland city.'),
  city('Bariloche', [-71.31, -41.13], 'Patagonian lake city, settlement moving south.'),
  city('Nuuk', [-51.72, 64.18], 'Greenland\'s ice-free coast, settled as the ice retreated.'),
  // ---- settlements: Oceania ---------------------------------------------------------------------------
  city('Canberra', [149.13, -35.28], 'Highland capital of the south-east.'),
  city('Alice Springs', [133.88, -23.7], 'Interior city, the dry centre now watered.'),

  // ---- agriculture ------------------------------------------------------------------------------------
  farm('Nebraska Plains Farmlands', [-100.0, 41.5], 'The Great Plains, still the continent\'s granary.'),
  farm('Prairie Farmlands', [-106.0, 52.0], 'The Canadian Prairies, now the temperate belt.'),
  farm('Pampas Farmlands', [-62.0, -33.5], 'The upper Pampas above the drowned coast.'),
  farm('Punjab Farmlands', [74.5, 31.0], 'The Indus-Ganges breadbasket, kept watered.'),
  farm('North China Plain Farmlands', [114.5, 36.5], 'The western rim of the old plain.'),
  farm('Ukrainian Steppe Farmlands', [32.0, 49.5], 'The black-earth steppe.'),
  farm('Volga Steppe Farmlands', [45.0, 52.0], 'The moved breadbasket of the Russian steppe.'),
  farm('Sahel Farmlands', [5.0, 13.0], 'Sahel farmland greened by the climate shift.'),
  farm('Ethiopian Highland Farmlands', [38.0, 9.5], 'Terraced highlands.'),
  farm('Småland Farmlands', [14.7, 57.2], 'Scandinavian farmland, warm enough for grain.'),
  farm('Siberian Farmlands', [75.0, 56.5], 'The West Siberian plain, thawed and ploughed.'),
  farm('Manchurian Farmlands', [125.0, 45.0], 'The northern plain.'),
  farm('Kenya Highland Farmlands', [37.0, 0.3], 'Highland farms of the African core.'),
  farm('Cerrado Farmlands', [-50.0, -16.0], 'The Brazilian cerrado.'),
  farm('Zambian Plateau Farmlands', [28.0, -14.0], 'The plateau breadbasket of the south.'),
  farm('Murray Upland Farmlands', [148.0, -33.0], 'The upper Murray-Darling.'),

  // ---- mining and wells -------------------------------------------------------------------------------
  mine('Urals Iron Mines', [59.5, 56.0], 'ironOre', 0.9, 'The Urals base: iron and coal, a chain worked for centuries.'),
  mine('Pilbara Iron Mines', [118.5, -22.5], 'ironOre', 1.0, 'The Pilbara, the largest iron field.'),
  mine('Copperbelt Rare Metal Mines', [27.8, -12.5], 'rareMetals', 0.9, 'The Zambia-Katanga copperbelt.'),
  mine('Witwatersrand Rare Metal Mines', [27.8, -26.3], 'rareMetals', 0.8, 'South Africa\'s deep gold and platinum reefs.'),
  mine('Atacama Rare Metal Mines', [-69.0, -23.0], 'rareMetals', 0.9, 'Chile\'s copper and lithium.'),
  mine('Kiruna Iron Mines', [20.2, 67.85], 'ironOre', 0.8, 'Lapland iron.'),
  mine('Sudbury Rare Metal Mines', [-81.0, 46.5], 'rareMetals', 0.8, 'The Canadian Shield\'s nickel.'),
  mine('Norilsk Rare Metal Mines', [88.2, 69.3], 'rareMetals', 0.8, 'Siberian nickel and palladium.'),
  mine('Carajás Iron Mines', [-50.2, -6.1], 'ironOre', 1.0, 'The Amazonian iron province.'),
  mine('Kursk Iron Mines', [36.2, 51.7], 'ironOre', 0.8, 'The magnetic anomaly.'),
  mine('Mesabi Iron Mines', [-92.5, 47.5], 'ironOre', 0.7, 'The Minnesota iron range.'),
  mine('Kuzbass Coal Mines', [87.0, 54.0], 'coal', 1.0, 'The Kuznetsk basin.'),
  mine('Powder River Coal Mines', [-105.5, 44.0], 'coal', 0.9, 'The Wyoming basin.'),
  mine('Shanxi Coal Mines', [112.5, 37.5], 'coal', 1.0, 'The Shanxi coal belt.'),
  mine('Athabasca Oil Fields', [-111.4, 57.0], 'oil', 1.0, 'The Alberta oil sands.'),
  mine('Tyumen Oil Fields', [65.5, 57.0], 'oil', 0.9, 'The West Siberian fields.'),
  mine('Zagros Oil Fields', [48.5, 32.5], 'oil', 0.8, 'The foothills above the drowned Gulf.'),
  mine('Congo Hardwood Forest', [23.0, -2.0], 'hardwood', 0.9, 'The Congo rainforest.'),
  mine('Amazon Hardwood Forest', [-62.0, -6.0], 'hardwood', 0.9, 'The upper Amazon.'),
  mine('Taiga Timber Forest', [100.0, 60.0], 'timber', 1.0, 'The Siberian taiga.'),
  mine('Boreal Timber Forest', [-100.0, 55.0], 'timber', 0.9, 'The Canadian boreal forest.'),
  mine('Morocco Phosphate Mines', [-6.5, 32.6], 'phosphate', 1.0, 'The Atlas phosphates.'),
  mine('Kola Phosphate Mines', [33.5, 67.7], 'phosphate', 0.7, 'The Kola apatite.'),
  mine('Sicilian Sulfur Works', [14.0, 37.6], 'sulfur', 0.5, 'Volcanic sulfur.'),

  // ---- industry --------------------------------------------------------------------------------------
  works('Great Lakes Industrial Zone', [-83.0, 42.4], 'The Detroit uplands, the American industrial belt.'),
  works('Hessian Industrial Zone', [8.5, 50.9], 'The German industrial heart, on the dry highlands.'),
  works('Silesian Industrial Zone', [19.0, 50.3], 'Upper Silesia.'),
  works('Ural Industrial Zone', [60.5, 57.0], 'The Urals\' heavy industry.'),
  works('Kuznetsk Industrial Zone', [86.5, 54.5], 'Siberian steel.'),
  works('Ganges Upland Industrial Zone', [80.3, 26.4], 'The Kanpur-Lucknow belt, for the drowned delta\'s workers.'),
  works('Deccan Industrial Zone', [75.5, 15.5], 'The southern plateau.'),
  works('Yangtze Upland Industrial Zone', [108.0, 30.5], 'The upland belt that took Shanghai\'s industry.'),
  works('Sichuan Industrial Zone', [104.5, 30.5], 'The basin around the capital.'),
  works('Gauteng Industrial Zone', [28.2, -26.0], 'The Witwatersrand\'s factories.'),
  works('Katanga Industrial Zone', [27.0, -11.0], 'The Copperbelt\'s smelters.'),
  works('Congo Industrial Belt', [23.5, -5.5], 'The planned Congo belt of the African core.'),
  works('Ibadan Industrial Zone', [3.9, 7.4], 'Nigerian hinterland, behind the drowned coast.'),
  works('Highland Industrial Zone', [38.5, 8.5], 'Ethiopia\'s highland factories.'),
  works('Minas Industrial Zone', [-44.0, -20.0], 'Brazil\'s mining-linked industry.'),
  works('Bavarian Industrial Zone', [11.5, 48.5], 'Alpine foreland engineering.'),
]

// The ground anchors of the Ring of Heaven's space-elevator tethers: where they stand when the game opens. On the equator, a mix of land
// (the East African highlands, the Andes) and floating platforms at sea (the equatorial Atlantic and Pacific). Each snaps to the nearest
// node on the equatorial band of the right kind (scene/ruralOrders.seedRuralStructures).
export const RING_ANCHORS: readonly { name: string; at: [number, number]; sea: boolean }[] = [
  { name: 'Kenya Highlands Anchor', at: [37.3, 0.0], sea: false },
  { name: 'Quito Anchor', at: [-78.2, 0.0], sea: false },
  { name: 'Atlantic Platform', at: [-20.0, 0.0], sea: true },
  { name: 'Pacific Platform', at: [-140.0, 0.0], sea: true },
]
