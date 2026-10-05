import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { TextField } from '../../components/ui';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { useMe, useT } from '../../hooks';
import { CopyButton } from '../../components/ui';

const COUNTER_STYLES = ['classic', 'odometer', 'lcd', 'amber', 'plain'] as const;

export function Widgets() {
  const t = useT();
  const me = useMe().data;
  const list = useQuery({ queryKey: ['studio', 'snippets'], queryFn: () => api.get<{ snippets: { id: string; html: string }[] }>('/homes/me/snippets') });
  const [counter, setCounter] = useState<(typeof COUNTER_STYLES)[number]>('classic');
  const mine = useQuery({ queryKey: ['profile', me?.handle.toLowerCase()], enabled: Boolean(me), queryFn: () => api.get<{ rings: { slug: string; name: string }[] }>(`/users/${encodeURIComponent(me!.handle)}`) });
  // The counter's look is one attribute on the snippet, so the person sees exactly what to paste.
  const html = (s: { id: string; html: string }) => (s.id === 'counter' && counter !== 'classic' ? s.html.replace('<script ', `<script data-style="${counter}" `) : s.html);
  return (
    <>
      <p>{t('studio.widgets.hint')}</p>
      <ul className="rows">
        {list.data?.snippets.map((s) => (
          <li key={s.id}>
            <strong>{t(`studio.widgets.${s.id}` as 'studio.widgets.guestbook')}</strong>
            {s.id === 'counter' && (
              <div className="field">
                <label htmlFor="counter-style">{t('studio.widgets.counterStyle')}</label>
                <select id="counter-style" value={counter} onChange={(e) => setCounter(e.target.value as typeof counter)}>
                  {COUNTER_STYLES.map((c) => <option key={c} value={c}>{t(`studio.widgets.counterStyle.${c}`)}</option>)}
                </select>
              </div>
            )}
            {/* Long lines scroll sideways, so the box must take the keyboard focus to be readable without a mouse. */}
            <pre className="terminal" tabIndex={0} role="group" aria-label={t(`studio.widgets.${s.id}` as 'studio.widgets.guestbook')}>{html(s)}</pre>
            <CopyButton text={html(s)} />
          </li>
        ))}
      </ul>
      <ButtonMaker />
      {mine.data && mine.data.rings.length > 0 && (
        <section className="panel" aria-labelledby="ringnav-h">
          <h3 id="ringnav-h">{t('studio.widgets.ringNav')}</h3>
          <p className="hint">{t('studio.widgets.ringNavHint')}</p>
          <ul className="plain">
            {mine.data.rings.map((r) => <li key={r.slug}><OpenAppLink app="rings" to={r.slug}>{t('studio.widgets.ringNavFor', { name: r.name })}</OpenAppLink></li>)}
          </ul>
        </section>
      )}
    </>
  );
}

// An 88x31 button from a couple of short lines and two colours. The site draws it (SVG or PNG); nothing is uploaded.
function ButtonMaker() {
  const t = useT();
  const [top, setTop] = useState('MADE BY');
  const [bottom, setBottom] = useState('HAND');
  const [fg, setFg] = useState('#ffee58');
  const [bg, setBg] = useState('#37474f');
  const query = new URLSearchParams({ text: `${top.trim()}|${bottom.trim()}`.replace(/\|$/, ''), fg: fg.slice(1), bg: bg.slice(1) }).toString();
  const origin = window.location.origin;
  const snippet = `<img src="${origin}/widgets/button.svg?${query}" width="88" height="31" alt="${[top, bottom].filter(Boolean).join(' ').replace(/"/g, '')}">`;
  return (
    <section className="panel" aria-labelledby="button-h">
      <h3 id="button-h">{t('studio.button.title')}</h3>
      <p><img src={`/widgets/button.svg?${query}`} width={88} height={31} alt={t('studio.button.preview')} /></p>
      <TextField label={t('studio.button.top')} value={top} onChange={setTop} maxLength={14} required />
      <TextField label={t('studio.button.bottom')} value={bottom} onChange={setBottom} maxLength={14} />
      <div className="field"><label htmlFor="btn-fg">{t('studio.button.fg')}</label><input id="btn-fg" type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></div>
      <div className="field"><label htmlFor="btn-bg">{t('studio.button.bg')}</label><input id="btn-bg" type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></div>
      <pre className="terminal" tabIndex={0} role="group" aria-label={t('studio.button.title')}>{snippet}</pre>
      <CopyButton text={snippet} />
      {' '}<CopyButton text={`${origin}/widgets/button.png?${query}`} label={t('studio.button.pngLink')} />
    </section>
  );
}
