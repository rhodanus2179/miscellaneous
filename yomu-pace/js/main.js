import { initializeApp, toast } from './app.js';

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          toast('新しい版があります。読書位置を保存してからページを再読み込みしてください。');
        }
      });
    });
  } catch (error) {
    console.warn('Service Worker registration failed', error);
  }
}

window.addEventListener('error', (event) => console.error('Unhandled error', event.error));
window.addEventListener('unhandledrejection', (event) => console.error('Unhandled rejection', event.reason));

await initializeApp();
void registerServiceWorker();
