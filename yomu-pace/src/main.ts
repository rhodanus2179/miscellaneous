import './styles.css';
import { App } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('アプリの表示領域が見つかりません。');

const app = new App(root);
void app.start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      const offerWaiting = (): void => {
        if (registration.waiting) app.offerUpdate(() => registration.waiting?.postMessage({ type: 'SKIP_WAITING' }));
      };
      offerWaiting();
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) offerWaiting();
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
    } catch (error) {
      console.warn('Service Workerを登録できませんでした。', error);
    }
  });
}
