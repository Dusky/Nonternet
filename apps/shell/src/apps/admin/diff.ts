// Field-by-field changes between an audit entry's before and after (docs/11 §3). Values are shown as
// JSON so nested objects and arrays compare exactly. Fields that are only commentary (reason, note)
// are listed separately by the caller, not as changes.
export interface FieldChange { field: string; before: string | null; after: string | null; kind: 'added' | 'removed' | 'changed' | 'same' }
const COMMENTARY = new Set(['reason', 'note']);
const show = (v: unknown): string | null => (v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v));

export function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): FieldChange[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !COMMENTARY.has(k)).sort();
  return keys.map((field) => {
    const x = show(b[field]);
    const y = show(a[field]);
    const kind = x === null ? 'added' : y === null ? 'removed' : x === y ? 'same' : 'changed';
    return { field, before: x, after: y, kind };
  });
}

// What we know about the object after each step: the latest value seen for every field, oldest first.
export function replayState(steps: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }[], upTo: number): Record<string, string> {
  const state: Record<string, string> = {};
  for (const s of steps.slice(0, upTo + 1)) {
    for (const [k, v] of Object.entries(s.before ?? {})) if (!COMMENTARY.has(k) && !(k in state)) state[k] = show(v)!;
    for (const [k, v] of Object.entries(s.after ?? {})) if (!COMMENTARY.has(k)) state[k] = show(v)!;
  }
  return state;
}
