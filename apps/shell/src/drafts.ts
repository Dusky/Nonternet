// Drafts (M9-C): what someone was writing is kept in this browser until it is sent, so a reload, a closed
// window or a dropped session never costs them the words. Kept per person and per place ("reply to this
// thread"), for 30 days, and cleared at logout with the rest of the person's local session.
const PREFIX = 'ui:draft:';
const MAX_AGE_MS = 30 * 86_400_000;
const MAX_DRAFTS = 40;

interface Saved { text: string; at: number }
const store = () => { try { return window.localStorage; } catch { return null; } };
const keyOf = (user: string, place: string) => `${PREFIX}${user}:${place}`;

export function loadDraft(user: string, place: string, now = Date.now()): string {
  try {
    const raw = store()?.getItem(keyOf(user, place));
    if (!raw) return '';
    const d = JSON.parse(raw) as Saved;
    if (typeof d.text !== 'string' || typeof d.at !== 'number' || now - d.at > MAX_AGE_MS) { store()?.removeItem(keyOf(user, place)); return ''; }
    return d.text;
  } catch { return ''; }
}

// An empty (or all-space) draft is not worth keeping: saving one clears it.
export function saveDraft(user: string, place: string, text: string, now = Date.now()): void {
  try {
    const s = store();
    if (!s) return;
    if (!text.trim()) { s.removeItem(keyOf(user, place)); return; }
    s.setItem(keyOf(user, place), JSON.stringify({ text, at: now } satisfies Saved));
    prune(s, now);
  } catch { /* storage full or blocked: drafts are a convenience */ }
}

export function clearDraft(user: string, place: string): void {
  try { store()?.removeItem(keyOf(user, place)); } catch { /* nothing to clear */ }
}

// Forget every draft: at logout, so the next person at a shared screen can't read what was being written.
export function clearAllDrafts(): void {
  try {
    const s = store();
    if (!s) return;
    for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) s.removeItem(k);
  } catch { /* nothing to clear */ }
}

// Old drafts go, and no more than MAX_DRAFTS are kept (the oldest give way).
function prune(s: Storage, now: number): void {
  const all: { k: string; at: number }[] = [];
  for (const k of Object.keys(s)) {
    if (!k.startsWith(PREFIX)) continue;
    try { all.push({ k, at: (JSON.parse(s.getItem(k) ?? '{}') as Saved).at ?? 0 }); } catch { s.removeItem(k); }
  }
  for (const d of all) if (now - d.at > MAX_AGE_MS) s.removeItem(d.k);
  const live = all.filter((d) => now - d.at <= MAX_AGE_MS).sort((a, b) => b.at - a.at);
  for (const d of live.slice(MAX_DRAFTS)) s.removeItem(d.k);
}

// ---------------------------------------------------------------- @mentions

// The "@name" being typed at the caret, if any: the text after an @ that starts a word, up to the caret.
export function mentionAt(text: string, caret: number): { start: number; prefix: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([A-Za-z0-9_-]{0,40})$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[2]!.length - 1, prefix: m[2]! };
}

// Puts the chosen handle in place of what was typed, with a space after, and says where the caret goes.
export function completeMention(text: string, caret: number, handle: string): { text: string; caret: number } | null {
  const at = mentionAt(text, caret);
  if (!at) return null;
  const insert = `@${handle} `;
  return { text: text.slice(0, at.start) + insert + text.slice(caret), caret: at.start + insert.length };
}
