export const CONFIG = Object.freeze({
  appName: 'Earth Pulse',
  version: '0.1.0',
  earthRadiusKm: 6371,
  requestTimeoutMs: 10_000,
  requestRetries: 1,
  cachePrefix: 'earth-pulse:v0.1',
  refreshIntervals: {
    usgs: 2 * 60 * 1000,
    eonet: 30 * 60 * 1000,
    swpc: 2 * 60 * 1000,
    celestrak: 6 * 60 * 60 * 1000,
    issFallback: 10 * 1000,
  },
  staleAfter: {
    usgs: 10 * 60 * 1000,
    eonet: 2 * 60 * 60 * 1000,
    swpc: 15 * 60 * 1000,
    celestrak: 24 * 60 * 60 * 1000,
  },
  limits: {
    earthquakes: 200,
    eonet: 100,
    quakeRings: 30,
  },
  api: {
    usgs: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    eonet: 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=100',
    swpc: {
      solarWindSpeed: 'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json',
      magneticField: 'https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json',
      kpIndex: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
    },
    celestrak: 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON',
    issFallback: 'https://api.wheretheiss.at/v1/satellites/25544',
  },
  layers: ['CORE', 'CRUST', 'AIR', 'SURFACE', 'SPACE', 'ORBIT'],
  colors: {
    earthquake: '#ff9b68',
    volcano: '#ff6f61',
    wildfire: '#ffb14e',
    severeStorm: '#62d8ff',
    flood: '#4fa6ff',
    drought: '#d8bd72',
    dustHaze: '#d6a66c',
    seaLakeIce: '#a9e4ff',
    snow: '#e9f6ff',
    landslide: '#b68a67',
    tempExtreme: '#ef7c88',
    otherSurface: '#9cb6c7',
    orbit: '#d9fffd',
  },
  planetaryWeights: {
    seismic: 0.30,
    surface: 0.20,
    atmosphere: 0.20,
    space: 0.30,
  },
});

export const SOURCE_KEYS = Object.freeze(['usgs', 'eonet', 'swpc', 'celestrak']);

export const SOURCE_LABELS = Object.freeze({
  usgs: 'USGS',
  eonet: 'NASA EONET',
  swpc: 'NOAA SWPC',
  celestrak: 'CelesTrak',
});
