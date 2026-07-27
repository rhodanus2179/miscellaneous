import { CONFIG } from '../config.js';
import { fetchJsonWithCache } from './fetch.js';

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function scoreForDisplay(feature) {
  const magnitude = Number(feature.properties?.mag) || 0;
  const occurredAt = Number(feature.properties?.time) || 0;
  const ageHours = Math.max(0, (Date.now() - occurredAt) / 3_600_000);
  const recency = Math.max(0, 1 - ageHours / 24);
  return magnitude * 0.8 + recency * 2;
}

function normalizeFeature(feature) {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const [longitude, latitude, depthValue] = coordinates;
  const magnitude = Number(feature.properties?.mag);
  if (![longitude, latitude, magnitude].every(Number.isFinite)) return null;

  const depthKm = Number.isFinite(Number(depthValue)) ? Number(depthValue) : null;
  const occurredAt = new Date(Number(feature.properties?.time)).toISOString();
  const updatedAt = new Date(Number(feature.properties?.updated || feature.properties?.time)).toISOString();
  const intensity = clamp01((magnitude + 0.5) / 7.5);

  return {
    id: `usgs:${feature.id}`,
    source: 'USGS',
    category: 'earthquake',
    layer: 'CRUST',
    title: feature.properties?.title || `M ${magnitude.toFixed(1)} earthquake`,
    latitude,
    longitude,
    altitude: 0.003,
    occurredAt,
    updatedAt,
    intensity,
    color: CONFIG.colors.earthquake,
    displayRadius: 0.10 + intensity * 0.32,
    displayAltitude: 0.006 + intensity * 0.045,
    metadata: {
      magnitude,
      depthKm,
      tsunami: Boolean(feature.properties?.tsunami),
      status: feature.properties?.status || null,
      place: feature.properties?.place || null,
    },
    sourceUrl: feature.properties?.url || null,
  };
}

export async function fetchEarthquakes() {
  const result = await fetchJsonWithCache({
    url: CONFIG.api.usgs,
    key: 'usgs-earthquakes',
  });

  if (!result.data?.features) {
    return { events: [], meta: result.meta };
  }

  const selected = [...result.data.features]
    .filter((feature) => Number.isFinite(Number(feature.properties?.mag)))
    .sort((a, b) => scoreForDisplay(b) - scoreForDisplay(a))
    .slice(0, CONFIG.limits.earthquakes)
    .map(normalizeFeature)
    .filter(Boolean);

  return {
    events: selected,
    meta: {
      ...result.meta,
      dataUpdatedAt: result.data.metadata?.generated
        ? new Date(result.data.metadata.generated).toISOString()
        : null,
    },
  };
}
