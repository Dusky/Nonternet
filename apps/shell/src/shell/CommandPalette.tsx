import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { BoardSummary, Me } from '@app/shared';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useIsDesktop, useSite, useT } from '../hooks';
import { appById, visibleApps } from './apps';
import { AppIcon } from './icons';
import { useWindows, type AppId } from './windows';

interface Item { key: string; label: string; kind: string; icon: ReactNode; run: () => void }

// Ctrl+K (Cmd+K on a Mac): type a few letters to open an app, a board, a settings page or a
// person's profile. A quicker way around for keyboard users; everything here is also reachable by
// clicking. It searches only what this person can already see.
export function CommandPalette({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const t = useT();
  const site = useSite();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const openWin = useWindows((s) => s.open);
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listId = useId();
  const boards = useQuery({
    queryKey: ['boards', me.id],
    queryFn: () => api.get<{ boards: BoardSummary[] }>('/boards'),
    enabled: open, staleTime: 60_000,
  }).data?.boards ?? [];

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
    const term = q.trim().toLowerCase().replace(/^@/, '');
    const found = term ? all.filter((i) => i.label.toLowerCase().includes(term)) : all.slice(0, 12);
    if (term && /^[a-z0-9_-]{2,40}$/i.test(term)) {
      found.push({ key: `person:${term}`, label: t('palette.person', { handle: term }), kind: t('palette.kind.person'), icon: <Icon name="user" size={20} />, run: () => go('people', term) });
    }
    return found.slice(0, 30);
  }, [q, boards, me, site, desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) { setQ(''); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => { document.getElementById(`${listId}-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel, listId]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((n) => Math.min(n + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((n) => Math.max(n - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
  };

  return (
    <dialog ref={dialog} className="dialog palette" aria-label={t('palette.label')} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === dialog.current) onClose(); }}>
      {open && (
        <>
          <input
            role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={items[sel] ? `${listId}-${sel}` : undefined}
            aria-label={t('palette.label')} placeholder={t('palette.placeholder')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoFocus
            autoComplete="off" spellCheck={false}
          />
          <ul id={listId} role="listbox" aria-label={t('palette.results')}>
            {items.map((i, n) => (
              <li key={i.key} id={`${listId}-${n}`} role="option" aria-selected={n === sel} onMouseMove={() => setSel(n)} onClick={i.run}>
                {i.icon}<span>{i.label}</span><span className="kind">{i.kind}</span>
              </li>
            ))}
            {items.length === 0 && <li role="option" aria-selected="false" aria-disabled="true" className="muted">{t('palette.none')}</li>}
          </ul>
          <p className="palette-hint" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> {t('palette.hint.move')}</span><span><kbd>Enter</kbd> {t('palette.hint.open')}</span><span><kbd>Esc</kbd> {t('palette.hint.close')}</span></p>
        </>
      )}
    </dialog>
  );
}
