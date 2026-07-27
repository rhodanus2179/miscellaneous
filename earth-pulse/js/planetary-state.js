import { CONFIG } from './config.js';

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function seismicScore(earthquakes) {
  if (!Array.isArray(earthquakes)) return null;
  if (earthquakes.length === 0) return 0;

  const magnitudes = earthquakes.map((event) => Number(event.metadata?.magnitude) || 0);
  const maxMagnitude = Math.max(...magnitudes);
  const m5Plus = magnitudes.filter((magnitude) => magnitude >= 5).length;
  const weighted = magnitudes.reduce((sum, magnitude) => sum + Math.pow(Math.max(magnitude, 0), 2.2), 0);

  return clamp(
    clamp(earthquakes.length / 180 * 30, 0, 30)
    + clamp((maxMagnitude - 3) / 4 * 45, 0, 45)
    + clamp(m5Plus / 8 * 15, 0, 15)
    + clamp(Math.log10(weighted + 1) / 4 * 10, 0, 10),
  );
}

function eonetScores(events) {
  if (!Array.isArray(events)) return { surface: null, atmosphere: null };

  const surfaceWeights = {
    volcano: 4,
    wildfire: 1,
    flood: 2,
    drought: 1.5,
    dustHaze: 1,
    seaLakeIce: 0.6,
    snow: 0.8,
    landslide: 2.2,
    tempExtreme: 1.5,
    otherSurface: 0.7,
  };

  let surfaceTotal = 0;
  let atmosphericTotal = 0;
  for (const event of events) {
    if (event.layer === 'AIR') atmosphericTotal += event.category === 'severeStorm' ? 3 : 1;
    if (event.layer === 'SURFACE' || event.category === 'volcano') {
      surfaceTotal += surfaceWeights[event.category] ?? 1;
    }
  }

  return {
    surface: clamp(surfaceTotal / 75 * 100),
    atmosphere: clamp(atmosphericTotal / 45 * 100),
  };
}

function spaceScore(spaceWeather) {
  if (!spaceWeather) return null;
  const parts = [];

  if (Number.isFinite(spaceWeather.solarWindSpeed)) {
    parts.push({ value: clamp((spaceWeather.solarWindSpeed - 280) / 520 * 100), weight: 0.45 });
  }
  if (Number.isFinite(spaceWeather.kp)) {
    parts.push({ value: clamp(spaceWeather.kp / 9 * 100), weight: 0.45 });
  }
  if (Number.isFinite(spaceWeather.bt)) {
    parts.push({ value: clamp(spaceWeather.bt / 20 * 100), weight: 0.10 });
  }

  if (parts.length === 0) return null;
  const weight = parts.reduce((sum, part) => sum + part.weight, 0);
  return clamp(parts.reduce((sum, part) => sum + part.value * part.weight, 0) / weight);
}

function labelForScore(score) {
  if (score < 20) return 'QUIET';
  if (score < 40) return 'BREATHING';
  if (score < 55) return 'ACTIVE';
  if (score < 70) return 'RESTLESS';
  if (score < 85) return 'CHARGED';
  return 'STORMING';
}

export function calculatePlanetaryState(data) {
  const seismic = seismicScore(data.earthquakes);
  const eonet = eonetScores(data.eonetEvents);
  const space = spaceScore(data.spaceWeather);

  const components = {
    seismic,
    surface: eonet.surface,
    atmosphere: eonet.atmosphere,
    space,
  };

  let weightedScore = 0;
  let activeWeight = 0;
  for (const [name, value] of Object.entries(components)) {
    if (!Number.isFinite(value)) continue;
    const weight = CONFIG.planetaryWeights[name];
    weightedScore += value * weight;
    activeWeight += weight;
  }

  if (activeWeight === 0) {
    return { score: null, label: 'CALCULATING', components };
  }

  const score = Math.round(weightedScore / activeWeight);
  return { score, label: labelForScore(score), components };
}
