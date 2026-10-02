import type { HomepageSummary } from '@app/shared';
import { useToast } from '../../components/feedback';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, useT } from '../../hooks';

export function Settings({ h }: { h: HomepageSummary }) {
  const t = useT();
  const qc = useQueryClient();
  const [title, setTitle] = useState(h.title);
  const [description, setDescription] = useState(h.description);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.patch('/homes/me', { title, description }),
    onSuccess: () => { toast(t('studio.settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['studio'] }); }, onError: (e) => setError(errorText(e)),
  });
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <TextField label={t('studio.settings.title')} value={title} onChange={setTitle} maxLength={100} />
      <TextField label={t('studio.settings.description')} hint={t('studio.settings.descriptionHint')} value={description} onChange={setDescription} maxLength={300} multiline />
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={save.isPending}>{t('common.save')}</button>
    </form>
  );
}
