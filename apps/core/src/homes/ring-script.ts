import { en } from '@app/strings';
import type { StringKey } from '@app/strings';

// The ring nav bar script (docs/06): <script src=".../ring/{slug}/nav.js" data-member="{user id}">.
// Links go through /ring/{slug}/next and friends, so a change of order or a removed member never
// breaks a page. Like the other widgets it builds its output with textContent only.
const KEYS: StringKey[] = ['rings.nav.label', 'rings.nav.ring', 'rings.nav.prev', 'rings.nav.next', 'rings.nav.random', 'rings.nav.list', 'rings.nav.notMember'];

export function ringNavScript(slug: string): string {
  const T = JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, en[k]])));
  return `(function () {
  var script = document.currentScript;
  if (!script) return;
  var member = script.getAttribute('data-member') || '';
  var style = script.getAttribute('data-style') || 'bar';
  var origin = new URL(script.src).origin;
  var T = ${T};
  function t(key, vars) { return (T[key] || key).replace(/\\{(\\w+)\\}/g, function (_, k) { return vars && vars[k] != null ? vars[k] : ''; }); }
  function el(tag, props, text) { var e = document.createElement(tag); for (var k in props || {}) e.setAttribute(k, props[k]); if (text != null) e.textContent = text; return e; }
  fetch(origin + '/api/v1/widgets/ring/' + ${JSON.stringify(encodeURIComponent(slug))} + '/nav' + (member ? '?member=' + encodeURIComponent(member) : '')).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ring) return;
    var box = el('nav', { 'aria-label': t('rings.nav.label', { ring: d.ring.name }), style: 'display:inline-block;text-align:center;font:14px/1.4 Verdana,Geneva,sans-serif;' + (style === 'banner' ? 'border:2px solid #333;background:#fffbe6;color:#222;padding:8px 14px;' : style === 'buttons' ? '' : 'border:1px solid #888;background:#f4f4f4;color:#222;padding:4px 10px;') });
    var title = el('a', { href: d.ring.url, style: 'font-weight:bold;color:inherit' }, t('rings.nav.ring', { ring: d.ring.name }));
    if (!d.member) { box.appendChild(title); box.appendChild(el('div', { style: 'font-size:12px' }, t('rings.nav.notMember', { ring: d.ring.name }))); script.parentNode.insertBefore(box, script); return; }
    function link(href, label) {
      var a = el('a', { href: href, style: style === 'buttons' ? 'display:inline-block;margin:2px;padding:3px 8px;border:2px outset #ccc;background:#e0e0e0;color:#000;text-decoration:none' : 'margin:0 6px;color:inherit' }, label);
      return a;
    }
    if (style === 'banner') { box.appendChild(title); box.appendChild(el('br')); }
    else if (style !== 'buttons') { box.appendChild(title); box.appendChild(document.createTextNode(' ')); }
    box.appendChild(link(d.prev, (style === 'banner' ? '\\u25C0 ' : '') + t('rings.nav.prev')));
    box.appendChild(link(d.list, t('rings.nav.list')));
    box.appendChild(link(d.random, t('rings.nav.random')));
    box.appendChild(link(d.next, t('rings.nav.next') + (style === 'banner' ? ' \\u25B6' : '')));
    script.parentNode.insertBefore(box, script);
  }).catch(function () {});
})();`;
}
