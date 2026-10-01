import { useEffect, useRef } from 'react';
import { useT } from '../hooks';

// Every shortcut in one place (opened with "?"). Grouped by where they work. The keys are shown as
// they are pressed; Cmd stands in for Ctrl on a Mac.
const GROUPS: { title: Parameters<ReturnType<typeof useT>>[0]; rows: [keys: string, what: Parameters<ReturnType<typeof useT>>[0]][] }[] = [
  { title: 'shortcuts.group.everywhere', rows: [
    ['Ctrl K', 'shortcuts.palette'], ['?', 'shortcuts.help'], ['Alt `', 'shortcuts.cycle'],
  ] },
  { title: 'shortcuts.group.windows', rows: [
    ['← → ↑ ↓', 'shortcuts.move'], ['Shift + arrows', 'shortcuts.resize'], ['Alt ← / Alt →', 'shortcuts.snap'],
    ['Alt ← / Alt → (in a window)', 'shortcuts.backForward'], ['Shift F10', 'shortcuts.menu'],
  ] },
  { title: 'shortcuts.group.boards', rows: [
    ['j / k', 'shortcuts.jk'], ['n', 'shortcuts.next'], ['r', 'shortcuts.reply'],
  ] },
  { title: 'shortcuts.group.writing', rows: [
    ['Ctrl Enter', 'shortcuts.send'],
  ] },
];

// Words and separators in a key list ('in a window', '/', '+') are plain text; the rest are keycaps.
const plain = (k: string) => k === '/' || k === '+' || k.startsWith('(') || k.endsWith(')') || /^[a-z]{2,}$/.test(k);

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="dialog shortcuts" aria-labelledby="shortcuts-title" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === dialog.current) onClose(); }}>
      {open && (
        <div className="dialog-body">
          <h2 id="shortcuts-title">{t('shortcuts.title')}</h2>
          {GROUPS.map((g) => (
            <section key={g.title} aria-label={t(g.title)}>
              <h3>{t(g.title)}</h3>
              <dl className="shortcut-list">
                {g.rows.map(([keys, what]) => (
                  <div key={keys}><dt>{keys.split(' ').map((k, i) => (plain(k) ? <span key={i}> {k} </span> : <kbd key={i}>{k}</kbd>))}</dt><dd>{t(what)}</dd></div>
                ))}
              </dl>
            </section>
          ))}
          <p className="hint">{t('shortcuts.mac')}</p>
          <div className="actions"><button type="button" className="btn btn-primary" onClick={onClose} autoFocus>{t('shortcuts.close')}</button></div>
        </div>
      )}
    </dialog>
  );
}
