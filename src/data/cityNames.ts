// City names for each nation's key nodes (scene/keyNames.ts). A world's cities
// are named from its founding nation's list, so a conquered city keeps its name.
// The capital's name is the country's `capitalCityName` (countryData.ts).
//
//   Mars    Chinese city names read in Sino-Japanese (on'yomi); the kanji
//           are shown alongside. Mars's own regions keep their real names
//           (see the region names in the real-map data).
//   Venus   Greek myth — Aphrodite's cities, epithets and companions.
//   Orion   mythic and utopian places, in the spirit of Arcadia.
//   Lalande French, after the astronomer Jérôme Lalande.

export interface CityName {
  name: string
  // The name in its own script (Mars's kanji), when it has one.
  native?: string
}

export const CITY_NAMES: Record<string, CityName[]> = {
  'imperial-state-of-mars': [
    { name: 'Rakuyō', native: '洛陽' },
    { name: 'Chōan', native: '長安' },
    { name: 'Tonkō', native: '敦煌' },
    { name: 'Seito', native: '成都' },
    { name: 'Keiwaku', native: '熒惑' },
    { name: 'Kaihō', native: '開封' },
    { name: 'Kenkō', native: '建康' },
    { name: 'Rin’an', native: '臨安' },
    { name: 'Soshū', native: '蘇州' },
    { name: 'Yōshū', native: '揚州' },
    { name: 'Taigen', native: '太原' },
    { name: 'Daidō', native: '大同' },
    { name: 'Jōyō', native: '襄陽' },
    { name: 'Kōryō', native: '江陵' },
    { name: 'Keirin', native: '桂林' },
    { name: 'Ryōshū', native: '涼州' },
    { name: 'Shusen', native: '酒泉' },
    { name: 'Tensui', native: '天水' },
    { name: 'Unchū', native: '雲中' },
    { name: 'Kinryō', native: '金陵' },
    { name: 'Sekijō', native: '赤城' },
  ],
  'republic-of-venus': [
    'Kythera', 'Amathus', 'Idalion', 'Eryx', 'Knidos', 'Golgoi', 'Hesperia', 'Phosphoros', 'Eosphoros', 'Harmonia',
    'Charis', 'Himeros', 'Pothos', 'Galatea', 'Adonia', 'Pandemos', 'Ourania', 'Anadyomene', 'Kourion', 'Pontia',
  ].map((name) => ({ name })),
  'orion-republic': [
    'Avalon', 'Hyperborea', 'Thule', 'Lyonesse', 'Halcyon', 'Tempe', 'Hesperides', 'Shambhala', 'Xanadu', 'Asphodel',
    'Lemuria', 'Ys', 'Cockaigne', 'Meridian', 'Concordia', 'Aurelia', 'Arcady', 'Evenmere', 'Solace', 'Tír na nÓg',
  ].map((name) => ({ name })),
  'kingdom-of-lalande': [
    'Montclair', 'Beaulieu', 'Valmont', 'Rochefort', 'Clairvaux', 'Belfort', 'Mirabeau', 'Fontenay', 'Chantilly', 'Beauregard',
    'Mont-Jérôme', 'Aurillac', 'Vaucouleurs', 'Bellecombe', 'Rivebelle', 'Clairmarais', 'Valcourt', 'Sainte-Étoile', 'Hautrive', 'Lysmont',
  ].map((name) => ({ name })),
  // Earth's surviving urban areas: after the +70 m sea rise most coastal cities
  // are gone, and only high-ground interior centres remain (the P12 survivors)
  // plus a handful of other upland holdouts. The old imperial core under the
  // Northern Federal Command.
  earth: [
    'Chicago', 'Chengdu', 'Delhi', 'São Paulo', 'Nairobi', 'Kano', 'Moscow',
    'Denver', 'Addis Ababa', 'Kunming', 'Bogotá', 'Lhasa', 'Harare', 'Almaty',
    'Kigali', 'Guadalajara', 'Toluca', 'Ulaanbaatar', 'Johannesburg', 'Tashkent',
  ].map((name) => ({ name })),
}
