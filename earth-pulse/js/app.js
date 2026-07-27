import { CONFIG } from './config.js';
import {
  getState,
  setSourceLoading,
  subscribe,
  updateState,
} from './state.js';
import { getMoonPhase, getSubsolarPoint } from './astronomy.js';
import { calculatePlanetaryState } from './planetary-state.js';
import { fetchEarthquakes } from './data/usgs.js';
import { fetchEonetEvents } from './data/eonet.js';
import { fetchSpaceWeather } from './data/swpc.js';
import {
  fetchIssOrbit,
  fetchIssFallbackPosition,
  updateLocalSatellitePosition,
} from './data/celestrak.js';
import { EarthGlobe } from './globe.js';
import { EarthPulseUI } from './ui.js';

function webGlAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext
      && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}

function recalculatePlanetaryState(draft) {
  draft.planetaryState = calculatePlanetaryState(draft.data);
}

function cycleLayer(layer) {
  updateState((draft) => {
    const active = new Set(draft.ui.activeLayers);
    if (!active.has(layer)) {
      active.add(layer);
      draft.ui.focusedLayer = null;
    } else if (draft.ui.focusedLayer === layer) {
      active.delete(layer);
      draft.ui.focusedLayer = null;
    } else {
      draft.ui.focusedLayer = layer;
    }
    draft.ui.activeLayers = CONFIG.layers.filter((name) => active.has(name));
    draft.ui.lastInteractionAt = Date.now();
  }, { persistUi: true });
}

let globe = null;
let ui = null;
let refreshInProgress = false;
const timers = [];

async function refreshUsgs() {
  setSourceLoading('usgs');
  const result = await fetchEarthquakes();
  updateState((draft) => {
    if (result.events.length || result.meta.status !== 'unavailable') {
      draft.data.earthquakes = result.events;
    }
    draft.sources.usgs = { ...draft.sources.usgs, ...result.meta };
    recalculatePlanetaryState(draft);
  });
}

async function refreshEonet() {
  setSourceLoading('eonet');
  const result = await fetchEonetEvents();
  updateState((draft) => {
    if (result.events.length || result.meta.status !== 'unavailable') {
      draft.data.eonetEvents = result.events;
    }
    draft.sources.eonet = { ...draft.sources.eonet, ...result.meta };
    recalculatePlanetaryState(draft);
  });
}

async function refreshSwpc() {
  setSourceLoading('swpc');
  const result = await fetchSpaceWeather();
  updateState((draft) => {
    if (result.weather || result.meta.status !== 'unavailable') {
      draft.data.spaceWeather = result.weather;
    }
    draft.sources.swpc = { ...draft.sources.swpc, ...result.meta };
    recalculatePlanetaryState(draft);
  });
}

async function refreshIss() {
  setSourceLoading('celestrak');
  const result = await fetchIssOrbit();
  updateState((draft) => {
    if (result.satellite) draft.data.satellite = result.satellite;
    draft.sources.celestrak = { ...draft.sources.celestrak, ...result.meta };
  });
}

async function refreshIssFallback() {
  const current = getState().data.satellite;
  if (!current || current.satrec) return;

  const result = await fetchIssFallbackPosition();
  updateState((draft) => {
    if (result.satellite) draft.data.satellite = result.satellite;
    draft.sources.celestrak = { ...draft.sources.celestrak, ...result.meta };
  });
}

async function refreshAll() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    await Promise.allSettled([refreshUsgs(), refreshEonet(), refreshSwpc(), refreshIss()]);
  } finally {
    refreshInProgress = false;
  }
}

function startTimers() {
  timers.push(setInterval(refreshUsgs, CONFIG.refreshIntervals.usgs));
  timers.push(setInterval(refreshEonet, CONFIG.refreshIntervals.eonet));
  timers.push(setInterval(refreshSwpc, CONFIG.refreshIntervals.swpc));
  timers.push(setInterval(refreshIss, CONFIG.refreshIntervals.celestrak));
  timers.push(setInterval(refreshIssFallback, CONFIG.refreshIntervals.issFallback));

  let astronomyTick = 0;
  timers.push(setInterval(() => {
    const now = new Date();
    astronomyTick += 1;
    updateState((draft) => {
      draft.clock.now = now;
      if (astronomyTick % 10 === 0) {
        draft.clock.subsolarPoint = getSubsolarPoint(now);
        draft.clock.moonPhase = getMoonPhase(now);
      }
      if (draft.data.satellite?.satrec) {
        draft.data.satellite = updateLocalSatellitePosition(draft.data.satellite, now);
      }
    });
  }, 1_000));
}

