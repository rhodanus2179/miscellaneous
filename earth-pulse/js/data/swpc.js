import { CONFIG } from '../config.js';
import { fetchJsonWithCache, toIsoUtc } from './fetch.js';

function firstRecord(value) {
  return Array.isArray(value) ? value[0] : null;
}

function lastRecord(value) {
  return Array.isArray(value) && value.length ? value[value.length - 1] : null;
}

function combineStatus(results) {
  const statuses = results.map((result) => result.meta.status);
  if (statuses.includes('live')) return 'live';
  if (statuses.includes('cache')) return 'cache';
  return 'unavailable';
}

export async function fetchSpaceWeather() {
  const [speedResult, fieldResult, kpResult] = await Promise.all([
    fetchJsonWithCache({
      url: CONFIG.api.swpc.solarWindSpeed,
      key: 'swpc-solar-wind-speed',
    }),
    fetchJsonWithCache({
      url: CONFIG.api.swpc.magneticField,
      key: 'swpc-magnetic-field',
    }),
    fetchJsonWithCache({
      url: CONFIG.api.swpc.kpIndex,
      key: 'swpc-kp-index',
    }),
  ]);

  const speed = firstRecord(speedResult.data);
  const field = firstRecord(fieldResult.data);
  const kp = lastRecord(kpResult.data);

  const updatedCandidates = [speed?.time_tag, field?.time_tag, kp?.time_tag]
    .map(toIsoUtc)
    .filter(Boolean)
    .sort();

  const weather = {
    solarWindSpeed: Number.isFinite(Number(speed?.proton_speed)) ? Number(speed.proton_speed) : null,
    bt: Number.isFinite(Number(field?.bt)) ? Number(field.bt) : null,
    bz: Number.isFinite(Number(field?.bz_gsm)) ? Number(field.bz_gsm) : null,
    kp: Number.isFinite(Number(kp?.Kp)) ? Number(kp.Kp) : null,
    updatedAt: updatedCandidates.at(-1) || null,
  };

  const hasAnyValue = [weather.solarWindSpeed, weather.bt, weather.bz, weather.kp]
    .some(Number.isFinite);

  return {
    weather: hasAnyValue ? weather : null,
    meta: {
      status: combineStatus([speedResult, fieldResult, kpResult]),
      fetchedAt: new Date().toISOString(),
      dataUpdatedAt: weather.updatedAt,
      fromCache: [speedResult, fieldResult, kpResult].every((result) => result.meta.fromCache),
      error: [speedResult, fieldResult, kpResult]
        .map((result) => result.meta.error)
        .filter(Boolean)
        .join('; ') || null,
    },
  };
}
