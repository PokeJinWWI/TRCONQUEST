// Where each solar-system body's real map comes from (build-time only), and
// the sea level used for the worlds given oceans. See build.ts.
//
// Sea levels (the user's choices):
//   Earth  +70 m: every ice sheet melted, on the BEDROCK under Antarctica and
//          Greenland (ETOPO 2022 bed, no rebound of the crust); only sea
//          connected to today's ocean floods, so inland basins stay dry.
//   Venus  "as much water as Earth" as the same SHARE of the surface under
//          sea: 70.8%, like Earth (the user's reference map). Earth's full
//          ocean VOLUME would drown flat Venus to 2.3% land (checked: sea at
//          +3.76 km), so the coverage reading was chosen; it takes ~15% of
//          Earth's water.
//   Mars   the "Arabia" paleo-shoreline, the larger proposed ancient ocean:
//          −2,090 m mean (Carr & Head 2003; the contact varies ±1.4 km).
//          Everything below floods, so Hellas and Argyre become seas too.
// Bodies with no global elevation data use image mosaics (brightness) and
// the IAU Gazetteer's named features. Not listed (they stay procedural):
// Uranus's moons (Voyager 2 saw only their southern halves, and their named
// features are craters and canyons, which aren't terrain types), and Haumea,
// Makemake, Eris and Deimos (no maps exist).

import { readEtopo, readRawGrid, readTiffGrid, type Grid } from './readers'
import { bodyGroundInfo } from '../../src/scene/planetTerrain'

export const EARTH_OCEAN_VOLUME_KM3 = 1.335e9
export const EARTH_OCEAN_COVERAGE = 0.708

export type Sea = { kind: 'connected'; levelM: number; seed: [number, number] } | { kind: 'level'; levelM: number } | { kind: 'volume'; volumeKm3: number } | { kind: 'coverage'; share: number }

export interface BodySource {
  name: string // as in the game (planetData / moonData)
  file: string
  kind: 'water' | 'airless' | 'icy' | 'io' | 'titan'
  radiusKm: number
  credit: string
  elevation?: (cache: string) => Promise<Grid>
  brightness?: (cache: string) => Promise<Grid>
  sea?: Sea
  iau?: string // gazetteer target
  iauShapes?: boolean // also read feature outlines
  partial?: boolean // unmeasured cells are "unmapped"
  featuresOnly?: boolean // no raster: only named features are real
  minFeatureKm: number
  roughUnitM: number
  volcanicPaterae?: boolean
  liquidSeas?: boolean
}

const USGS = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/'
const W = 1440
const H = 720
const tif = (file: string, slug: string) => (cache: string) => readTiffGrid(USGS + file, W, H, `${cache}/${slug}.bin`)
const radius = (name: string) => bodyGroundInfo(name)!.radiusKm

const body = (b: Omit<BodySource, 'radiusKm' | 'file' | 'minFeatureKm'> & Partial<Pick<BodySource, 'minFeatureKm'>>): BodySource => ({
  minFeatureKm: 0,
  ...b,
  file: b.name.toLowerCase(),
  radiusKm: radius(b.name),
})

