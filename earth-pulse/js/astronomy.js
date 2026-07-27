const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function normalizeLongitude(value) {
  return ((value + 540) % 360) - 180;
}

export function getSubsolarPoint(date = new Date()) {
  const julianDate = date.getTime() / 86_400_000 + 2_440_587.5;
  const n = julianDate - 2_451_545.0;
  const meanLongitude = (280.460 + 0.9856474 * n) % 360;
  const meanAnomaly = (357.528 + 0.9856003 * n) % 360;
  const eclipticLongitude = meanLongitude
    + 1.915 * Math.sin(meanAnomaly * RAD)
    + 0.020 * Math.sin(2 * meanAnomaly * RAD);
  const obliquity = 23.439 - 0.0000004 * n;

  const rightAscension = Math.atan2(
    Math.cos(obliquity * RAD) * Math.sin(eclipticLongitude * RAD),
    Math.cos(eclipticLongitude * RAD),
  ) * DEG;
  const declination = Math.asin(
    Math.sin(obliquity * RAD) * Math.sin(eclipticLongitude * RAD),
  ) * DEG;

  const gmst = (280.46061837 + 360.98564736629 * (julianDate - 2_451_545.0)) % 360;

  return {
    latitude: declination,
    longitude: normalizeLongitude(rightAscension - gmst),
  };
}

export function getMoonPhase(date = new Date()) {
  const synodicMonth = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  const days = (date.getTime() - knownNewMoon) / 86_400_000;
  return ((days % synodicMonth) + synodicMonth) % synodicMonth / synodicMonth;
}

export function getMoonPhaseLabel(phase) {
  if (phase < 0.03 || phase > 0.97) return 'NEW MOON';
  if (phase < 0.22) return 'WAXING CRESCENT';
  if (phase < 0.28) return 'FIRST QUARTER';
  if (phase < 0.47) return 'WAXING GIBBOUS';
  if (phase < 0.53) return 'FULL MOON';
  if (phase < 0.72) return 'WANING GIBBOUS';
  if (phase < 0.78) return 'LAST QUARTER';
  return 'WANING CRESCENT';
}

export function formatUtc(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(',', '');
}
