import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { REPORT_CATEGORIES } from '@app/shared';
import { api } from '../api';
import { Alert, Centered, TextField } from '../components/ui';
import { errorText, useT } from '../hooks';

// Where the "Report this page" link on every homepage leads. Signed-out visitors are sent to log
// in first and come back here (the route is behind the login guard).
export function ReportHomepagePage() {
  const t = useT();
  const { handle = '' } = useParams();
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('spam');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({ mutationFn: () => api.post('/reports', { homepage: handle, category, note }), onError: (e) => setError(errorText(e)) });
  return (
    <Centered title={t('report.homepage.title', { name: handle })}>
      {send.isSuccess ? <Alert kind="success">{t('report.homepage.sent')}</Alert> : (
        <form onSubmit={(e) => { e.preventDefault(); setError(null); send.mutate(); }}>
          <p>{t('report.homepage.intro')}</p>
          <div className="field">
            <label htmlFor="rep-cat">{t('boards.report.category')}</label>
            <select id="rep-cat" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`boards.report.cat.${c}`)}</option>)}
            </select>
          </div>
          <TextField label={t('boards.report.note')} value={note} onChange={setNote} maxLength={500} multiline />
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn btn-primary" type="submit" disabled={send.isPending}>{t('boards.report.send')}</button>
        </form>
      )}
      <p className="links"><Link to="/homepages">{t('report.homepage.back')}</Link></p>
    </Centered>
  );
}
