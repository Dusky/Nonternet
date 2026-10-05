import iconv from 'iconv-lite';
import wrapAnsi from 'wrap-ansi';
import { ApiError } from './errors';
import { BODY_MAX, SUBJECT_MAX, TERMINAL_COLUMNS, type PostPreview } from '@app/shared';

// Post text is plain UTF-8 (docs/05). What we store is what the terminal BBS shows, so the
// cleaning here is deliberately strict: no control characters, and no invisible direction marks
// that could make text read differently from how it is written.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF]/g;

// `max` and `what` let other long texts (a wiki page) share the same cleaning with their own limit.
export function normalizeBody(raw: string, opts: { max?: number; what?: string } = {}): string {
  const text = raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .replace(UNSAFE, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/u, '');
  if (!text) throw new ApiError(400, 'empty_body', 'Write something first.');
  const max = opts.max ?? BODY_MAX;
  if ([...text].length > max) throw new ApiError(400, 'body_too_long', `${opts.what ?? 'A post'} can be up to ${max.toLocaleString('en-US')} characters.`);
  return text;
}

export function normalizeSubject(raw: string): string {
  const s = raw.normalize('NFC').replace(UNSAFE, '').replace(/\s+/gu, ' ').trim();
  if ([...s].length > SUBJECT_MAX) throw new ApiError(400, 'subject_too_long', `A subject can be up to ${SUBJECT_MAX} characters.`);
  return s;
}

// "Re: Re: hello" stays "Re: hello", and the result always fits.
export function replySubject(rootSubject: string): string {
  const base = rootSubject.replace(/^(re:\s*)+/i, '');
  return [...`Re: ${base}`].slice(0, SUBJECT_MAX).join('');
}

const cp437Cache = new Map<string, boolean>();
function inCp437(ch: string): boolean {
  let ok = cp437Cache.get(ch);
  if (ok === undefined) {
    ok = iconv.decode(iconv.encode(ch, 'cp437'), 'cp437') === ch;
    cp437Cache.set(ch, ok);
  }
  return ok;
}

export function wrapForTerminal(body: string): string[] {
  return body.split('\n').flatMap((line) => (line === '' ? [''] : wrapAnsi(line, TERMINAL_COLUMNS, { hard: true, trim: false }).split('\n')));
}

// The preview shows exactly the text that would be stored, plus how a classic terminal shows it.
export function previewPost(rawBody: string): PostPreview {
  const stored = normalizeBody(rawBody);
  const missing = new Set<string>();
  for (const ch of stored) if (ch !== '\n' && !inCp437(ch)) missing.add(ch);
  const warnings: string[] = [];
  if (missing.size) {
    const shown = [...missing].slice(0, 8).join(' ');
    warnings.push(`Classic terminals cannot show: ${shown}${missing.size > 8 ? ' and more' : ''}. They will appear as substitutes there.`);
  }
  return { stored, wrapped: wrapForTerminal(stored), warnings };
}

// @handle in a post. Not inside an address or a word, and at most 10 people per post so a post cannot
// be used to spam a crowd.
export function extractMentions(body: string, max = 10): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/(?<![A-Za-z0-9_@.\/-])@([A-Za-z][A-Za-z0-9_-]{1,19})\b/g)) {
    found.add(m[1]!.toLowerCase());
    if (found.size >= max) break;
  }
  return [...found];
}
