import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MEMO_MAX, NOTE_COLOURS, type DesktopNote, type MemoView } from '@app/shared';
import { api } from '../api';
import { errorText, useT } from '../hooks';
import { toast } from '../components/feedback';
import { useDesktopLayout } from './desktopLayout';

// Sticky notes (docs/10, 2026-10-18): memos the person pinned to the desktop, shown beside the home panel. The text is the
// memo's own (owned, searchable and exported as a memo); the note only remembers which memo and what colour.
export function DesktopNotes() {
  const t = useT();
  const notes = useDesktopLayout((s) => s.settings.notes);
  if (!notes.length) return null;
  return (
    <section className="desktop-notes" aria-label={t('notes.label')}>
      {notes.map((n) => <Note key={n.memo_id} note={n} />)}
    </section>
  );
}

function Note({ note }: { note: DesktopNote }) {
  const t = useT();
  const qc = useQueryClient();
  const memo = useQuery({ queryKey: ['memos', 'one', note.memo_id], queryFn: () => api.get<MemoView>(`/memos/${note.memo_id}`), retry: false, staleTime: 30_000 });
  const [editing, setEditing] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: string) => api.patch<MemoView>(`/memos/${note.memo_id}`, { body }),
    onSuccess: (m) => { qc.setQueryData(['memos', 'one', note.memo_id], m); void qc.invalidateQueries({ queryKey: ['memos'] }); setEditing(null); },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const unpin = () => { useDesktopLayout.getState().unpinNote(note.memo_id); toast(t('notes.unpinned'), 'ok', { undo: () => useDesktopLayout.getState().pinNote(note.memo_id) }); };
  const next = NOTE_COLOURS[(NOTE_COLOURS.indexOf(note.colour) + 1) % NOTE_COLOURS.length]!;
  if (memo.isError) {
    return (
      <article className="note is-gone" data-colour={note.colour}>
        <p>{t('notes.gone')}</p>
        <button type="button" className="link" onClick={() => useDesktopLayout.getState().unpinNote(note.memo_id)}>{t('notes.remove')}</button>
      </article>
    );
  }
  const body = memo.data?.body ?? '';
  return (
    <article className="note" data-colour={note.colour} data-note={note.memo_id}>
      {editing !== null ? (
        <form onSubmit={(e) => { e.preventDefault(); if (editing.trim()) save.mutate(editing); }}>
          <label className="visually-hidden" htmlFor={`note-${note.memo_id}`}>{t('notes.editLabel')}</label>
          <textarea id={`note-${note.memo_id}`} value={editing} maxLength={MEMO_MAX} rows={5} autoFocus onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (editing.trim()) save.mutate(editing); } }} />
          <div className="note-actions">
            <button type="submit" className="link" disabled={save.isPending}>{t('notes.save')}</button>
            <button type="button" className="link" onClick={() => setEditing(null)}>{t('notes.cancel')}</button>
          </div>
        </form>
      ) : (
        <>
          <p className="note-body">{memo.isLoading ? '…' : body}</p>
          <div className="note-actions">
            <button type="button" className="link" onClick={() => setEditing(body)} aria-label={t('notes.edit')}>{t('notes.editShort')}</button>
            <button type="button" className="link" onClick={() => useDesktopLayout.getState().colourNote(note.memo_id, next)} aria-label={t('notes.colour', { colour: t(`notes.colour.${next}`) })}>{t('notes.colourShort')}</button>
            <button type="button" className="link" onClick={unpin} aria-label={t('notes.unpin')}>{t('notes.unpinShort')}</button>
          </div>
        </>
      )}
    </article>
  );
}

// "Pin to the desktop" for a memo: says plainly when it is already there or there are as many notes as allowed.
export async function pinMemoToDesktop(memoId: string, t: ReturnType<typeof useT>): Promise<void> {
  await useDesktopLayout.getState().load();
  const r = useDesktopLayout.getState().pinNote(memoId);
  if (r === 'added') toast(t('notes.pinned'), 'ok', { undo: () => useDesktopLayout.getState().unpinNote(memoId) });
  else if (r === 'already') toast(t('notes.already'));
  else if (r === 'full') toast(t('notes.full'), 'error');
}
