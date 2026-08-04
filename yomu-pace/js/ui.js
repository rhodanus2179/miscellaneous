const app = document.querySelector('#app');
const header = document.querySelector('#app-header');
const toastRegion = document.querySelector('#toast-region');

export { app };

export function h(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child instanceof Node) element.append(child);
    else if (child !== undefined && child !== null) element.append(document.createTextNode(String(child)));
  }
  return element;
}

export function button(label, action, className = 'button') {
  return h('button', { type: 'button', class: className, text: label, onclick: action });
}

export function navigate(path) {
  location.hash = path;
}

export function toast(message) {
  const item = h('div', { class: 'toast', text: message });
  toastRegion.append(item);
  setTimeout(() => item.remove(), 3200);
}

export function setBusy(message) {
  app.replaceChildren(h('section', { class: 'screen center' }, [h('div', { class: 'spinner' }), h('p', { text: message })]));
}

export function formatNumber(value) {
  return new Intl.NumberFormat('ja-JP').format(value);
}

export function renderHeader(title = 'Yomu Pace', compact = false) {
  header.replaceChildren(
    h('a', { href: '#/library', class: 'brand', 'aria-label': 'ライブラリへ' }, [
      h('span', { class: 'brand-mark', text: 'YP' }),
      h('span', { class: compact ? 'visually-hidden' : '', text: title }),
    ]),
    h('nav', { class: 'top-nav', 'aria-label': '主要メニュー' }, [
      h('a', { href: '#/import', text: '取込み' }),
      h('a', { href: '#/settings', text: '設定' }),
    ]),
  );
}
