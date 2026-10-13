import { en } from '@app/strings';
import { toast } from '../components/feedback';
import { useDesktopLayout } from './desktopLayout';
import type { ShortcutTarget } from './desktopLayout.logic';

// "Add to the desktop": from a window's title-bar menu and from a bookmark's row. Waits for the saved layout to load first, so a
// shortcut is never lost to the defaults, and says plainly when it is already there or the desktop is full.
export async function addToDesktop(label: string, target: ShortcutTarget): Promise<void> {
  await useDesktopLayout.getState().load();
  const r = useDesktopLayout.getState().addShortcut(label, target);
  if (r === null) return;
  if (r === 'full') { toast(en['desktop.shortcut.full'], 'error'); return; }
  if (!r.added) { toast(en['desktop.shortcut.already']); return; }
  toast(en['desktop.shortcut.added'], 'ok', { undo: () => useDesktopLayout.getState().removeShortcut(r.id) });
}
