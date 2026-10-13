import { useEffect } from 'react';
import { useToast } from '../../components/feedback';
import { useSite, useT, useMe } from '../../hooks';
import { appName, useVisibleApps } from '../../shell/apps';
import { shownApps, useDesktopLayout } from '../../shell/desktopLayout';
import { phoneOrder, shortcutKey } from '../../shell/desktopLayout.logic';
import { Section } from './Section';

// The same choices as dragging and right-clicking on the desktop, as a form: which apps show, and their order on a phone.
export function DesktopLayoutSection() {
  const t = useT();
  const toast = useToast();
  const site = useSite();
  const me = useMe().data;
  const apps = useVisibleApps(me!, site);
  const settings = useDesktopLayout((s) => s.settings);
  const loaded = useDesktopLayout((s) => s.loaded);
  useEffect(() => { void useDesktopLayout.getState().load(); }, []);
  // Apps and shortcuts share one phone order.
  const items = [
    ...apps.map((a) => ({ id: a.id as string, name: appName(a, t), shortcut: false })),
    ...settings.shortcuts.map((x) => ({ id: shortcutKey(x.id), name: x.label, shortcut: true })),
  ];
  const ordered = phoneOrder(items, settings.phone_order);
  const shown = shownApps(items, settings, true);
  return (
    <Section id="look-desktop" title={t('settings.desktop.title')} scope="account" intro={t('settings.desktop.intro')}>
      <ul className="rows desktop-apps">
        {ordered.map((a) => {
          const on = !settings.hidden.includes(a.id);
          const at = shown.findIndex((x) => x.id === a.id);
          return (
            <li key={a.id} className="desktop-app-row">
              {a.shortcut ? (
                <span>{a.name} <span className="row-meta">{t('settings.desktop.shortcut')}</span></span>
              ) : (
                <label className="check">
                  <input type="checkbox" checked={on} disabled={!loaded || a.id === 'settings'} onChange={(e) => (e.target.checked ? useDesktopLayout.getState().show(a.id) : useDesktopLayout.getState().hide(a.id))} />
                  {a.name}
                </label>
              )}
              <span className="row-actions">
                <button type="button" className="btn btn-quiet btn-small" disabled={!loaded || !on || at <= 0} aria-label={t('settings.desktop.earlier', { app: a.name })} onClick={() => useDesktopLayout.getState().shiftPhone(shown, a.id, -1)}>↑</button>
                <button type="button" className="btn btn-quiet btn-small" disabled={!loaded || !on || at < 0 || at >= shown.length - 1} aria-label={t('settings.desktop.later', { app: a.name })} onClick={() => useDesktopLayout.getState().shiftPhone(shown, a.id, 1)}>↓</button>
                {a.shortcut && <button type="button" className="btn btn-quiet btn-small" disabled={!loaded} aria-label={`${t('desktop.shortcut.remove')}: ${a.name}`} onClick={() => { useDesktopLayout.getState().removeShortcut(a.id.slice(3)); toast(t('desktop.shortcut.removed')); }}>{t('bookmarks.remove')}</button>}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="actions">
        <button type="button" className="btn" disabled={!loaded || (Object.keys(settings.positions).length === 0 && settings.hidden.length === 0 && settings.phone_order.length === 0)}
          onClick={() => { const before = useDesktopLayout.getState().reset(); toast(t('desktop.resetDone'), 'ok', { undo: () => useDesktopLayout.getState().restore(before) }); }}>{t('desktop.ctx.reset')}</button>
      </div>
    </Section>
  );
}
