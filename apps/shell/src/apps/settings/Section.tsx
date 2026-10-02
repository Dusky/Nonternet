import type { ReactNode } from 'react';
import { useT } from '../../hooks';

// One block of Settings. Every tab is made of these, so they all look alike: a title strip, a note saying where the
// choice is kept (your account, which follows you, or only this device), an optional line of help, then the controls.
export function Section({ id, title, scope, intro, children }: { id: string; title: string; scope?: 'account' | 'device'; intro?: ReactNode; children: ReactNode }) {
  const t = useT();
  return (
    <section className="panel settings-section" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>{title}</h2>
        {scope && <span className="badge settings-scope">{t(scope === 'account' ? 'settings.scope.account' : 'settings.scope.device')}</span>}
      </div>
      {intro && <p className="hint">{intro}</p>}
      {children}
    </section>
  );
}
