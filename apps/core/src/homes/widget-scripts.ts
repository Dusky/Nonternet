import { en } from '@app/strings';
import type { StringKey } from '@app/strings';

// The four widgets, as small scripts a person pastes into their page (docs/07). They run on the
// homepage's own origin, talk to the site's public widget API (no cookies, no login), and build
// their output with textContent only, so nothing a visitor types can become markup.
const text = (keys: StringKey[]) => JSON.stringify(Object.fromEntries(keys.map((k) => [k, en[k]])));

const PRELUDE = (keys: StringKey[]) => `(function () {
  var script = document.currentScript;
  var user = script && script.getAttribute('data-user');
  if (!user) return;
  var api = new URL(script.src).origin + '/api/v1/widgets/' + encodeURIComponent(user);
  var T = ${text(keys)};
  function t(key, vars) { return (T[key] || key).replace(/\\{(\\w+)\\}/g, function (_, k) { return vars && vars[k] != null ? vars[k] : ''; }); }
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    for (var k in props || {}) { if (k === 'text') e.textContent = props[k]; else if (k === 'style') e.style.cssText = props[k]; else e.setAttribute(k, props[k]); }
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function mount(node) { script.parentNode.insertBefore(node, script); }
  function get(path) { return fetch(api + path).then(function (r) { return r.json(); }); }
`;

const SCRIPTS: Record<string, string> = {
  counter: PRELUDE(['widgets.counter.label']) + `
  var seen = 'home-counter-' + user;
  var counted = false;
  try { counted = sessionStorage.getItem(seen) === '1'; } catch (e) {}
  var request = counted ? get('/counter') : fetch(api + '/hit', { method: 'POST' }).then(function (r) { return r.json(); });
  request.then(function (d) {
    try { sessionStorage.setItem(seen, '1'); } catch (e) {}
    var shown = String(d.count).padStart(6, '0');
    mount(el('span', { text: shown, 'aria-label': t('widgets.counter.label', { count: d.count }), style: 'display:inline-block;font:bold 16px monospace;letter-spacing:3px;background:#000;color:#3f3;padding:2px 8px;border:2px inset #888' }));
  }).catch(function () {});
})();`,

  updated: PRELUDE(['widgets.updated.label', 'widgets.updated.never']) + `
  get('/status').then(function (d) {
    var label = d.updated ? t('widgets.updated.label', { date: new Date(d.updated).toLocaleDateString(undefined, { dateStyle: 'medium' }) }) : t('widgets.updated.never');
    mount(el('span', { text: label }));
  }).catch(function () {});
})();`,

  online: PRELUDE(['widgets.online.yes', 'widgets.online.no']) + `
  get('/status').then(function (d) {
    mount(el('span', { text: (d.online ? '\\u25CF ' : '\\u25CB ') + t(d.online ? 'widgets.online.yes' : 'widgets.online.no') }));
  }).catch(function () {});
})();`,

  guestbook: PRELUDE(['widgets.guestbook.title', 'widgets.guestbook.none', 'widgets.guestbook.name', 'widgets.guestbook.url', 'widgets.guestbook.message', 'widgets.guestbook.sign', 'widgets.guestbook.thanks', 'widgets.guestbook.pending', 'widgets.guestbook.closed', 'widgets.guestbook.error']) + `
  var box = el('section', { 'aria-label': t('widgets.guestbook.title'), style: 'border:1px solid #888;padding:8px;max-width:32rem' });
  var list = el('div', {});
  var form = el('form', { style: 'margin-top:8px' });
  function field(label, name, tag) {
    var id = 'gb-' + name + '-' + Math.random().toString(36).slice(2, 7);
    var input = el(tag || 'input', { id: id, name: name, style: 'display:block;width:100%;box-sizing:border-box;margin:2px 0 6px' });
    if (name === 'name' || name === 'message') input.required = true;
    if (name === 'message') { input.rows = 3; input.maxLength = 500; }
    return [el('label', { for: id, text: label, style: 'font-size:.85em' }), input];
  }
  [].concat(field(t('widgets.guestbook.name'), 'name'), field(t('widgets.guestbook.url'), 'url'), field(t('widgets.guestbook.message'), 'message', 'textarea')).forEach(function (n) { form.appendChild(n); });
  // A field only a bot would fill in. A person never sees it.
  var trap = el('input', { name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', style: 'position:absolute;left:-9999px;width:1px;height:1px' });
  form.appendChild(trap);
  var status = el('p', { role: 'status', style: 'margin:6px 0 0' });
  form.appendChild(el('button', { type: 'submit', text: t('widgets.guestbook.sign') }));
  form.appendChild(status);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = new FormData(form);
    fetch(api + '/guestbook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.get('name'), url: f.get('url'), message: f.get('message'), website: f.get('website') }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (!x.ok) { status.textContent = (x.j && x.j.error && x.j.error.message) || t('widgets.guestbook.error'); return; }
        status.textContent = t(x.j.status === 'pending' ? 'widgets.guestbook.pending' : 'widgets.guestbook.thanks');
        form.reset(); load();
      }).catch(function () { status.textContent = t('widgets.guestbook.error'); });
  });
  function load() {
    get('/guestbook').then(function (d) {
      if (d.mode === 'off') { box.textContent = t('widgets.guestbook.closed'); return; }
      list.textContent = '';
      if (!d.entries.length) list.appendChild(el('p', { text: t('widgets.guestbook.none') }));
      d.entries.slice(0, 10).forEach(function (en) {
        var head = el('strong', { text: en.name });
        var row = el('div', { style: 'border-top:1px solid #ccc;padding:4px 0' }, [head, el('span', { text: ' \\u00B7 ' + new Date(en.at).toLocaleDateString(undefined, { dateStyle: 'medium' }), style: 'font-size:.8em' }), el('div', { text: en.message, style: 'white-space:pre-wrap;overflow-wrap:anywhere' })]);
        if (en.url) { var a = el('a', { href: en.url, rel: 'nofollow ugc noopener', target: '_blank', text: en.url, style: 'font-size:.8em;overflow-wrap:anywhere' }); row.appendChild(a); }
        list.appendChild(row);
      });
    }).catch(function () { list.textContent = t('widgets.guestbook.error'); });
  }
  box.appendChild(el('h3', { text: t('widgets.guestbook.title'), style: 'margin:0 0 6px' }));
  box.appendChild(list); box.appendChild(form);
  mount(box); load();
})();`,
};

export const widgetScript = (name: string): string | null => SCRIPTS[name] ?? null;
export const WIDGET_NAMES = Object.keys(SCRIPTS);
