import { useEffect } from 'react';
import { useToast } from '../../components/feedback';
import { useSite, useT, useMe } from '../../hooks';
import { appName, useVisibleApps } from '../../shell/apps';
import { shownApps, useDesktopLayout } from '../../shell/desktopLayout';
import { phoneOrder } from '../../shell/desktopLayout.logic';
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
  const ordered = phoneOrder(apps, settings.phone_order);
  const shown = shownApps(apps, settings, true);
  return (
    <Section id="look-desktop" title={t('settings.desktop.title')} scope="account" intro={t('settings.desktop.intro')}>
      <ul className="rows desktop-apps">
        {ordered.map((a) => {
          const on = !settings.hidden.includes(a.id);
          const at = shown.findIndex((x) => x.id === a.id);
          return (
            <li key={a.id} className="desktop-app-row">
              <label className="check">
                <input type="checkbox" checked={on} disabled={!loaded || a.id === 'settings'} onChange={(e) => (e.target.checked ? useDesktopLayout.getState().show(a.id) : useDesktopLayout.getState().hide(a.id))} />
                {appName(a, t)}
              </label>
              <span className="row-actions">
                <button type="button" className="btn btn-quiet btn-small" disabled={!loaded || !on || at <= 0} aria-label={t('settings.desktop.earlier', { app: appName(a, t) })} onClick={() => useDesktopLayout.getState().shiftPhone(shown, a.id, -1)}>↑</button>
                <button type="button" className="btn btn-quiet btn-small" disabled={!loaded || !on || at < 0 || at >= shown.length - 1} aria-label={t('settings.desktop.later', { app: appName(a, t) })} onClick={() => useDesktopLayout.getState().shiftPhone(shown, a.id, 1)}>↓</button>
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
