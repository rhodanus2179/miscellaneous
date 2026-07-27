import { CONFIG } from '../config.js';
import { fetchJsonWithCache, toIsoUtc } from './fetch.js';

const CATEGORY_MAP = {
  wildfires: { category: 'wildfire', layer: 'SURFACE' },
  volcanoes: { category: 'volcano', layer: 'CRUST' },
  severeStorms: { category: 'severeStorm', layer: 'AIR' },
  floods: { category: 'flood', layer: 'SURFACE' },
  drought: { category: 'drought', layer: 'SURFACE' },
  dustHaze: { category: 'dustHaze', layer: 'SURFACE' },
  seaLakeIce: { category: 'seaLakeIce', layer: 'SURFACE' },
  snow: { category: 'snow', layer: 'SURFACE' },
  landslides: { category: 'landslide', layer: 'SURFACE' },
  tempExtremes: { category: 'tempExtreme', layer: 'AIR' },
};

function centroidOfRing(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  const valid = ring.filter((point) => Array.isArray(point) && point.length >= 2);
  if (valid.length === 0) return null;
  const longitude = valid.reduce((sum, point) => sum + Number(point[0]), 0) / valid.length;
  const latitude = valid.reduce((sum, point) => sum + Number(point[1]), 0) / valid.length;
  return { longitude, latitude };
}

function coordinatesFromGeometry(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [longitude, latitude] = geometry.coordinates || [];
    return Number.isFinite(Number(longitude)) && Number.isFinite(Number(latitude))
      ? { longitude: Number(longitude), latitude: Number(latitude) }
      : null;
  }
  if (geometry.type === 'Polygon') return centroidOfRing(geometry.coordinates?.[0]);
  if (geometry.type === 'MultiPolygon') return centroidOfRing(geometry.coordinates?.[0]?.[0]);
  return null;
}

function categoryFromProperties(properties) {
  const ids = (properties?.categories || []).map((category) => category.id);
  for (const id of ids) {
    if (CATEGORY_MAP[id]) return CATEGORY_MAP[id];
  }
  return { category: 'otherSurface', layer: 'SURFACE' };
}

function normalizeFeature(feature) {
  const coords = coordinatesFromGeometry(feature.geometry);
  if (!coords) return null;

  const properties = feature.properties || {};
  const mapped = categoryFromProperties(properties);
  const occurredAt = toIsoUtc(properties.date) || new Date().toISOString();
  const ageDays = Math.max(0, (Date.now() - new Date(occurredAt).getTime()) / 86_400_000);
  const recency = Math.max(0.15, 1 - ageDays / 60);
  const categoryBoost = mapped.category === 'volcano' ? 0.95
    : mapped.category === 'severeStorm' ? 0.82
      : mapped.category === 'wildfire' ? 0.62
        : 0.48;
  const intensity = Math.min(1, categoryBoost * 0.75 + recency * 0.25);
  const source = properties.sources?.[0];

  return {
    id: `eonet:${properties.id || feature.id}`,
    source: 'NASA EONET',
    category: mapped.category,
    layer: mapped.layer,
    title: properties.title || 'Natural event',
    latitude: coords.latitude,
    longitude: coords.longitude,
    altitude: 0.003,
    occurredAt,
    updatedAt: occurredAt,
    intensity,
    color: CONFIG.colors[mapped.category] || CONFIG.colors.otherSurface,
    displayRadius: 0.12 + intensity * 0.26,
    displayAltitude: mapped.category === 'volcano'
      ? 0.025 + intensity * 0.06
      : 0.008 + intensity * 0.026,
    metadata: {
      categories: properties.categories || [],
      magnitudeValue: properties.magnitudeValue ?? null,
      magnitudeUnit: properties.magnitudeUnit ?? null,
      description: properties.description || null,
    },
    sourceUrl: source?.url || properties.link || null,
  };
}

export async function fetchEonetEvents() {
  const result = await fetchJsonWithCache({
    url: CONFIG.api.eonet,
    key: 'nasa-eonet',
  });

  if (!result.data?.features) return { events: [], meta: result.meta };

  const events = result.data.features
    .map(normalizeFeature)
    .filter(Boolean)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, CONFIG.limits.eonet);

  const latest = events
    .map((event) => event.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  return {
    events,
    meta: { ...result.meta, dataUpdatedAt: latest },
  };
}
