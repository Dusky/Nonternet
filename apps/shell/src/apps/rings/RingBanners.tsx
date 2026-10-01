import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useConfirm } from '../../components/feedback';
import { Alert, CopyButton, TextField } from '../../components/ui';
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

// For the people who run the ring: upload, replace, remove, and (admins) take down with a reason.
export function BannerManager({ slug, name }: { slug: string; name: string }) {
  const t = useT();
  const me = useMe().data;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useBanners(slug);
  const [error, setError] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<Kind | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ring', slug, 'banners'] }); };
  const upload = useMutation({ mutationFn: (v: { kind: Kind; file: File }) => api.upload(`/rings/${slug}/banner/${v.kind}`, v.file, 'PUT'), onSuccess: () => { setError(null); refresh(); }, onError: (e) => setError(errorText(e)) });
  const remove = useMutation({ mutationFn: (kind: Kind) => api.del(`/rings/${slug}/banner/${kind}`), onSuccess: refresh });
  const hide = useMutation({ mutationFn: (v: { kind: Kind; on: boolean; reason: string }) => api.post(`/rings/${slug}/banner/${v.kind}/${v.on ? 'hide' : 'restore'}`, { reason: v.reason }), onSuccess: () => { setReasonFor(null); setReason(''); refresh(); }, onError: (e) => setError(errorText(e)) });
  const files = useRef<Partial<Record<Kind, HTMLInputElement | null>>>({});
  const origin = window.location.origin;
  return (
    <section className="panel" aria-labelledby="banners-h">
      <h3 id="banners-h">{t('rings.banners.title')}</h3>
      <p className="hint">{t('rings.banners.hint')}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {KINDS.map((kind) => {
        const b = q.data?.banners.find((x) => x.kind === kind);
        const html = `<a href="${origin}/ring/${slug}/list"><img src="${origin}/api/v1/rings/${slug}/banner/${kind}" width="${kind.split('x')[0]}" height="${kind.split('x')[1]}" alt="${name.replace(/"/g, '&quot;')}"></a>`;
        return (
          <div key={kind} className="field">
            <p><strong>{kind}</strong> {b?.hidden && <span className="badge badge-warn">{t('rings.banners.hidden')}</span>}</p>
            {b && <p><img src={`/api/v1/rings/${slug}/banner/${kind}?v=${b.version}`} width={kind.split('x')[0]} height={kind.split('x')[1]} alt={t('rings.banners.alt')} style={{ maxWidth: '100%', height: 'auto' }} /></p>}
            <div className="actions">
              <label className="btn">
                {b ? t('rings.banners.replace') : t('rings.banners.upload', { size: kind })}
                <input ref={(el) => { files.current[kind] = el; }} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="visually-hidden" disabled={upload.isPending}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ kind, file: f }); e.target.value = ''; }} />
              </label>
              {b && <button type="button" className="btn btn-quiet" onClick={() => { void confirm({ message: t('rings.banners.removeConfirm'), confirmLabel: t('confirm.delete'), danger: true }).then((ok) => ok && remove.mutate(kind)); }}>{t('rings.banners.remove')}</button>}
              {b && me?.role === 'admin' && (b.hidden
                ? <button type="button" className="btn btn-quiet" onClick={() => hide.mutate({ kind, on: false, reason: 'Restored' })}>{t('rings.banners.restore')}</button>
                : <button type="button" className="btn btn-quiet" onClick={() => setReasonFor(kind)}>{t('classics.hide')}</button>)}
            </div>
            {reasonFor === kind && (
              <form className="panel" onSubmit={(e) => { e.preventDefault(); hide.mutate({ kind, on: true, reason }); }}>
                <TextField label={t('rings.manage.reason')} value={reason} onChange={setReason} minLength={3} maxLength={300} required />
                <button className="btn btn-primary" type="submit" disabled={hide.isPending}>{t('boards.mod.confirm')}</button>
              </form>
            )}
            {b && !b.hidden && <><pre className="terminal" tabIndex={0} role="group" aria-label={t('rings.banners.snippet', { size: kind })}>{html}</pre><CopyButton text={html} /></>}
          </div>
        );
      })}
    </section>
  );
}
