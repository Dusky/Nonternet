import { useConfirm } from '../../components/feedback';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, TextField, EmptyState } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { CopyButton } from '../../components/ui';

interface DomainInfo {
  domain: string; status: 'pending' | 'verified'; last_error: string | null;
  dns: { txt: { name: string; value: string }; point_to: { type: string; value: string; note: string } };
}

export function Domains() {
  const t = useT();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ['studio', 'domains'], queryFn: () => api.get<{ domains: DomainInfo[]; max: number }>('/homes/me/domains') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['studio', 'domains'] });
  const add = useMutation({ mutationFn: () => api.post('/homes/me/domains', { domain: name }), onSuccess: () => { setName(''); setError(null); void refresh(); }, onError: (e) => setError(errorText(e)) });
  const remove = useMutation({ mutationFn: (d: string) => api.del(`/homes/me/domains/${encodeURIComponent(d)}`), onSuccess: () => void refresh(), onError: (e) => setError(errorText(e)) });
  const check = useMutation({
    mutationFn: (d: string) => api.post(`/homes/me/domains/${encodeURIComponent(d)}/verify`).then(() => d),
    onSuccess: (d) => { setChecked((c) => ({ ...c, [d]: '' })); void refresh(); },
    onError: (e, d) => { setChecked((c) => ({ ...c, [d]: errorText(e) })); void refresh(); },
  });
  return (
    <>
      <p>{t('studio.domains.hint')}</p>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); setError(null); add.mutate(); }}>
        <TextField label={t('studio.domains.name')} hint={t('studio.domains.nameHint')} value={name} onChange={setName} autoCapitalize="none" spellCheck={false} required />
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={add.isPending}>{t('studio.domains.add')}</button>
      </form>
      {list.data?.domains.length === 0 && <EmptyState>{t('studio.domains.none')}</EmptyState>}
      <ul className="rows">
        {list.data?.domains.map((d) => (
          <li key={d.domain}>
            <strong>{d.domain}</strong>{' '}
            <span className={`badge ${d.status === 'verified' ? 'badge-open' : ''}`}>{t(d.status === 'verified' ? 'studio.domains.verified' : 'studio.domains.pending')}</span>
            {d.status === 'verified'
              ? <p>{t('studio.domains.live', { name: d.domain })}</p>
              : (
                <>
                  <p>{t('studio.domains.step1')}</p>
                  <DnsRecord type="TXT" name={d.dns.txt.name} value={d.dns.txt.value} />
                  <p>{t('studio.domains.step2')}</p>
                  <DnsRecord type={d.dns.point_to.type} name={d.domain} value={d.dns.point_to.value} />
                  {d.dns.point_to.note && <p className="hint">{d.dns.point_to.note}</p>}
                  <p className="hint">{t('studio.domains.dnsWait')}</p>
                  {(checked[d.domain] || d.last_error) && <Alert kind="info">{checked[d.domain] || d.last_error}</Alert>}
                  <button type="button" className="btn" onClick={() => check.mutate(d.domain)} disabled={check.isPending}>{t('studio.domains.check', { name: d.domain })}</button>{' '}
                </>
              )}
            <button type="button" className="link" onClick={() => { void confirm({ message: t('studio.domains.removeConfirm', { name: d.domain }), confirmLabel: t('confirm.removeDomain'), danger: true }).then((ok) => ok && remove.mutate(d.domain)); }}>{t('studio.domains.remove', { name: d.domain })}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function DnsRecord({ type, name, value }: { type: string; name: string; value: string }) {
  const t = useT();
  return (
    <dl className="dns">
      <dt>{t('studio.domains.recordType')}</dt><dd>{type}</dd>
      <dt>{t('studio.domains.recordName')}</dt><dd><code>{name}</code> <CopyButton text={name} /></dd>
      <dt>{t('studio.domains.recordValue')}</dt><dd><code>{value}</code> <CopyButton text={value} /></dd>
    </dl>
  );
}
