import { useEffect, useRef, useState } from 'react';
import { connect, WindowMessenger, type Connection } from 'penpal';
import type { AppPermission, CatalogApp } from '@app/shared';
import { en } from '@app/strings';
import { api, ApiError } from '../api';
import { toast as sonner } from 'sonner';
import { Alert } from '../components/ui';
import { useMe, useT } from '../hooks';
import { OpenAppLink } from './OpenAppLink';
import { appKey, useInstalled } from './installed';
import { useWindows } from './windows';

// The app host (docs/10, docs/15): an added app runs in a frame from the homes origin with `sandbox` and no
// allow-same-origin, so it has an opaque origin, no cookies, no storage and (by its CSP) no network. The only way
// out is this bridge: Penpal accepts messages from this frame's window alone and then talks over a private
// channel. Each call is checked against the permissions the app's manifest asked for, which the person saw
// when they added it.

// The theme, as CSS custom properties the app can use (var(--bg) and friends).
const THEME_VARS = [
  '--bg', '--surface', '--surface2', '--text', '--muted', '--border', '--line-strong', '--line-width', '--control-line', '--control-h',
  '--accent', '--accent-soft', '--fill', '--fill-text', '--danger', '--ok', '--warn', '--focus', '--radius', '--radius-sm',
  '--font-body', '--font-display', '--font-mono', '--step--1', '--step-0', '--step-1', '--step-2',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6',
];
function themeNow(): { vars: Record<string, string>; scheme: 'light' | 'dark' } {
  const cs = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const v of THEME_VARS) { const x = cs.getPropertyValue(v).trim(); if (x) vars[v] = x; }
  return { vars, scheme: cs.colorScheme.includes('dark') ? 'dark' : 'light' };
}

class Refused extends Error {}
const plain = (e: unknown) => (e instanceof ApiError || e instanceof Refused ? e.message : en['common.wentWrong']);

// The calls an app may make, given what it asked for. Anything else is refused with a plain message.
export function bridgeFor(app: CatalogApp, deps: {
  me: () => { id: string; handle: string; display_name: string | null } | null;
  setTitle: (t: string | null) => void;
  setHeight?: (px: number) => void;
  toast: (text: string, o: { undo?: boolean; error?: boolean }) => Promise<boolean>;
  refused: string;
  notAllowed?: string;
  // An admin's preview of an app under review: what it keeps lives in this page only and is gone when it closes.
  scratch?: boolean;
}) {
  // Only what the app asked for AND the person allowed (when adding it, or later in Settings).
  const need = (p: AppPermission) => {
    if (!app.permissions.includes(p)) throw new Refused(deps.refused);
    if (!app.granted.includes(p)) throw new Refused(deps.notAllowed ?? deps.refused);
  };
  const base = `/me/apps/${encodeURIComponent(app.id)}/data`;
  const wrap = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    try { return await fn(...a); } catch (e) { throw new Error(plain(e)); }
  };
  const str = (v: unknown, max: number) => { if (typeof v !== 'string' || v.length > max) throw new Refused(deps.refused); return v; };
  const scratch = new Map<string, Map<string, { id: string; data: unknown; updated_at: string }>>();
  const shelf = (c: string) => { let m = scratch.get(c); if (!m) { m = new Map(); scratch.set(c, m); } return m; };
  return {
    storageList: wrap(async (collection: unknown) => {
      need('storage');
      if (deps.scratch) return [...shelf(str(collection, 32)).values()];
      return (await api.get<{ docs: unknown[] }>(`${base}/${encodeURIComponent(str(collection, 32))}`)).docs;
    }),
    storagePut: wrap(async (collection: unknown, id: unknown, data: unknown) => {
      need('storage');
      if (deps.scratch) {
        const doc = { id: str(id, 64), data: structuredClone(data), updated_at: new Date().toISOString() };
        if (JSON.stringify(data ?? null).length > 64 * 1024) throw new Refused(deps.refused);
        shelf(str(collection, 32)).set(doc.id, doc);
        return doc;
      }
      return (await api.put<{ doc: unknown }>(`${base}/${encodeURIComponent(str(collection, 32))}/${encodeURIComponent(str(id, 64))}`, { data })).doc;
    }),
    storageDelete: wrap(async (collection: unknown, id: unknown) => {
      need('storage');
      if (deps.scratch) { shelf(str(collection, 32)).delete(str(id, 64)); return; }
      await api.del(`${base}/${encodeURIComponent(str(collection, 32))}/${encodeURIComponent(str(id, 64))}`);
    }),
    profileGet: wrap(async () => {
      need('profile:read');
      const m = deps.me();
      if (!m) throw new Refused(deps.refused);
      return { id: m.id, handle: m.handle, display_name: m.display_name };
    }),
    uiSetTitle: wrap(async (title: unknown) => { deps.setTitle(str(title, 80).trim() || null); }),
    // Only a size, so no permission: the shell clamps it and uses it to fit the frame on a page of its own.
    uiSetHeight: wrap(async (px: unknown) => { if (typeof px !== 'number' || !Number.isFinite(px) || px < 0) throw new Refused(deps.refused); deps.setHeight?.(Math.min(10_000, Math.round(px))); }),
    uiToast: wrap(async (text: unknown, o?: unknown) => {
      need('notify'); // "Can show you short notes" is what the person agreed to
      const opts = (o && typeof o === 'object' ? o : {}) as { undo?: unknown; error?: unknown };
      return deps.toast(str(text, 200), { undo: opts.undo === true, error: opts.error === true });
    }),
  };
}