export const BODIES: BodySource[] = [
  body({
    name: 'Earth', kind: 'water', roughUnitM: 20,
    credit: 'NOAA ETOPO 2022 (60″, bedrock), sea level +70 m (all ice melted), sea connected to the ocean',
    elevation: (c) => readEtopo(6, `${c}/earth.bin`),
    sea: { kind: 'connected', levelM: 70, seed: [-150, 0] },
  }),
  body({
    name: 'Venus', kind: 'water', roughUnitM: 15, iau: 'VENUS',
    credit: 'NASA Magellan global topography (USGS); sea covering 70.8% of the surface, like Earth',
    elevation: tif('Venus_Magellan_Topography_Global_4641m_v02.tif', 'venus'),
    sea: { kind: 'coverage', share: EARTH_OCEAN_COVERAGE },
  }),
  body({
    name: 'Mars', kind: 'water', roughUnitM: 30, iau: 'MARS',
    credit: 'NASA MGS MOLA (MEGDR 4 ppd); sea at the Arabia paleo-shoreline, −2,090 m (Carr & Head 2003)',
    elevation: (c) => readRawGrid('https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg004/megt90n000cb.img', 1440, 720, 0, W, H, `${c}/mars.bin`),
    sea: { kind: 'level', levelM: -2090 },
  }),
  body({
    name: 'Mercury', kind: 'airless', roughUnitM: 15, iau: 'MERCURY',
    credit: 'NASA MESSENGER global DEM 665 m (USGS)',
    elevation: tif('Mercury_Messenger_USGS_DEM_Global_665m_v2.tif', 'mercury'),
  }),
  body({
    name: 'Luna', kind: 'airless', roughUnitM: 15, iau: 'MOON',
    credit: 'NASA LRO LOLA (LDEM 4 ppd); maria are its low, smooth plains',
    elevation: (c) => readRawGrid('https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.img', 1440, 720, 0, W, H, `${c}/luna.bin`, true, 0.5),
  }),
  body({
    name: 'Ceres', kind: 'airless', roughUnitM: 10, iau: 'CERES',
    credit: 'NASA Dawn HAMO DTM (DLR/USGS)',
    elevation: tif('Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif', 'ceres'),
  }),
  body({
    name: 'Phobos', kind: 'airless', roughUnitM: 2, iau: 'PHOBOS',
    credit: 'ESA Mars Express HRSC global DEM (DLR/USGS)',
    elevation: (c) => readTiffGrid(USGS + 'Phobos_ME_HRSC_DEM_Global_2ppd.tif', 720, 360, `${c}/phobos.bin`),
  }),
  body({
    name: 'Pluto', kind: 'icy', roughUnitM: 10, iau: 'PLUTO', iauShapes: true, partial: true,
    credit: 'NASA New Horizons global DEM (encounter hemisphere; the rest unmapped)',
    elevation: tif('Pluto_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif', 'pluto'),
  }),
  body({ name: 'Io', kind: 'io', roughUnitM: 1, iau: 'IO', iauShapes: true, volcanicPaterae: true, credit: 'Galileo SSI / Voyager global mosaic (USGS); IAU paterae and montes', brightness: tif('Io_GalileoSSI-Voyager_Global_Mosaic_1km.tif', 'io') }),
  body({ name: 'Europa', kind: 'icy', roughUnitM: 1, iau: 'EUROPA', credit: 'Galileo SSI / Voyager global mosaic (USGS)', brightness: tif('Europa_Voyager_GalileoSSI_global_mosaic_500m.tif', 'europa') }),
  body({ name: 'Ganymede', kind: 'icy', roughUnitM: 1, iau: 'GANYMEDE', credit: 'Galileo SSI / Voyager global mosaic (USGS)', brightness: tif('Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif', 'ganymede') }),
  body({ name: 'Callisto', kind: 'icy', roughUnitM: 1, iau: 'CALLISTO', credit: 'Galileo SSI / Voyager global mosaic (USGS)', brightness: tif('Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif', 'callisto') }),
  body({ name: 'Titan', kind: 'titan', roughUnitM: 1, iau: 'TITAN', iauShapes: true, liquidSeas: true, credit: 'Cassini ISS global mosaic (USGS); methane seas and lakes from IAU outlines', brightness: tif('Titan_ISS_P19658_Mosaic_Global_4km.tif', 'titan') }),
  body({ name: 'Rhea', kind: 'icy', roughUnitM: 1, iau: 'RHEA', credit: 'Cassini / Voyager global mosaic (USGS)', brightness: tif('Rhea_Cassini_Voyager_mosaic_global_417m.tif', 'rhea') }),
  body({ name: 'Dione', kind: 'icy', roughUnitM: 1, iau: 'DIONE', credit: 'Cassini / Voyager global mosaic (USGS)', brightness: tif('Dione_Cassini_Voyager_mosaic_global_154m.tif', 'dione') }),
  body({ name: 'Iapetus', kind: 'icy', roughUnitM: 1, iau: 'IAPETUS', credit: 'Cassini / Voyager global mosaic (USGS)', brightness: tif('Iapetus_Cassini_Voyager_mosaic_global_783m.tif', 'iapetus') }),
  body({ name: 'Triton', kind: 'icy', roughUnitM: 1, iau: 'TRITON', credit: 'Voyager 2 colour mosaic, gaps filled (USGS)', brightness: tif('Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif', 'triton') }),
]
