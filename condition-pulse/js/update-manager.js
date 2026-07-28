export async function setupUpdateManager({ onUpdateAvailable, onControllerChange } = {}) {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
    return { registration: null, applyUpdate: () => false };
  }

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    onControllerChange?.();
  });

  const registration = await navigator.serviceWorker.register('./sw.js');
  const notify = worker => {
    if (worker) onUpdateAvailable?.(worker);
  };

  if (registration.waiting && navigator.serviceWorker.controller) notify(registration.waiting);

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) notify(registration.waiting ?? installing);
    });
  });

  const applyUpdate = worker => {
    const target = worker ?? registration.waiting;
    if (!target) return false;
    target.postMessage({ type: 'SKIP_WAITING' });
    return true;
  };

  return { registration, applyUpdate };
}
