import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { undoable } from '../../components/feedback';
import { Alert, CopyButton, TextField } from '../../components/ui';
import { en } from '@app/strings';
import { errorText, useMe, useT } from '../../hooks';

type Kind = '468x60' | '88x31';
interface BannerInfo { kind: Kind; hidden: boolean; version: number }
const KINDS: Kind[] = ['468x60', '88x31'];

export const useBanners = (slug: string) => useQuery({ queryKey: ['ring', slug, 'banners'], queryFn: () => api.get<{ banners: BannerInfo[] }>(`/rings/${slug}/banners`) });

// The banners at the top of a ring's page, for everyone.
export function BannerStrip({ slug }: { slug: string }) {
  const t = useT();
  const q = useBanners(slug);
  const big = q.data?.banners.find((b) => b.kind === '468x60' && !b.hidden);
  if (!big) return null;
  return <p className="ring-banner"><img src={`/api/v1/rings/${slug}/banner/468x60?v=${big.version}`} width={468} height={60} alt={t('rings.banners.alt')} style={{ maxWidth: '100%', height: 'auto' }} /></p>;
}

// The ring's banners. Every member sees the pictures with the HTML to put them on their own page; ops also upload, replace
// and remove them, and ops and admins can take one down with a reason (docs/06). Each button says which size it is for.
export function Banners({ slug, name, manage, headingId = 'banners-h' }: { slug: string; name: string; manage: boolean; headingId?: string }) {
  const t = useT();
  const me = useMe().data;
  const qc = useQueryClient();
  const q = useBanners(slug);
  const [error, setError] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<Kind | null>(null);
  const [reason, setReason] = useState('');
  const [going, setGoing] = useState<Kind[]>([]); // removed on screen, waiting out the Undo
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ring', slug, 'banners'] }); };
  const upload = useMutation({ mutationFn: (v: { kind: Kind; file: File }) => api.upload(`/rings/${slug}/banner/${v.kind}`, v.file, 'PUT'), onSuccess: () => { setError(null); refresh(); }, onError: (e) => setError(errorText(e)) });
  const hide = useMutation({ mutationFn: (v: { kind: Kind; on: boolean; reason: string }) => api.post(`/rings/${slug}/banner/${v.kind}/${v.on ? 'hide' : 'restore'}`, { reason: v.reason }), onSuccess: () => { setReasonFor(null); setReason(''); refresh(); }, onError: (e) => setError(errorText(e)) });
  const files = useRef<Partial<Record<Kind, HTMLInputElement | null>>>({});
  const origin = window.location.origin;
  const canTakeDown = manage || me?.role === 'admin';
  const shown = KINDS.filter((kind) => manage || q.data?.banners.some((x) => x.kind === kind && !x.hidden));
  if (!manage && shown.length === 0) return null; // nothing for a member to copy yet
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('rings.banners.title')}</h3>
      <p className="hint">{manage ? t('rings.banners.hint') : t('rings.banners.memberHint')}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {shown.map((kind) => {
        const b = going.includes(kind) ? undefined : q.data?.banners.find((x) => x.kind === kind);
        const [w, h] = kind.split('x');
        const html = `<a href="${origin}/ring/${slug}/list"><img src="${origin}/api/v1/rings/${slug}/banner/${kind}" width="${w}" height="${h}" alt="${name.replace(/"/g, '&quot;')}"></a>`;
        return (
          <div key={kind} className="field ring-banner-kind">
            <p><strong>{kind}</strong> {b?.hidden && <span className="badge badge-warn">{t('rings.banners.hidden')}</span>}</p>
            {b && <p><img src={`/api/v1/rings/${slug}/banner/${kind}?v=${b.version}`} width={w} height={h} alt={t('rings.banners.altSized', { name, size: kind })} style={{ maxWidth: '100%', height: 'auto' }} /></p>}
            {manage && (
              <div className="actions">
                <label className="btn">
                  {b ? t('rings.banners.replaceSized', { size: kind }) : t('rings.banners.upload', { size: kind })}
                  <input ref={(el) => { files.current[kind] = el; }} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="visually-hidden" disabled={upload.isPending}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ kind, file: f }); e.target.value = ''; }} />
                </label>
                {b && <button type="button" className="btn btn-quiet" onClick={() => { setGoing((g) => [...g, kind]); undoable(t('rings.banners.removed'), () => api.del(`/rings/${slug}/banner/${kind}`).then(refresh), { onUndo: () => setGoing((g) => g.filter((x) => x !== kind)), onError: () => setGoing((g) => g.filter((x) => x !== kind)) }); }}>{t('rings.banners.removeSized', { size: kind })}</button>}
                {b && canTakeDown && (b.hidden
                  ? <button type="button" className="btn btn-quiet" onClick={() => hide.mutate({ kind, on: false, reason: en['moderation.reason.restored'] })}>{t('rings.banners.restoreSized', { size: kind })}</button>
                  : <button type="button" className="btn btn-quiet" onClick={() => setReasonFor(kind)}>{t('rings.banners.takeDown', { size: kind })}</button>)}
              </div>
            )}
            {reasonFor === kind && (
              <form className="panel" onSubmit={(e) => { e.preventDefault(); hide.mutate({ kind, on: true, reason }); }}>
                <TextField label={t('rings.manage.reason')} value={reason} onChange={setReason} minLength={3} maxLength={300} required />
                <div className="actions">
                  <button className="btn btn-primary" type="submit" disabled={hide.isPending}>{t('rings.banners.takeDown', { size: kind })}</button>
                  <button className="btn btn-quiet" type="button" onClick={() => { setReasonFor(null); setReason(''); }}>{t('common.cancel')}</button>
                </div>
              </form>
            )}
            {b && !b.hidden && <><pre className="terminal" tabIndex={0} role="group" aria-label={t('rings.banners.snippet', { size: kind })}>{html}</pre><CopyButton text={html} label={t('rings.banners.copySized', { size: kind })} /></>}
          </div>
        );
      })}
    </section>
  );
}