// A note from an app, through the shell's own toasts. Resolves true if Undo was pressed.
function appToast(text: string, o: { undo?: boolean; error?: boolean }, undoLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const end = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    const opts = { duration: o.error ? 8000 : o.undo ? 6000 : 4000, onDismiss: () => end(false), onAutoClose: () => end(false), action: o.undo ? { label: undoLabel, onClick: () => end(true) } : undefined };
    if (o.error) sonner.error(text, opts); else sonner(text, opts);
  });
}

// `widget` runs the app's small home-panel page instead of the app itself (docs/10): same sandbox, same bridge, no window title.
// `preview` runs an app nobody has added, for an admin reviewing it: the same sandbox, everything it asks for allowed, but
// what it keeps stays in this page (gone when the preview closes) and it sees a stand-in profile, not the admin's.
export default function AppHost({ appId, widget = false, preview }: { appId: string; widget?: boolean; preview?: CatalogApp }) {
  const t = useT();
  const me = useMe().data;
  const installed = useInstalled((s) => s.apps.find((a) => a.id === appId));
  const app = preview ? { ...preview, granted: preview.permissions } : installed;
  const titled = !widget && !preview;
  const setSubtitle = useWindows((s) => s.setSubtitle);
  const frame = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0); // Retry remounts the frame and connects again
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => {
    const win = frame.current?.contentWindow;
    if (!app || !win) return;
    const key = appKey(app.id);
    const methods = bridgeFor(app, {
      me: () => (preview ? { id: 'u_preview', handle: 'preview', display_name: t('apps.previewPerson') }
        : meRef.current ? { id: meRef.current.id, handle: meRef.current.handle, display_name: meRef.current.display_name ?? null } : null),
      scratch: !!preview,
      setTitle: (title) => { if (titled) setSubtitle(key, title); },
      setHeight,
      toast: (text, o) => appToast(text, o, t('common.undo')),
      refused: t('apps.refused'),
      notAllowed: t('apps.notAllowed'),
    });
    // The frame's origin is opaque ("null"), so the origin can't be named; Penpal still only listens to this
    // frame's window, and after the handshake both sides use a private MessageChannel.
    const conn: Connection<{ setTheme: (v: Record<string, string>, s: 'light' | 'dark') => void }> = connect({
      messenger: new WindowMessenger({ remoteWindow: win, allowedOrigins: ['*'] }),
      methods, timeout: 15_000,
    });
    let alive = true;
    const pushTheme = () => { void conn.promise.then((r) => { const th = themeNow(); return r.setTheme(th.vars, th.scheme); }).catch(() => undefined); };
    conn.promise.then(() => { if (alive) { setReady(true); pushTheme(); } }, () => { if (alive) setFailed(true); });
    window.addEventListener('ui:theme', pushTheme);
    return () => { alive = false; window.removeEventListener('ui:theme', pushTheme); conn.destroy(); if (titled) setSubtitle(key, null); };
  }, [app?.id, app?.version, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app) {
    return <Alert kind="info">{t('apps.notAdded')} <OpenAppLink app="addapps" to="" className="link">{t('app.addapps')}</OpenAppLink></Alert>;
  }
  const page = widget ? app.widget_url : app.url;
  if (!page) return null;
  const src = `${page}#host=${encodeURIComponent(window.location.origin)}`;
  return (
    <div className={widget ? 'app-host app-widget' : 'app-fill app-host'} style={height ? { ['--app-h' as string]: `${height}px` } : undefined}>
      {!ready && !failed && <p className="hint" role="status">{t('apps.starting', { app: app.name })}</p>}
      {failed && (
        <Alert kind="error">
          {t('apps.failed', { app: app.name })}{' '}
          <button type="button" className="btn btn-small" onClick={() => { setFailed(false); setReady(false); setHeight(null); setAttempt((n) => n + 1); }}>{t('apps.retry')}</button>
        </Alert>
      )}
      <iframe
        ref={frame} key={`${app.id}@${app.version}#${attempt}`} src={src} title={widget ? `${app.name} (widget)` : app.name} className={`app-sandbox${ready ? '' : ' is-starting'}`}
        sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" allow=""
      />
    </div>
  );
}
