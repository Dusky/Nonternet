import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Command, defaultFilter } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { BoardSummary, MailThreadSummary, Me, RingSummary } from '@app/shared';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useIsDesktop, useSite, useT } from '../hooks';
import { appById, visibleApps } from './apps';
import { AppIcon } from './icons';
import { useWindows, type AppId } from './windows';

const RECENT_KEY = 'ui:palette:recent';
type Recent = { key: string; label: string; kind: string; app: AppId; path: string };
function loadRecent(): Recent[] {
  try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[]).filter((r) => r && typeof r.key === 'string' && typeof r.label === 'string').slice(0, 6); } catch { return []; }
}
function remember(r: Recent) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...loadRecent().filter((x) => x.key !== r.key)].slice(0, 6))); } catch { /* a convenience */ }
}

interface Item { key: string; label: string; kind: string; icon: ReactNode; run: () => void }

// Ctrl+K (Cmd+K on a Mac): type a few letters to open an app, a board, a settings page or a
// person's profile. A quicker way around for keyboard users; everything here is also reachable by
// clicking. It searches only what this person can already see. Letters in order match, so "brd" finds
// Boards; cmdk provides the scorer, the arrow keys and the screen reader wiring.
export function CommandPalette({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const t = useT();
  const site = useSite();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const openWin = useWindows((s) => s.open);
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const boards = useQuery({
    queryKey: ['boards', me.id],
    queryFn: () => api.get<{ boards: BoardSummary[] }>('/boards'),
    enabled: open, staleTime: 60_000,
  }).data?.boards ?? [];

  // Searches the server for threads and rings once there are a couple of letters, and filters mail subjects here.
  const term = q.trim().toLowerCase().replace(/^@/, '');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const id = setTimeout(() => setDebounced(term), 250); return () => clearTimeout(id); }, [term]);
  const searching = open && debounced.length >= 2;
  const threads = useQuery({
    queryKey: ['palette', 'threads', debounced], enabled: searching, staleTime: 30_000,
    queryFn: () => api.get<{ hits: { post: { thread_id: string; subject: string }; board: { slug: string; name: string } }[] }>(`/search?q=${encodeURIComponent(debounced)}&limit=5`),
  }).data?.hits ?? [];
  const rings = useQuery({
    queryKey: ['palette', 'rings', debounced], enabled: searching, staleTime: 30_000,
    queryFn: () => api.get<{ rings: RingSummary[] }>(`/rings?q=${encodeURIComponent(debounced)}&limit=4`),
  }).data?.rings ?? [];
  const mail = useQuery({
    queryKey: ['mail', 'palette'], enabled: open && me.role !== 'guest', staleTime: 60_000,
    queryFn: () => api.get<{ threads: MailThreadSummary[] }>('/mail?limit=50'),
  }).data?.threads ?? [];
  const [recent, setRecent] = useState<{ key: string; label: string; kind: string; app: AppId; path: string }[]>(() => loadRecent());

  const go = (app: AppId, path = '') => {
    onClose();
    if (desktop) { openWin(app, path); navigate('/'); } else navigate(`${appById(app).path}${path ? `/${path}` : ''}`);
  };

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...visibleApps(me, site).map((a) => ({ key: `app:${a.id}`, label: t(a.title), kind: t('palette.kind.app'), icon: <AppIcon id={a.id} size={20} />, run: () => go(a.id) })),
      ...boards.map((b) => ({ key: `board:${b.slug}`, label: b.name, kind: t('palette.kind.board'), icon: <AppIcon id="boards" size={20} />, run: () => go('boards', b.slug) })),
      ...(['profile', 'appearance', 'password', 'two-factor', 'terminal', 'data'] as const).map((s) => ({
        key: `settings:${s}`, label: t(`settings.tab.${s === 'two-factor' ? 'twofa' : s}`), kind: t('app.settings'), icon: <AppIcon id="settings" size={20} />, run: () => go('settings', s),
      })),
    ];
    const remembered = (r: (typeof recent)[number]): Item => ({ key: `recent:${r.key}`, label: r.label, kind: r.kind, icon: <AppIcon id={r.app} size={20} />, run: () => { remember(r); go(r.app, r.path); } });
    // Letters in order match (cmdk's scorer), best first; what the server found and a guessed handle follow.
    const scored = (list: Item[]) => list.map((i) => ({ i, s: defaultFilter(i.label, term) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.i);
    const found = term ? scored(all) : [...recent.map(remembered), ...all.filter((i) => !recent.some((r) => `recent:${r.key}` === i.key || r.key === i.key)).slice(0, Math.max(4, 12 - recent.length))];
    const pick = (key: string, label: string, kind: string, app: AppId, path: string): Item => ({ key, label, kind, icon: <AppIcon id={app} size={20} />, run: () => { const r = { key, label, kind, app, path }; remember(r); setRecent(loadRecent()); go(app, path); } });
    if (term) {
      for (const h of threads) found.push(pick(`thread:${h.post.thread_id}`, h.post.subject || '…', `${t('palette.kind.thread')} · ${h.board.name}`, 'boards', `${h.board.slug}/t/${h.post.thread_id}`));
      for (const r of rings) found.push(pick(`ring:${r.slug}`, r.name, t('palette.kind.ring'), 'rings', r.slug));
      for (const m of mail) if (m.subject.toLowerCase().includes(term)) found.push(pick(`mail:${m.id}`, m.subject, t('palette.kind.mail'), 'mail', m.id));
    }
    if (term && /^[a-z0-9_-]{2,40}$/i.test(term)) {
      found.push({ key: `person:${term}`, label: t('palette.person', { handle: term }), kind: t('palette.kind.person'), icon: <Icon name="user" size={20} />, run: () => go('people', term) });
    }
    return found.slice(0, 40);
  }, [q, boards, threads, rings, mail, recent, me, site, desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    // cmdk's root takes tabindex=-1, so showModal() would focus it rather than the input.
    if (open && !d.open) { setQ(''); d.showModal(); d.querySelector<HTMLInputElement>('[cmdk-input]')?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="dialog palette" aria-label={t('palette.label')} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === dialog.current) onClose(); }}>
      {open && (
        <Command label={t('palette.label')} loop shouldFilter={false}>
          <Command.Input aria-label={t('palette.label')} placeholder={t('palette.placeholder')} value={q} onValueChange={setQ} autoFocus autoComplete="off" spellCheck={false} />
          <Command.List aria-label={t('palette.results')}>
            {items.map((i) => (
              <Command.Item key={i.key} value={i.key} onSelect={i.run}>
                {i.icon}<span>{i.label}</span><span className="kind">{i.kind}</span>
              </Command.Item>
            ))}
            <Command.Empty className="muted">{t('palette.none')}</Command.Empty>
          </Command.List>
          <p className="palette-hint" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> {t('palette.hint.move')}</span><span><kbd>Enter</kbd> {t('palette.hint.open')}</span><span><kbd>Esc</kbd> {t('palette.hint.close')}</span></p>
        </Command>
      )}
    </dialog>
  );
}
