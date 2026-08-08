import { startApp } from './app.js';
import { prepareWorkspace, mountWorkspace } from './workspace/index.js';

(async () => {
  try {
    await prepareWorkspace();
    await startApp();
    await mountWorkspace();
  } catch (error) {
    console.error(error);
    const root = document.querySelector('#fatal-error');
    if (root) {
      root.hidden = false;
      root.textContent = `起動に失敗しました: ${error.message}`;
    }
  }
})();
