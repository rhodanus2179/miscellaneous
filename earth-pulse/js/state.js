import { CONFIG, SOURCE_KEYS } from './config.js';

const SETTINGS_KEY = `${CONFIG.cachePrefix}:settings`;

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      activeLayers: Array.isArray(parsed.activeLayers)
        ? parsed.activeLayers.filter((layer) => CONFIG.layers.includes(layer))
        : [...CONFIG.layers],
      focusedLayer: CONFIG.layers.includes(parsed.focusedLayer) ? parsed.focusedLayer : null,
      ambientMode: Boolean(parsed.ambientMode),
      autoRotate: parsed.autoRotate !== false,
    };
  } catch {
    return {
      activeLayers: [...CONFIG.layers],
      focusedLayer: null,
      ambientMode: false,
      autoRotate: true,
    };
  }
}

const saved = loadSettings();

const initialSources = Object.fromEntries(
  SOURCE_KEYS.map((key) => [key, {
    status: 'idle',
    fetchedAt: null,
    dataUpdatedAt: null,
    fromCache: false,
    error: null,
  }]),
);

const state = {
  ui: {
    ...saved,
    selectedEventId: null,
    aboutOpen: false,
    sourcePanelOpen: false,
    lastInteractionAt: Date.now(),
  },
  clock: {
    now: new Date(),
    subsolarPoint: { latitude: 0, longitude: 0 },
    moonPhase: 0,
  },
  data: {
    earthquakes: [],
    eonetEvents: [],
    spaceWeather: null,
    satellite: null,
  },
  sources: initialSources,
  planetaryState: {
    score: null,
    label: 'CALCULATING',
    components: {},
  },
};

const listeners = new Set();

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      activeLayers: state.ui.activeLayers,
      focusedLayer: state.ui.focusedLayer,
      ambientMode: state.ui.ambientMode,
      autoRotate: state.ui.autoRotate,
    }));
  } catch (error) {
    console.debug('Earth Pulse: settings could not be saved.', error);
  }
}

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateState(mutator, options = {}) {
  mutator(state);
  if (options.persistUi) persistSettings();
  for (const listener of listeners) listener(state);
}

export function setSourceLoading(key) {
  updateState((draft) => {
    draft.sources[key] = {
      ...draft.sources[key],
      status: 'loading',
      error: null,
    };
  });
}

export function setSourceResult(key, meta) {
  updateState((draft) => {
    draft.sources[key] = {
      ...draft.sources[key],
      status: meta.status,
      fetchedAt: meta.fetchedAt || new Date().toISOString(),
      dataUpdatedAt: meta.dataUpdatedAt || null,
      fromCache: Boolean(meta.fromCache),
      error: meta.error || null,
    };
  });
}
