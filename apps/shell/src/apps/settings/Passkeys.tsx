import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { PASSKEY_NAME_MAX, type Passkey } from '@app/shared';
import { api } from '../../api';
import { undoable } from '../../components/feedback';
import { Alert, EmptyState, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { Section } from './Section';
import { passkeyError } from '../../passkeyError';

// Passkeys (docs/02): log in with this device, a phone or a security key instead of a password and code.
// Adding one asks for the password first; removing one acts at once with Undo.
export function Passkeys() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['passkeys'], queryFn: () => api.get<{ passkeys: Passkey[] }>('/me/passkeys') });
  const [going, setGoing] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['passkeys'] });
  const shown = (q.data?.passkeys ?? []).filter((p) => !going.includes(p.id));
  const supported = browserSupportsWebAuthn();

  return (
    <Section id="passkeys-h" title={t('settings.tab.passkeys')} scope="account">
      <p className="hint">{t('passkeys.intro')}</p>
      {q.data && shown.length === 0 && <EmptyState>{t('passkeys.none')}</EmptyState>}
      <ul className="rows">
        {shown.map((p) => (
          <li key={p.id}>
            {renaming === p.id ? <Rename passkey={p} onDone={() => { setRenaming(null); refresh(); }} /> : <strong>{p.name}</strong>}
            <p className="hint">
              {t('ssh.added', { when: formatWhen(p.created_at) ?? '' })} · {p.last_used_at ? t('ssh.used', { when: formatWhen(p.last_used_at) ?? '' }) : t('ssh.neverUsed')}
              {p.backed_up && <> · {t('passkeys.synced')}</>}
            </p>
            {renaming !== p.id && (
              <div className="toolbar">
                <button type="button" className="btn btn-quiet" aria-label={t('passkeys.renameLabel', { name: p.name })} onClick={() => setRenaming(p.id)}>{t('passkeys.rename')}</button>
                <button type="button" className="btn btn-quiet" aria-label={t('passkeys.removeLabel', { name: p.name })}
                  onClick={() => {
                    const back = () => setGoing((g) => g.filter((x) => x !== p.id));
                    setGoing((g) => [...g, p.id]);
                    undoable(t('passkeys.removed', { name: p.name }), () => api.del(`/me/passkeys/${p.id}`).then(refresh), { onUndo: back, onError: back });
                  }}>{t('ssh.remove')}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!supported ? <p className="hint">{t('passkeys.unsupported')}</p>
        : adding ? <AddPasskey onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
          : <p><button type="button" className="btn" onClick={() => setAdding(true)}>{t('passkeys.add')}</button></p>}
    </Section>
  );
}

function AddPasskey({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const add = useMutation({
    mutationFn: async () => {
      const { challenge_id, options } = await api.post<{ challenge_id: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/me/passkeys/options', { password });
      const response = await startRegistration({ optionsJSON: options });
      return api.post('/me/passkeys', { challenge_id, name: name.trim(), response });
    },
    onSuccess: onDone,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} aria-labelledby="passkey-add-h">
      <h3 id="passkey-add-h">{t('passkeys.add')}</h3>
      <TextField label={t('passkeys.name')} value={name} onChange={setName} maxLength={PASSKEY_NAME_MAX} hint={t('passkeys.nameHint')} autoFocus />
      <TextField label={t('field.currentPassword')} value={password} onChange={setPassword} type="password" autoComplete="current-password" required />
      {add.isError && <Alert kind="error">{passkeyError(add.error, t('passkeys.notAdded'))}</Alert>}
      <div className="toolbar">
        <button className="btn btn-primary" type="submit" disabled={add.isPending}>{add.isPending ? t('common.working') : t('passkeys.create')}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function Rename({ passkey, onDone }: { passkey: Passkey; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState(passkey.name);
  const save = useMutation({ mutationFn: () => api.patch(`/me/passkeys/${passkey.id}`, { name }), onSuccess: onDone });
  return (
    <form className="toolbar" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
      <TextField label={t('passkeys.name')} value={name} onChange={setName} maxLength={PASSKEY_NAME_MAX} autoFocus required />
      <button className="btn" type="submit" disabled={save.isPending || !name.trim()}>{t('common.save')}</button>
      <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      {save.isError && <Alert kind="error">{errorText(save.error)}</Alert>}
    </form>
  );
}
