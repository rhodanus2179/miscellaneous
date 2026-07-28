export function createRouter(onRoute) {
  const readRoute = () => location.hash.replace(/^#\/?/, '') || 'home';
  const handle = () => onRoute(readRoute());
  window.addEventListener('hashchange', handle);
  return {
    start() { handle(); },
    go(route) { location.hash = `#/${route}`; },
    current: readRoute
  };
}
