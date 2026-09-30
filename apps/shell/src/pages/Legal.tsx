import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { StringKey } from '@app/strings';
import { api } from '../api';
import { Alert, Centered, TextField } from '../components/ui';
import { errorText, formatWhen, useT } from '../hooks';

export const LEGAL_SLUGS = ['terms', 'privacy', 'acceptable-use', 'takedown'] as const;
export interface LegalPage { slug: string; title: string; body: string; version: number; updated_at: string | null; placeholder: boolean }

// Plain text only: "## " lines are headings and blank lines split paragraphs. Nothing here is ever HTML.
export function LegalText({ body }: { body: string }) {
  return <>{body.split(/\n{2,}/).map((block, i) => (block.startsWith('## ') ? <h2 key={i}>{block.slice(3)}</h2> : <p key={i}>{block}</p>))}</>;
}

export function LegalLinks() {
  const t = useT();
  return (
    <nav className="legal-links" aria-label={t('legal.footer')}>
      {LEGAL_SLUGS.map((s) => <Link key={s} to={`/legal/${s}`}>{t(`legal.${s}` as StringKey)}</Link>)}
    </nav>
  );
}

export function LegalPageRoute() {
  const { slug = '' } = useParams();
  const t = useT();
  const known = (LEGAL_SLUGS as readonly string[]).includes(slug);
  const q = useQuery({ queryKey: ['legal', slug], queryFn: () => api.get<LegalPage>(`/legal/${slug}`), enabled: known });
  if (!known) return <Centered title={t('error.notFound')}><p className="links"><Link to="/">{t('nav.home')}</Link></p></Centered>;
  if (q.isError) return <Centered title={t(`legal.${slug}` as StringKey)}><Alert kind="error">{errorText(q.error)}</Alert></Centered>;
  if (!q.data) return null;
  const p = q.data;
  return (
    <Centered title={p.title}>
      {p.placeholder && <Alert kind="info">{t('legal.placeholder')}</Alert>}
      <LegalText body={p.body} />
      {p.updated_at && <p className="hint">{t('legal.updated', { version: p.version, when: formatWhen(p.updated_at) ?? '' })}</p>}
      {slug === 'takedown' && <TakedownForm />}
      <LegalLinks />
      <p className="links"><Link to="/">{t('nav.home')}</Link></p>
    </Centered>
  );
}

const KINDS = ['copyright', 'illegal', 'privacy', 'other'] as const;

function TakedownForm() {
  const t = useT();
  const [f, setF] = useState({ kind: 'copyright' as (typeof KINDS)[number], url: '', description: '', contact_name: '', contact_email: '', good_faith: false });
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({ mutationFn: () => api.post('/legal/requests', f), onError: (e) => setError(errorText(e)) });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  if (send.isSuccess) return <Alert kind="success">{t('legal.takedown.sent')}</Alert>;
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); send.mutate(); };
  return (
    <form onSubmit={submit} aria-labelledby="takedown-h">
      <h2 id="takedown-h">{t('legal.takedown.heading')}</h2>
      <div className="field">
        <label htmlFor="td-kind">{t('legal.takedown.kind')}</label>
        <select id="td-kind" value={f.kind} onChange={(e) => set('kind')(e.target.value as (typeof KINDS)[number])}>
          {KINDS.map((k) => <option key={k} value={k}>{t(`legal.takedown.kind.${k}` as StringKey)}</option>)}
        </select>
      </div>
      <TextField label={t('legal.takedown.url')} value={f.url} onChange={set('url')} type="url" maxLength={500} required />
      <TextField label={t('legal.takedown.description')} value={f.description} onChange={set('description')} maxLength={4000} multiline required />
      <TextField label={t('legal.takedown.name')} value={f.contact_name} onChange={set('contact_name')} maxLength={120} autoComplete="name" required />
      <TextField label={t('legal.takedown.email')} value={f.contact_email} onChange={set('contact_email')} type="email" hint={t('legal.takedown.emailHint')} autoComplete="email" required />
      <label className="check"><input type="checkbox" checked={f.good_faith} onChange={(e) => set('good_faith')(e.target.checked)} />{t('legal.takedown.statement')}</label>
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={send.isPending}>{t('legal.takedown.send')}</button>
    </form>
  );
}
