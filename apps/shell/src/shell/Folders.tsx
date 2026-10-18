import { useEffect, useRef } from 'react';
import type { DesktopFolder, DesktopShortcut } from '@app/shared';
import { useT } from '../hooks';
import { toast } from '../components/feedback';
import type { MenuEntry } from '../components/Menu';
import { appName, type AppDef } from './apps';
import { useDesktopLayout } from './desktopLayout';
import { AppTile } from './icons';
import { useShortcutView } from './ShortcutIcon';

// Folders on the desktop and the phone home screen (docs/10, 2026-10-18). A folder holds apps and shortcuts by their item keys;
// it opens as a small dialog listing what is inside, each with its own "Take out" button.

// "Move to <folder>" for each folder, and "New folder", for an item's menu.
export function folderMenu(key: string, t: ReturnType<typeof useT>): MenuEntry[] {
  const { folders } = useDesktopLayout.getState().settings;
  const store = useDesktopLayout.getState();
  return [
    ...folders.map((f, i) => ({ label: t('desktop.folder.moveTo', { name: f.name }), onSelect: () => store.moveToFolder(key, f.id), separator: i === 0 })),
    {
      label: t('desktop.folder.new'), separator: folders.length === 0,
      onSelect: () => {
        const name = window.prompt(t('desktop.folder.namePrompt'), t('desktop.folder.defaultName'));
        if (!name) return;
        if (store.newFolder(name, key) === 'full') toast(t('desktop.folder.full'), 'error');
      },
    },
  ];
}

export function folderOwnMenu(folder: DesktopFolder, t: ReturnType<typeof useT>, open: () => void): MenuEntry[] {
  const store = useDesktopLayout.getState();
  return [
    { label: t('desktop.folder.open', { name: folder.name }), onSelect: open },
    { label: t('desktop.folder.rename'), separator: true, onSelect: () => { const n = window.prompt(t('desktop.folder.namePrompt'), folder.name); if (n) store.renameFolder(folder.id, n); } },
    { label: t('desktop.folder.delete'), onSelect: () => { store.deleteFolder(folder.id); toast(t('desktop.folder.deleted', { name: folder.name })); } },
  ];
}

export function FolderTile({ count }: { count: number }) {
  return <span className="app-tile folder-tile" aria-hidden="true"><span className="folder-count">{count}</span></span>;
}

type Opener = { app: (app: AppDef) => void; shortcut: (sc: DesktopShortcut) => void };

// The folder, opened: what is inside, each opens on a click, and can be taken back out.
export function FolderPanel({ folder, apps, available, onClose, opener }: {
  folder: DesktopFolder; apps: AppDef[]; available: Set<string>; onClose: () => void; opener: Opener;
}) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const shortcuts = useDesktopLayout((s) => s.settings.shortcuts);
  type Item = { key: string; sc?: DesktopShortcut; app?: AppDef };
  const items: Item[] = [];
  for (const key of folder.items) {
    if (key.startsWith('sc:')) { const sc = shortcuts.find((x) => `sc:${x.id}` === key); if (sc) items.push({ key, sc }); continue; }
    const app = apps.find((a) => a.id === key);
    if (app) items.push({ key, app });
  }
  const close = () => { dialog.current?.close(); onClose(); };
  return (
    <dialog ref={dialog} className="dialog folder-panel" aria-labelledby={`folder-${folder.id}`} onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === dialog.current) close(); }}>
      <div className="dialog-body">
        <h2 id={`folder-${folder.id}`}>{folder.name}</h2>
        {items.length === 0 ? <p className="muted">{t('desktop.folder.empty')}</p> : (
          <ul className="folder-items">
            {items.map((it) => (
              <li key={it.key}>
                {it.app
                  ? <button type="button" className="icon" onClick={() => { close(); opener.app(it.app!); }}><AppTile id={it.app.id} /><span className="icon-label">{appName(it.app, t)}</span></button>
                  : <FolderShortcut sc={it.sc!} available={available} onOpen={() => { close(); opener.shortcut(it.sc!); }} />}
                <button type="button" className="link" onClick={() => useDesktopLayout.getState().moveToFolder(it.key, null)}
                  aria-label={t('desktop.folder.takeOutOf', { item: it.app ? appName(it.app, t) : it.sc!.label })}>{t('desktop.folder.takeOut')}</button>
              </li>
            ))}
          </ul>
        )}
        <div className="actions"><button type="button" className="btn" onClick={close}>{t('desktop.folder.close')}</button></div>
      </div>
    </dialog>
  );
}

function FolderShortcut({ sc, available, onOpen }: { sc: DesktopShortcut; available: Set<string>; onOpen: () => void }) {
  const t = useT();
  const view = useShortcutView(sc, available);
  return (
    <button type="button" className={`icon is-shortcut${view.missing ? ' is-missing' : ''}`} disabled={view.missing}
      aria-label={view.missing ? t('desktop.shortcut.missing', { label: sc.label }) : t('desktop.shortcut.open', { label: sc.label })} onClick={onOpen}>
      {view.tile}<span className="icon-label">{sc.label}</span>
    </button>
  );
}
