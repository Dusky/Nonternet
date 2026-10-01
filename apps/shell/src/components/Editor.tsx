import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { clearDraft, completeMention, loadDraft, mentionAt, saveDraft } from '../drafts';
import { useMe, useT } from '../hooks';
import { useDebounced } from '../apps/admin/useDebounced';

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  // Where this box lives ("thread:p_…", "mail:new"). With it, what is typed is kept as a draft until sent.
  draftKey?: string;
  maxLength?: number;
  rows?: number;
  mono?: boolean;
  mentions?: boolean;
  required?: boolean;
  hint?: string;
  onSubmit?: () => void;           // Ctrl/Cmd+Enter
  id?: string;
  children?: ReactNode;            // extra controls under the box
}

// Shared writing box: a counter, Ctrl/Cmd+Enter to send, a draft that survives a reload or closed window,
// a warning before the page is left with unsent words, and @name suggestions.
export function Editor({ label, value, onChange, draftKey, maxLength, rows = 6, mono, mentions, required, hint, onSubmit, id: givenId, children }: Props) {
  const t = useT();
  const me = useMe().data;
  const uid = useId();
  const id = givenId ?? uid;
  const area = useRef<HTMLTextAreaElement>(null);
  const [restored, setRestored] = useState(false);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const user = me?.id;

  // Bring a draft back once, when the box first shows.
  useEffect(() => {
    if (!draftKey || !user || value) return;
    const d = loadDraft(user, draftKey);
    if (d) { onChange(d); setRestored(true); }
  }, [draftKey, user]); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep it as it changes (saveDraft clears an empty one).
  useEffect(() => { if (draftKey && user) saveDraft(user, draftKey, value); }, [draftKey, user, value]);
  // Unsent words: ask the browser before the tab or window goes.
  useEffect(() => {
    if (!value.trim()) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [value]);

  const at = mentions ? mentionAt(value, caret) : null;
  const prefix = useDebounced(at?.prefix ?? '', 150);
  const people = useQuery({
    queryKey: ['mentions', prefix], enabled: !!at && prefix.length > 0, staleTime: 60_000,
    queryFn: () => api.get<{ people: { id: string; handle: string; display_name: string | null }[] }>(`/mentions?prefix=${encodeURIComponent(prefix)}`),
  }).data?.people ?? [];
  const open = !!at && at.prefix === prefix && people.length > 0 && dismissed !== `${at.start}:${at.prefix}`;
  useEffect(() => { setSel(0); }, [prefix]);

  const choose = (handle: string) => {
    const done = completeMention(value, caret, handle);
    if (!done) return;
    onChange(done.text);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(done.caret, done.caret); setCaret(done.caret); });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((n) => Math.min(n + 1, people.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((n) => Math.max(n - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); choose(people[sel]!.handle); return; } }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(`${at!.start}:${at!.prefix}`); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onSubmit) { e.preventDefault(); onSubmit(); }
  };

  const left = maxLength ? maxLength - value.length : null;
  const near = left !== null && left <= Math.max(20, maxLength! * 0.1);
  return (
    <div className="field editor">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id} ref={area} className={mono ? 'mono' : undefined} rows={rows} value={value} maxLength={maxLength} required={required}
        aria-describedby={`${id}-meta`} aria-autocomplete={mentions ? 'list' : undefined} aria-controls={open ? `${id}-people` : undefined}
        onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart); setRestored(false); }}
        onKeyDown={onKey} onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)} onClick={(e) => setCaret(e.currentTarget.selectionStart)}
      />
      {open && (
        <ul id={`${id}-people`} role="listbox" className="mention-list" aria-label={t('editor.people')}>
          {people.map((p, n) => (
            <li key={p.id} role="option" aria-selected={n === sel} onMouseDown={(e) => { e.preventDefault(); choose(p.handle); }}>
              <strong>{p.handle}</strong>{p.display_name && <span className="muted"> {p.display_name}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="hint editor-meta" id={`${id}-meta`}>
        {hint && <span>{hint} </span>}
        {onSubmit && <span>{t('editor.sendKey')} </span>}
        {left !== null && <span className={near ? 'counter near' : 'counter'} aria-live="off">{t('editor.left', { count: left })}</span>}
      </p>
      {restored && (
        <p className="hint" role="status">
          {t('editor.restored')}{' '}
          <button type="button" className="link" onClick={() => { onChange(''); if (user && draftKey) clearDraft(user, draftKey); setRestored(false); }}>{t('editor.discard')}</button>
        </p>
      )}
      {children}
    </div>
  );
}
