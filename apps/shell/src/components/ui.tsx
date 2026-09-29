import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { en } from '@app/strings';

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  // Errors interrupt a screen reader; the rest wait their turn.
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
  multiline?: boolean;
}

// A labelled input. The hint and the error are tied to the input so a screen reader reads them.
export function TextField({ label, value, onChange, hint, error, multiline, ...rest }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const common = { id, value, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline
        ? <textarea {...common} rows={4} maxLength={rest.maxLength} onChange={(e) => onChange(e.target.value)} />
        : <input {...common} {...rest} onChange={(e) => onChange(e.target.value)} />}
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

export function useCopy(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard blocked: the text is still on screen to copy by hand */ }
    },
  };
}

export function CopyButton({ text, label = en['common.copy'] }: { text: string; label?: string }) {
  const { copied, copy } = useCopy();
  return <button type="button" className="btn btn-quiet" onClick={() => void copy(text)}>{copied ? en['common.copied'] : label}</button>;
}

export function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="center" id="main">
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
