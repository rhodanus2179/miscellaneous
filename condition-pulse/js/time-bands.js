import { DEFAULT_SETTINGS } from './config.js';

export function timeToMinutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return 0;
  const [hours, minutes] = value.split(':').map(Number);
  return ((hours % 24) * 60) + Math.min(59, Math.max(0, minutes));
}

export function getTimeBand(date = new Date(), settings = DEFAULT_SETTINGS) {
  const bands = settings?.timeBands ?? DEFAULT_SETTINGS.timeBands;
  const current = date.getHours() * 60 + date.getMinutes();
  const morningStart = timeToMinutes(bands.morning?.[0] ?? '05:00');
  const daytimeStart = timeToMinutes(bands.daytime?.[0] ?? '11:00');
  const eveningStart = timeToMinutes(bands.evening?.[0] ?? '17:00');

  if (current >= morningStart && current < daytimeStart) return 'morning';
  if (current >= daytimeStart && current < eveningStart) return 'daytime';
  return 'evening';
}

export function toLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getObservationDate(date = new Date(), settings = DEFAULT_SETTINGS) {
  const band = getTimeBand(date, settings);
  const morningStart = timeToMinutes(settings?.timeBands?.morning?.[0] ?? '05:00');
  const current = date.getHours() * 60 + date.getMinutes();
  const adjusted = new Date(date);
  if (band === 'evening' && current < morningStart) adjusted.setDate(adjusted.getDate() - 1);
  return toLocalDate(adjusted);
}

export function formatDateJa(localDate) {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'long', day: 'numeric', weekday: 'long'
  }).format(new Date(year, month - 1, day));
}

export function getNextBand(timeBand) {
  return timeBand === 'morning' ? 'daytime' : timeBand === 'daytime' ? 'evening' : 'morning';
}
