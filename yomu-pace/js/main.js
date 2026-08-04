import { initializeApp } from './app.js';
import { toast } from './ui.js';

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

function showStartupError(error) {
  console.error('Yomu Pace startup failed', error);
  const app = document.querySelector('#app');
  if (!app) return;
  const section = document.createElement('section');
  section.className = 'screen narrow';
  const heading = document.createElement('h1');
  heading.textContent = 'アプリを起動できませんでした';
  const message = document.createElement('p');
  message.textContent = 'ページを再読み込みしてください。改善しない場合は、ブラウザのサイトデータを削除して再度お試しください。';
  section.append(heading, message);
  app.replaceChildren(section);
}

window.addEventListener('error', (event) => console.error('Unhandled error', event.error));
window.addEventListener('unhandledrejection', (event) => console.error('Unhandled rejection', event.reason));

try {
  await initializeApp();
  void registerServiceWorker();
} catch (error) {
  showStartupError(error);
}
