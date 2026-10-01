import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../hooks';

// Two ways the interface talks back that every app shares:
// - confirm(): a real dialog in place of window.confirm, styled like the rest of the site, with the
//   action named on its button ("Delete post", not "OK"). Focus goes into it and comes back after.
// - toast(): a short note ("Saved.") at the bottom of the screen that a screen reader announces and
//   that never moves the page around. It goes away by itself.

export interface ConfirmOptions {
  message: string;
  confirmLabel: string;
  title?: string;
  danger?: boolean;
}
interface Toast { id: number; text: string; kind: 'ok' | 'error' }
interface Feedback {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (text: string, kind?: Toast['kind']) => void;
}

const Ctx = createContext<Feedback | null>(null);

export function useConfirm(): Feedback['confirm'] {
  const ctx = useContext(Ctx);
  // Outside the provider (a unit test rendering one component), fall back to the browser's own.
  return ctx?.confirm ?? (async (o) => window.confirm(o.message));
}
export function useToast(): Feedback['toast'] {
  return useContext(Ctx)?.toast ?? (() => undefined);
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const nextId = useRef(1);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    returnTo.current = document.activeElement as HTMLElement | null;
    setAsk({ ...o, resolve });
  }), []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (ask && !d.open) d.showModal();
    if (!ask && d.open) d.close();
  }, [ask]);

  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
    // Back to whatever opened the dialog, so keyboard users don't lose their place.
    setTimeout(() => returnTo.current?.focus?.(), 0);
  };

  return (
    <Ctx.Provider value={{ confirm, toast }}>
      {children}
      <dialog ref={dialog} className="dialog" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); answer(false); }}>
        {ask && (
          <form method="dialog" className="dialog-body" onSubmit={(e) => { e.preventDefault(); answer(true); }}>
            <h2 id={titleId}>{ask.title ?? ask.message}</h2>
            {ask.title && <p>{ask.message}</p>}
            <div className="actions">
              <button type="button" className="btn" onClick={() => answer(false)} autoFocus={ask.danger}>{t('common.cancel')}</button>
              <button type="submit" className={`btn ${ask.danger ? 'btn-danger btn-solid' : 'btn-primary'}`} autoFocus={!ask.danger}>{ask.confirmLabel}</button>
            </div>
          </form>
        )}
      </dialog>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast${x.kind === 'error' ? ' toast-error' : ''}`}>
            <span>{x.text}</span>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setToasts((all) => all.filter((y) => y.id !== x.id))}>{t('common.dismiss')}</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
