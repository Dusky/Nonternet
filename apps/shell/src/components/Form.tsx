import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useForm, type AnyFieldApi } from '@tanstack/react-form';
import { ApiError } from '../api';
import { errorText, useT } from '../hooks';
import { Alert } from './ui';

// Forms (docs/10, decided 2026-10-04): TanStack Form with the shared zod schema, so the browser applies the same rules
// as the server. A field's own mistake shows when the person leaves it (and again as they fix it); pressing the button with
// mistakes shows all of them; what only the server can know (a handle already taken) is pinned to its field by the
// error's code, and the rest shows once at the bottom in plain words.

export type ServerFields<V> = Record<string, keyof V & string>; // error code -> the field it belongs to

interface Options<V extends Record<string, unknown>> {
  /** A Standard Schema, such as one of the shared zod schemas, for forms whose fields are the schema's. */
  schema?: object;
  /** Or a function giving each field's message (for forms that change shape, like sign-up). */
  validate?: (values: V) => Record<string, string> | undefined;
  defaultValues: V;
  /** Sends the values. Throw (or let an ApiError through) to refuse. */
  submit: (values: V) => Promise<unknown>;
  /** Which field a server error code belongs to; any other error is shown for the whole form. */
  serverFields?: ServerFields<V>;
  onDone?: (result: unknown, values: V) => void;
}

export function useZodForm<V extends Record<string, unknown>>({ schema, validate, defaultValues, submit, serverFields = {}, onDone }: Options<V>) {
  const [serverError, setServerError] = useState<{ field: string | null; message: string } | null>(null);
  const form = useForm({
    defaultValues,
    validators: { onChange: (validate ? ({ value }: { value: V }) => { const fields = validate(value); return fields ? { fields } : undefined; } : schema) as never },
    onSubmit: async ({ value }) => {
      setServerError(null);
      try {
        const result = await submit(value as V);
        onDone?.(result, value as V);
      } catch (e) {
        const field = e instanceof ApiError ? serverFields[e.code] ?? null : null;
        setServerError({ field, message: errorText(e) });
      }
    },
  });
  // `form` is typed loosely on purpose: TanStack's full generics add nothing for these thin wrappers.
  return { form: form as unknown as AnyForm, serverError, clearServerError: () => setServerError(null), values: undefined as unknown as V };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = any;
type FormApi<V extends Record<string, unknown>> = { form: AnyForm; serverError: { field: string | null; message: string } | null; clearServerError: () => void; values: V };

// One field of a form built with useZodForm: a labelled input tied to its hint and error.
export function Field<V extends Record<string, unknown>>({ f, name, label, hint, multiline, type = 'text', ...rest }: {
  f: FormApi<V>;
  name: keyof V & string;
  label: string;
  hint?: string;
  multiline?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'value' | 'onChange' | 'onBlur'>) {
  const id = useId();
  return (
    <Shown f={f}>{(tries) => (
    <f.form.Field name={name}>
      {(field: AnyFieldApi) => {
        const own = showOwn(field, tries) ? firstMessage(field.state.meta.errors[0]) : null;
        const pinned = f.serverError?.field === name ? f.serverError.message : null;
        const error = own ?? pinned;
        const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
        const common = {
          id, name, value: String(field.state.value ?? ''), 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined,
          onBlur: field.handleBlur,
          onChange: (e: { target: { value: string } }) => { if (pinned) f.clearServerError(); field.handleChange(e.target.value); },
        };
        return (
          <div className="field">
            <label htmlFor={id}>{label}</label>
            {multiline ? <textarea {...common} rows={4} maxLength={rest.maxLength} /> : <input {...rest} {...common} type={type} />}
            {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
            {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
          </div>
        );
      }}
    </f.form.Field>
    )}</Shown>
  );
}

// A field's own mistake shows once the person has left it, or has pressed the button: not on the first keystroke.
// (TanStack marks a field "touched" as soon as it changes, so that flag says too little.)
const showOwn = (field: AnyFieldApi, tries: number) => (field.state.meta.isBlurred || tries > 0) && field.state.meta.errors.length > 0;
function Shown<V extends Record<string, unknown>>({ f, children }: { f: FormApi<V>; children: (tries: number) => ReactNode }) {
  return <f.form.Subscribe selector={(s: { submissionAttempts: number }) => s.submissionAttempts}>{children}</f.form.Subscribe>;
}

// A true/false field (a checkbox).
export function CheckField<V extends Record<string, unknown>>({ f, name, label }: { f: FormApi<V>; name: keyof V & string; label: ReactNode }) {
  const id = useId();
  return (
    <Shown f={f}>{(tries) => (
    <f.form.Field name={name}>
      {(field: AnyFieldApi) => {
        const error = showOwn(field, tries) ? firstMessage(field.state.meta.errors[0]) : null;
        return (
          <div className="field">
            <label className="check">
              <input type="checkbox" id={id} checked={Boolean(field.state.value)} onBlur={field.handleBlur} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => field.handleChange(e.target.checked)} />
              {label}
            </label>
            {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
          </div>
        );
      }}
    </f.form.Field>
    )}</Shown>
  );
}

// The form element with its submit button and the one place a whole-form error is shown.
export function Form<V extends Record<string, unknown>>({ f, submitLabel, workingLabel, children, extra }: {
  f: FormApi<V>;
  submitLabel: string;
  workingLabel?: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  const t = useT();
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void f.form.handleSubmit(); }}>
      {children}
      {extra}
      {f.serverError && f.serverError.field === null && <Alert kind="error">{f.serverError.message}</Alert>}
      {/* The button stays on until the request is on its way: a button that is off with no word about why leaves a
          person stuck. Pressing it with mistakes in the form shows every one of them. */}
      <f.form.Subscribe selector={(s: { isSubmitting: boolean }) => s.isSubmitting}>
        {(submitting: boolean) => (
          <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? workingLabel ?? t('common.working') : submitLabel}</button>
        )}
      </f.form.Subscribe>
    </form>
  );
}

// zod issues arrive as objects with a message; a string is already one. Shown as a sentence, like the server's.
function firstMessage(e: unknown): string {
  const raw = typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
  const t = raw.trim();
  return t ? `${t[0]!.toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}` : '';
}

// Runs one of the shared zod schemas over the values and gives the first message for each field, for `validate`.
export function fieldMessages(parsed: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): Record<string, string> | undefined {
  if (parsed.success || !parsed.error) return undefined;
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) out[String(issue.path[0] ?? '')] ??= issue.message;
  return out;
}
