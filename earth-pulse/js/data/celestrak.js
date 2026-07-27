import { CONFIG } from '../config.js';
import { fetchJsonWithCache, toIsoUtc } from './fetch.js';

let satelliteLibrary = null;
let satelliteLibraryPromise = null;

async function loadSatelliteLibrary() {
  if (satelliteLibrary) return satelliteLibrary;
  if (!satelliteLibraryPromise) {
    satelliteLibraryPromise = import('https://cdn.jsdelivr.net/npm/satellite.js@7.0.1/dist/index.js')
      .then((module) => {
        satelliteLibrary = module;
        return module;
      })
      .catch((error) => {
        satelliteLibraryPromise = null;
        console.warn('Earth Pulse: satellite.js could not be loaded.', error);
        return null;
      });
  }
  return satelliteLibraryPromise;
}

function splitAtDateLine(points) {
  const segments = [];
  let segment = [];

  for (const point of points) {
    const previous = segment.at(-1);
    if (previous && Math.abs(previous.lng - point.lng) > 180) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
    }
    segment.push(point);
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}

function propagate(satrec, date) {
  if (!satelliteLibrary) return null;

  const result = satelliteLibrary.propagate(satrec, date);
  if (!result?.position) return null;

  const gmst = satelliteLibrary.gstime(date);
  const geodetic = satelliteLibrary.eciToGeodetic(result.position, gmst);
  const latitude = satelliteLibrary.degreesLat(geodetic.latitude);
  const longitude = satelliteLibrary.degreesLong(geodetic.longitude);
  const altitudeKm = geodetic.height;
  const velocityKmS = result.velocity
    ? Math.hypot(result.velocity.x, result.velocity.y, result.velocity.z)
    : null;

  if (![latitude, longitude, altitudeKm].every(Number.isFinite)) return null;
  return { latitude, longitude, altitudeKm, velocityKmS };
}

function buildOrbit(satrec, center = new Date()) {
  const points = [];
  for (let minute = -45; minute <= 55; minute += 2) {
    const date = new Date(center.getTime() + minute * 60_000);
    const position = propagate(satrec, date);
    if (!position) continue;
    points.push({
      lat: position.latitude,
      lng: position.longitude,
      alt: Math.max(0.045, position.altitudeKm / CONFIG.earthRadiusKm),
    });
  }
  return splitAtDateLine(points).map((segment, index) => ({
    id: `iss-path-${index}`,
    points: segment,
    color: 'rgba(213, 255, 252, 0.42)',
  }));
}

function createSatelliteRecord(position, provider, updatedAt, satrec = null) {
  return {
    id: 'orbit:iss',
    source: provider,
    category: 'satellite',
    layer: 'ORBIT',
    title: 'International Space Station',
    latitude: position.latitude,
    longitude: position.longitude,
    altitude: Math.max(0.045, position.altitudeKm / CONFIG.earthRadiusKm),
    occurredAt: new Date().toISOString(),
    updatedAt: updatedAt || new Date().toISOString(),
    intensity: 1,
    color: CONFIG.colors.orbit,
    metadata: {
      altitudeKm: position.altitudeKm,
      velocityKmS: position.velocityKmS,
      provider,
    },
    sourceUrl: provider === 'CelesTrak'
      ? 'https://celestrak.org/NORAD/elements/'
      : 'https://wheretheiss.at/',
    satrec,
    paths: satrec ? buildOrbit(satrec) : [],
  };
}

export async function fetchIssFallbackPosition() {
  const result = await fetchJsonWithCache({
    url: CONFIG.api.issFallback,
    key: 'iss-position-fallback',
    retries: 0,
  });
  const raw = result.data;
  if (!raw) return { satellite: null, meta: result.meta };

  const position = {
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    altitudeKm: Number(raw.altitude),
    velocityKmS: Number(raw.velocity) / 3600,
  };
  if (![position.latitude, position.longitude, position.altitudeKm].every(Number.isFinite)) {
    return { satellite: null, meta: { ...result.meta, status: 'unavailable' } };
  }

  const updatedAt = raw.timestamp
    ? new Date(Number(raw.timestamp) * 1000).toISOString()
    : result.meta.fetchedAt;

  return {
    satellite: createSatelliteRecord(position, 'Where The ISS At?', updatedAt),
    meta: {
      ...result.meta,
      dataUpdatedAt: updatedAt,
      error: result.meta.error || 'CelesTrak unavailable; live-position fallback active',
    },
  };
}

export async function fetchIssOrbit() {
  const result = await fetchJsonWithCache({
    url: CONFIG.api.celestrak,
    key: 'celestrak-iss-omm',
  });

  try {
    const omm = Array.isArray(result.data) ? result.data[0] : null;
    if (!omm) throw new Error('OMM data unavailable');
    const library = await loadSatelliteLibrary();
    if (!library?.json2satrec) throw new Error('Orbital library unavailable');

    const satrec = library.json2satrec(omm);
    const position = propagate(satrec, new Date());
    if (!position) throw new Error('ISS propagation failed');

    const updatedAt = toIsoUtc(omm.EPOCH) || result.meta.fetchedAt;
    return {
      satellite: createSatelliteRecord(position, 'CelesTrak', updatedAt, satrec),
      meta: { ...result.meta, dataUpdatedAt: updatedAt },
    };
  } catch (error) {
    console.warn('Earth Pulse: CelesTrak orbit could not be used.', error);
    return fetchIssFallbackPosition();
  }
}

export function updateLocalSatellitePosition(record, date = new Date()) {
  if (!record?.satrec) return record;
  const position = propagate(record.satrec, date);
  if (!position) return record;

  return {
    ...record,
    latitude: position.latitude,
    longitude: position.longitude,
    altitude: Math.max(0.045, position.altitudeKm / CONFIG.earthRadiusKm),
    occurredAt: date.toISOString(),
    metadata: {
      ...record.metadata,
      altitudeKm: position.altitudeKm,
      velocityKmS: position.velocityKmS,
    },
  };
}
