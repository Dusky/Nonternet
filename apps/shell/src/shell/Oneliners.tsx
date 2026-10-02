import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ONELINER_MAX, type OnelinerView } from '@app/shared';
import { api } from '../api';
import { useConfirm } from '../components/feedback';
import { Alert, RelativeTime } from '../components/ui';
import { errorText, useMe, useT } from '../hooks';
import { OpenAppLink } from './OpenAppLink';

// The oneliners wall (M9-E): a short line each, one an hour, on the Home panel and in the terminal.
export function Oneliners() {
  const t = useT();
  const me = useMe().data;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: ['classics', 'oneliners'], queryFn: () => api.get<{ oneliners: OnelinerView[] }>('/oneliners?limit=6') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['classics', 'oneliners'] });
  const post = useMutation({ mutationFn: () => api.post('/oneliners', { body: text }), onSuccess: () => { setText(''); void refresh(); } });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/oneliners/${id}`), onSuccess: () => void refresh() });
  const hide = useMutation({ mutationFn: (id: string) => api.post(`/admin/oneliners/${id}/hide`, { reason: 'Taken down by an admin' }), onSuccess: () => void refresh() });
  if (q.isError) return null; // the wall is a nicety: say nothing if it can't load
  return (
    <section className="panel wall-panel" aria-labelledby="home-wall">
      <div className="panel-head">
        <h3 id="home-wall">{t('classics.wall')}</h3>
        <OpenAppLink app="boards" to="bulletins" className="btn btn-quiet btn-small">{t('classics.bulletins')}</OpenAppLink>
      </div>
      {q.data && q.data.oneliners.length === 0 && <p className="muted">{t('classics.wall.empty')}</p>}
      <ul className="plain wall">
        {q.data?.oneliners.map((o) => (
          <li key={o.id}>
            <strong>{o.author?.handle}</strong> {o.body} <span className="muted"><RelativeTime iso={o.at} /></span>
            {o.mine && <> <button type="button" className="link" onClick={() => del.mutate(o.id)}>{t('classics.wall.remove')}</button></>}
            {!o.mine && me?.role === 'admin' && <> <button type="button" className="link" onClick={() => { void confirm({ message: t('classics.wall.hideConfirm'), confirmLabel: t('classics.hide'), danger: true }).then((ok) => ok && hide.mutate(o.id)); }}>{t('classics.hide')}</button></>}
          </li>
        ))}
      </ul>
      {me && me.role !== 'guest' && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) post.mutate(); }}>
          <label htmlFor="wall-text" className="sr-only">{t('classics.wall.label')}</label>
          <input id="wall-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={ONELINER_MAX} placeholder={t('classics.wall.label')} autoComplete="off" />
          <button type="submit" className="btn" disabled={post.isPending || !text.trim()}>{t('classics.wall.add')}</button>
        </form>
      )}
      {post.isError && <Alert kind="error">{errorText(post.error)}</Alert>}
    </section>
  );
}
