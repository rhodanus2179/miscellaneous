import { CONFIG, SOURCE_KEYS, SOURCE_LABELS } from './config.js';
import { formatUtc, getMoonPhaseLabel } from './astronomy.js';

function formatRelative(iso) {
  if (!iso) return 'Unknown time';
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 'Unknown time';
  const seconds = Math.round((time - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (absolute < 60) return formatter.format(seconds, 'second');
  if (absolute < 3_600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (absolute < 86_400) return formatter.format(Math.round(seconds / 3_600), 'hour');
  return formatter.format(Math.round(seconds / 86_400), 'day');
}

function formatCoordinate(value, positive, negative) {
  if (!Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return `${Math.abs(number).toFixed(2)}° ${number >= 0 ? positive : negative}`;
}

function sourceDisplayStatus(key, source) {
  if (source.status === 'loading') return { label: 'LOADING', className: 'loading' };
  if (source.status === 'unavailable' || source.status === 'idle') {
    return { label: source.status === 'idle' ? 'WAITING' : 'UNAVAILABLE', className: 'offline' };
  }
  if (source.status === 'cache') return { label: 'LAST KNOWN', className: 'cached' };

  const fetchedAt = new Date(source.fetchedAt).getTime();
  const staleLimit = CONFIG.staleAfter[key] || 30 * 60 * 1000;
  if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt > staleLimit) {
    return { label: 'STALE', className: 'cached' };
  }
  return { label: 'LIVE', className: 'live' };
}

function metricRow(label, value) {
  const row = document.createElement('div');
  row.className = 'detail-metric';
  const key = document.createElement('span');
  key.textContent = label;
  const content = document.createElement('strong');
  content.textContent = value;
  row.append(key, content);
  return row;
}

function eventMetrics(event) {
  if (event.category === 'earthquake') {
    return [
      ['MAGNITUDE', Number(event.metadata?.magnitude).toFixed(1)],
      ['DEPTH', Number.isFinite(event.metadata?.depthKm) ? `${event.metadata.depthKm.toFixed(1)} km` : '—'],
      ['TSUNAMI FLAG', event.metadata?.tsunami ? 'YES' : 'NO'],
    ];
  }
  if (event.category === 'satellite') {
    return [
      ['ALTITUDE', Number.isFinite(event.metadata?.altitudeKm) ? `${Math.round(event.metadata.altitudeKm)} km` : '—'],
      ['VELOCITY', Number.isFinite(event.metadata?.velocityKmS) ? `${event.metadata.velocityKmS.toFixed(2)} km/s` : '—'],
      ['POSITION', `${formatCoordinate(event.latitude, 'N', 'S')} · ${formatCoordinate(event.longitude, 'E', 'W')}`],
    ];
  }

  const magnitude = event.metadata?.magnitudeValue;
  const magnitudeText = magnitude == null
    ? null
    : `${magnitude}${event.metadata?.magnitudeUnit ? ` ${event.metadata.magnitudeUnit}` : ''}`;
  return [
    ['CATEGORY', event.category.replace(/([A-Z])/g, ' $1').toUpperCase()],
    ['POSITION', `${formatCoordinate(event.latitude, 'N', 'S')} · ${formatCoordinate(event.longitude, 'E', 'W')}`],
    ...(magnitudeText ? [['MAGNITUDE', magnitudeText]] : []),
  ];
}

export class EarthPulseUI {
  constructor(actions) {
    this.actions = actions;
    this.elements = {
      utc: document.querySelector('#utc-clock'),
      dataSummary: document.querySelector('#data-summary'),
      stateLabel: document.querySelector('#planetary-state-label'),
      stateScore: document.querySelector('#planetary-state-score'),
      stateBars: document.querySelector('#state-components'),
      moon: document.querySelector('#moon-phase'),
      eventCounts: document.querySelector('#event-counts'),
      spaceWeather: document.querySelector('#space-weather'),
      detail: document.querySelector('#detail-card'),
      detailType: document.querySelector('#detail-type'),
      detailTitle: document.querySelector('#detail-title'),
      detailWhen: document.querySelector('#detail-when'),
      detailMetrics: document.querySelector('#detail-metrics'),
      detailSource: document.querySelector('#detail-source'),
      detailLink: document.querySelector('#detail-link'),
      sourcePanel: document.querySelector('#source-panel'),
      sourceList: document.querySelector('#source-list'),
      ambientButton: document.querySelector('#ambient-button'),
      rotateButton: document.querySelector('#rotate-button'),
      refreshButton: document.querySelector('#refresh-button'),
      sourceButton: document.querySelector('#source-button'),
      aboutButton: document.querySelector('#about-button'),
      aboutDialog: document.querySelector('#about-dialog'),
      errorBanner: document.querySelector('#error-banner'),
    };

    this.layerButtons = [...document.querySelectorAll('[data-layer]')];
    this.bindEvents();
  }

  bindEvents() {
    for (const button of this.layerButtons) {
      button.addEventListener('click', () => this.actions.onCycleLayer(button.dataset.layer));
    }
    document.querySelector('#detail-close').addEventListener('click', this.actions.onDeselect);
    this.elements.ambientButton.addEventListener('click', this.actions.onToggleAmbient);
    this.elements.rotateButton.addEventListener('click', this.actions.onToggleAutoRotate);
    this.elements.refreshButton.addEventListener('click', this.actions.onRefresh);
    this.elements.sourceButton.addEventListener('click', this.actions.onToggleSourcePanel);
    this.elements.aboutButton.addEventListener('click', this.actions.onOpenAbout);
    document.querySelector('#about-close').addEventListener('click', this.actions.onCloseAbout);
    this.elements.aboutDialog.addEventListener('click', (event) => {
      if (event.target === this.elements.aboutDialog) this.actions.onCloseAbout();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.actions.onDeselect();
        this.actions.onCloseAbout();
        if (document.body.classList.contains('ambient')) this.actions.onToggleAmbient();
      }
      if (event.key.toLowerCase() === 'a' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        this.actions.onToggleAmbient();
      }
    });
  }

  render(state) {
    this.renderHeader(state);
    this.renderLayers(state);
    this.renderPlanetaryState(state);
    this.renderSpaceWeather(state);
    this.renderDetail(state);
    this.renderSources(state);
    this.renderModes(state);
  }

  renderHeader(state) {
    this.elements.utc.textContent = `${formatUtc(state.clock.now)} UTC`;
    const online = SOURCE_KEYS.filter((key) => ['live', 'cache'].includes(state.sources[key].status)).length;
    this.elements.dataSummary.textContent = `DATA ${online}/${SOURCE_KEYS.length} ONLINE`;
    this.elements.dataSummary.dataset.state = online === SOURCE_KEYS.length ? 'ok' : online > 0 ? 'partial' : 'offline';
  }

  renderLayers(state) {
    const active = new Set(state.ui.activeLayers);
    for (const button of this.layerButtons) {
      const layer = button.dataset.layer;
      const mode = !active.has(layer) ? 'OFF' : state.ui.focusedLayer === layer ? 'FOCUS' : 'ON';
      button.dataset.mode = mode.toLowerCase();
      button.setAttribute('aria-pressed', String(mode !== 'OFF'));
      button.querySelector('.layer-mode').textContent = mode;
    }
  }

  renderPlanetaryState(state) {
    const planetary = state.planetaryState;
    this.elements.stateLabel.textContent = planetary.label;
    this.elements.stateScore.textContent = Number.isFinite(planetary.score)
      ? `${planetary.score.toString().padStart(2, '0')} / 100`
      : '— / 100';
    this.elements.stateLabel.dataset.state = planetary.label.toLowerCase();

    this.elements.stateBars.replaceChildren();
    const labels = {
      seismic: 'CRUST',
      surface: 'SURFACE',
      atmosphere: 'AIR',
      space: 'SPACE',
    };
    for (const [key, label] of Object.entries(labels)) {
      const value = planetary.components[key];
      const row = document.createElement('div');
      row.className = 'component-row';
      const name = document.createElement('span');
      name.textContent = label;
      const track = document.createElement('span');
      track.className = 'component-track';
      const fill = document.createElement('span');
      fill.className = 'component-fill';
      fill.style.width = `${Number.isFinite(value) ? value : 0}%`;
      track.append(fill);
      const number = document.createElement('span');
      number.textContent = Number.isFinite(value) ? Math.round(value) : '—';
      row.append(name, track, number);
      this.elements.stateBars.append(row);
    }

    this.elements.moon.textContent = getMoonPhaseLabel(state.clock.moonPhase);
    this.elements.eventCounts.textContent = [
      `${state.data.earthquakes.length} QUAKES`,
      `${state.data.eonetEvents.length} EVENTS`,
      state.data.satellite ? 'ISS TRACKED' : 'ISS OFFLINE',
    ].join(' · ');
  }

  renderSpaceWeather(state) {
    const weather = state.data.spaceWeather;
    const fields = [
      ['SOLAR WIND', Number.isFinite(weather?.solarWindSpeed) ? `${Math.round(weather.solarWindSpeed)} km/s` : '—'],
      ['Kp INDEX', Number.isFinite(weather?.kp) ? weather.kp.toFixed(2) : '—'],
      ['Bz GSM', Number.isFinite(weather?.bz) ? `${weather.bz.toFixed(1)} nT` : '—'],
      ['FIELD', Number.isFinite(weather?.bt) ? `${weather.bt.toFixed(1)} nT` : '—'],
    ];

    this.elements.spaceWeather.replaceChildren();
    for (const [label, value] of fields) {
      const row = document.createElement('div');
      const key = document.createElement('span');
      key.textContent = label;
      const content = document.createElement('strong');
      content.textContent = value;
      row.append(key, content);
      this.elements.spaceWeather.append(row);
    }
  }

  renderDetail(state) {
    const allEvents = [
      ...state.data.earthquakes,
      ...state.data.eonetEvents,
      ...(state.data.satellite ? [state.data.satellite] : []),
    ];
    const selected = allEvents.find((event) => event.id === state.ui.selectedEventId);

    if (!selected) {
      this.elements.detail.hidden = true;
      return;
    }

    this.elements.detail.hidden = false;
    this.elements.detailType.textContent = selected.category.replace(/([A-Z])/g, ' $1').toUpperCase();
    this.elements.detailTitle.textContent = selected.title;
    this.elements.detailWhen.textContent = `${formatRelative(selected.occurredAt)} · updated ${formatRelative(selected.updatedAt)}`;
    this.elements.detailMetrics.replaceChildren(...eventMetrics(selected).map(([label, value]) => metricRow(label, value)));
    this.elements.detailSource.textContent = `Source: ${selected.source}`;

    if (selected.sourceUrl) {
      this.elements.detailLink.hidden = false;
      this.elements.detailLink.href = selected.sourceUrl;
    } else {
      this.elements.detailLink.hidden = true;
      this.elements.detailLink.removeAttribute('href');
    }
  }

  renderSources(state) {
    this.elements.sourcePanel.hidden = !state.ui.sourcePanelOpen;
    this.elements.sourceButton.setAttribute('aria-expanded', String(state.ui.sourcePanelOpen));
    this.elements.sourceList.replaceChildren();

    for (const key of SOURCE_KEYS) {
      const source = state.sources[key];
      const display = sourceDisplayStatus(key, source);
      const item = document.createElement('li');
      const heading = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = SOURCE_LABELS[key];
      const badge = document.createElement('span');
      badge.className = `source-status ${display.className}`;
      badge.textContent = display.label;
      heading.append(name, badge);

      const detail = document.createElement('small');
      const freshness = source.dataUpdatedAt || source.fetchedAt;
      detail.textContent = freshness ? `Data ${formatRelative(freshness)}` : 'No data received yet';
      item.append(heading, detail);
      this.elements.sourceList.append(item);
    }
  }

  renderModes(state) {
    document.body.classList.toggle('ambient', state.ui.ambientMode);
    this.elements.ambientButton.setAttribute('aria-pressed', String(state.ui.ambientMode));
    this.elements.rotateButton.setAttribute('aria-pressed', String(state.ui.autoRotate));
    this.elements.rotateButton.querySelector('.control-value').textContent = state.ui.autoRotate ? 'ON' : 'OFF';

    if (state.ui.aboutOpen && !this.elements.aboutDialog.open) this.elements.aboutDialog.showModal();
    if (!state.ui.aboutOpen && this.elements.aboutDialog.open) this.elements.aboutDialog.close();
  }

  showFatalError(message) {
    this.elements.errorBanner.hidden = false;
    this.elements.errorBanner.textContent = message;
  }
}
