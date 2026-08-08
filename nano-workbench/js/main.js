import { startApp } from './app.js';

startApp().catch((error) => {
  console.error(error);
  const root = document.querySelector('#fatal-error');
  if (root) {
    root.hidden = false;
    root.textContent = `起動に失敗しました: ${error.message}`;
  }
});
