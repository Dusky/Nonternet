import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MemoVisibility } from '@app/shared';
import { api } from '../../api';
import { useT } from '../../hooks';

export interface Share { visibility: MemoVisibility; ring: string }

// Who can see a memo (docs/22): only me (the default, with a lock), anyone (the profile and its feed), or the members of one of my rings.
export function WhoSees({ value, onChange, error }: { value: Share; onChange: (s: Share) => void; error?: string }) {
  const t = useT();
  const id = useId();
  const rings = useQuery({ queryKey: ['memos', 'rings'], queryFn: () => api.get<{ rings: { slug: string; name: string }[] }>('/memos/rings') }).data?.rings ?? [];
  const choices: MemoVisibility[] = rings.length || value.visibility === 'ring' ? ['private', 'public', 'ring'] : ['private', 'public'];
  return (
    <fieldset className="field who-sees">
      <legend>{t('memos.share.legend')}</legend>
      {choices.map((c) => (
        <label key={c} className="check">
          <input type="radio" name={`${id}-who`} value={c} checked={value.visibility === c}
            onChange={() => onChange({ visibility: c, ring: c === 'ring' ? value.ring || rings[0]?.slug || '' : value.ring })} />
          {' '}{t(`memos.share.${c}`)}
        </label>
      ))}
      {value.visibility === 'ring' && (
        <div className="field">
          <label htmlFor={`${id}-ring`}>{t('memos.share.whichRing')}</label>
          <select id={`${id}-ring`} value={value.ring} onChange={(e) => onChange({ ...value, ring: e.target.value })} aria-invalid={error ? true : undefined}>
            {!rings.some((r) => r.slug === value.ring) && <option value={value.ring}>{value.ring || '…'}</option>}
            {rings.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
          {error && <p className="field-error">{error}</p>}
        </div>
      )}
      <p className="hint">{t(`memos.share.${value.visibility}Hint`)}</p>
    </fieldset>
  );
}