function setupRendering() {
  const globeContainer = document.querySelector('#globe');
  ui = new EarthPulseUI({
    onCycleLayer: cycleLayer,
    onDeselect: () => updateState((draft) => { draft.ui.selectedEventId = null; }),
    onToggleAmbient: () => updateState((draft) => {
      draft.ui.ambientMode = !draft.ui.ambientMode;
    }, { persistUi: true }),
    onToggleAutoRotate: () => updateState((draft) => {
      draft.ui.autoRotate = !draft.ui.autoRotate;
    }, { persistUi: true }),
    onRefresh: refreshAll,
    onToggleSourcePanel: () => updateState((draft) => {
      draft.ui.sourcePanelOpen = !draft.ui.sourcePanelOpen;
    }),
    onOpenAbout: () => updateState((draft) => { draft.ui.aboutOpen = true; }),
    onCloseAbout: () => updateState((draft) => { draft.ui.aboutOpen = false; }),
  });

  if (!webGlAvailable()) {
    ui.showFatalError('WEBGL IS NOT AVAILABLE — Earth Pulse requires a modern browser with hardware acceleration enabled.');
    return;
  }

  try {
    globe = new EarthGlobe(globeContainer, {
      onSelect: (event) => {
        updateState((draft) => {
          draft.ui.selectedEventId = event.id;
          draft.ui.lastInteractionAt = Date.now();
        });
        globe.focusEvent(event);
      },
      onDeselect: () => updateState((draft) => { draft.ui.selectedEventId = null; }),
    });
  } catch (error) {
    console.error('Earth Pulse could not initialize the globe.', error);
    ui.showFatalError('THE 3D EARTH COULD NOT BE INITIALIZED — Check the network connection and reload.');
  }

  let previous = {
    earthquakes: null,
    eonetEvents: null,
    satellite: null,
    spaceWeather: null,
    layerKey: '',
    selectedEventId: null,
    autoRotate: null,
    subsolarKey: '',
  };

  subscribe((state) => {
    ui.render(state);
    if (!globe) return;

    const layerKey = `${state.ui.activeLayers.join(',')}|${state.ui.focusedLayer || ''}`;
    const sun = state.clock.subsolarPoint;
    const subsolarKey = `${sun.latitude.toFixed(3)}:${sun.longitude.toFixed(3)}`;
    const sceneDataChanged = previous.earthquakes !== state.data.earthquakes
      || previous.eonetEvents !== state.data.eonetEvents
      || previous.spaceWeather !== state.data.spaceWeather
      || previous.layerKey !== layerKey;
    const satelliteChanged = previous.satellite !== state.data.satellite
      || previous.layerKey !== layerKey
      || previous.selectedEventId !== state.ui.selectedEventId;

    if (sceneDataChanged) globe.setData(state);
    else if (satelliteChanged) globe.setSatelliteData(state);
    if (previous.autoRotate !== state.ui.autoRotate) globe.setAutoRotate(state.ui.autoRotate);
    if (previous.subsolarKey !== subsolarKey) globe.setSunPosition(sun.latitude, sun.longitude);

    previous = {
      earthquakes: state.data.earthquakes,
      eonetEvents: state.data.eonetEvents,
      satellite: state.data.satellite,
      spaceWeather: state.data.spaceWeather,
      layerKey,
      selectedEventId: state.ui.selectedEventId,
      autoRotate: state.ui.autoRotate,
      subsolarKey,
    };
  });

  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener?.('change', (event) => globe?.setReducedMotion(event.matches));
}

function initializeClock() {
  const now = new Date();
  updateState((draft) => {
    draft.clock.now = now;
    draft.clock.subsolarPoint = getSubsolarPoint(now);
    draft.clock.moonPhase = getMoonPhase(now);
  });
}

function initialize() {
  setupRendering();
  initializeClock();
  const state = getState();
  ui?.render(state);
  globe?.setSunPosition(state.clock.subsolarPoint.latitude, state.clock.subsolarPoint.longitude);
  globe?.setAutoRotate(state.ui.autoRotate);
  globe?.setData(state);
  refreshAll();
  startTimers();
}

window.addEventListener('beforeunload', () => {
  timers.forEach(clearInterval);
  globe?.destroy();
});

window.addEventListener('error', (event) => {
  console.error('Earth Pulse runtime error:', event.error || event.message);
});

initialize();
