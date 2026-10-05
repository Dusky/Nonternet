import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Toaster, toast as sonner } from 'sonner';
import { useT } from '../hooks';

// Two ways the interface talks back that every app shares:
// - confirm(): a real dialog in place of window.confirm, styled like the rest of the site, with the
//   action named on its button ("Delete post", not "OK"). Focus goes into it and comes back after.
//   Keep it for what can't be taken back; for anything that can, act at once and offer Undo instead.
// - toast(): a short note ("Saved.") at the bottom of the screen that a screen reader announces and
//   that never moves the page around. It goes away by itself, and can carry an Undo button.

export interface ConfirmOptions {
  message: string;
  confirmLabel: string;
  title?: string;
  danger?: boolean;
}
export interface ToastOptions {
  /** Shows an Undo button; called if it is pressed before the note goes away. */
  undo?: () => void;
}
type ToastFn = (text: string, kind?: 'ok' | 'error', options?: ToastOptions) => void;

const Ctx = createContext<{ confirm: (o: ConfirmOptions) => Promise<boolean> } | null>(null);
// Set while the provider is mounted, so toast() is a no-op in a unit test that renders one component.
let mounted = 0;
let undoLabel = 'Undo';

export function useConfirm(): (o: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(Ctx);
  // Outside the provider (a unit test rendering one component), fall back to the browser's own.
  return ctx?.confirm ?? (async (o) => window.confirm(o.message));
}

export const toast: ToastFn = (text, kind = 'ok', options) => {
  if (!mounted) return;
  const action = options?.undo ? { label: undoLabel, onClick: options.undo } : undefined;
  if (kind === 'error') sonner.error(text, { duration: 8000, action });
  else sonner(text, { duration: action ? 6000 : 4000, action });
};
export function useToast(): ToastFn {
  return toast;
}

// Act at once, with Undo (docs/10): the screen changes now (the caller does that), a note offers Undo, and the
// request goes to the server only when the note's time is up, so even something the server can't take back can be
// undone for a moment. Leaving the page sends anything still waiting.
const waiting = new Set<() => void>();
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { for (const run of [...waiting]) run(); });
export function undoable(text: string, commit: () => Promise<unknown>, opts: { onUndo?: () => void; onError?: (e: unknown) => void; delay?: number } = {}): void {
  let done = false;
  const finish = () => { done = true; clearTimeout(timer); waiting.delete(run); };
  const run = () => { if (done) return; finish(); commit().catch((e: unknown) => opts.onError?.(e)); };
  const timer = setTimeout(run, opts.delay ?? 6000);
  waiting.add(run);
  toast(text, 'ok', { undo: () => { if (done) return; finish(); opts.onUndo?.(); } });
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  undoLabel = t('common.undo');

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })), []);
  const answer = (ok: boolean) => { ask?.resolve(ok); setAsk(null); };

  return (
    <Ctx.Provider value={{ confirm }}>
      {children}
      <ModalOverlay isOpen={ask !== null} onOpenChange={(open) => { if (!open) answer(false); }} isDismissable className="dialog-overlay">
        <Modal className="dialog">
          <Dialog role="alertdialog" className="dialog-body">
            {ask && (
              <form onSubmit={(e) => { e.preventDefault(); answer(true); }}>
                <Heading slot="title">{ask.title ?? ask.message}</Heading>
                {ask.title && <p>{ask.message}</p>}
                <div className="actions">
                  <button type="button" className="btn" onClick={() => answer(false)} autoFocus={ask.danger}>{t('common.cancel')}</button>
                  <button type="submit" className={`btn ${ask.danger ? 'btn-danger btn-solid' : 'btn-primary'}`} autoFocus={!ask.danger}>{ask.confirmLabel}</button>
                </div>
              </form>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
      <Mounted />
      <Toaster
        position="bottom-center" visibleToasts={3} containerAriaLabel={t('toast.region')}
        toastOptions={{ unstyled: true, closeButton: true, closeButtonAriaLabel: t('common.dismiss'), classNames: { toast: 'toast', error: 'toast-error', actionButton: 'btn btn-small', closeButton: 'toast-close', title: 'toast-text' } }}
      />
    </Ctx.Provider>
  );
}

function Mounted() {
  useEffect(() => { mounted++; return () => { mounted--; }; }, []);
  return null;
}
