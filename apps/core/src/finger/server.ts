import net from 'node:net';
import { publicProfile } from '../characters';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { wrapForTerminal } from '../text';

// finger (RFC 1288; docs/05, decided 2026-10-05). `finger ada@site` answers with what anyone can already see on Ada's
// profile: name, status line, roughly when she was last here (if she shows it), her homepage, and her .plan. It goes
// through the same publicProfile() as the web, so guests, suspended and deleted people have nothing to show. A bare
// `finger @site` lists nobody: on the web, who is online is for signed-in people only. Forwarding (a@b@c) is refused.

const MAX_REQUEST = 512;
const TIMEOUT_MS = 10_000;
export const MAX_CONNECTIONS = 100;
const PER_ADDRESS = 10;

const LAST_SEEN = { today: 'today', this_week: 'this week', a_while: 'a while ago' } as const;
// Nothing that could move a terminal's cursor or change its colours reaches the caller.
const safe = (s: string) => s.replace(/[\p{C}]/gu, (c) => (c === '\n' ? '\n' : ''));

export async function answer(deps: AppDeps, raw: string): Promise<string> {
  let q = raw.trim();
  if (/^\/W(\s+|$)/i.test(q)) q = q.replace(/^\/W\s*/i, ''); // "verbose": accepted, and the answer is the same
  const site = deps.config.site.name;
  const host = deps.config.finger.host ?? deps.config.site.domain;
  if (q.includes('@')) return 'This server does not pass requests on to other hosts.';
  if (q === '') {
    return [
      site,
      `${deps.publicUrl}/`,
      '',
      `Ask about someone by their handle: finger handle@${host}`,
      'Nobody is listed here; the people directory is on the website for members.',
    ].join('\n');
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(q)) return 'That is not a handle. Handles are letters, digits, _ and -.';
  try {
    const p = await publicProfile(deps, q);
    const lines = [`${p.display_name ? `${p.display_name} (${p.handle})` : p.handle} on ${site}`];
    if (p.status_line || p.away) lines.push(`${p.away ? 'Away' : ''}${p.away && p.status_line ? ': ' : ''}${p.status_line ?? ''}`);
    if (p.last_seen) lines.push(`Last here ${LAST_SEEN[p.last_seen]}.`);
    lines.push(`Profile: ${deps.publicUrl}/people/${encodeURIComponent(p.handle)}`);
    if (p.homepage_url) lines.push(`Homepage: ${p.homepage_url}`);
    if (p.pronouns) lines.push(`Pronouns: ${p.pronouns}`);
    if (p.location) lines.push(`Location: ${p.location}`);
    for (const l of p.links) lines.push(`Link: ${l.label ? `${l.label} ` : ''}${l.url}`);
    lines.push('', p.plan ? 'Plan:' : 'No plan.');
    if (p.plan) lines.push(p.plan);
    return lines.join('\n');
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return `Nobody here goes by "${q}".`;
    throw e;
  }
}

// Wrapped to 79 columns with CRLF line endings, as finger clients expect.
export const render = (text: string): string => `${wrapForTerminal(safe(text)).join('\r\n')}\r\n`;

export function buildFingerServer(deps: AppDeps, log: (m: string) => void = () => undefined): net.Server {
  const perAddress = new Map<string, number>();
  const server = net.createServer((sock) => {
    const addr = sock.remoteAddress ?? '';
    const n = (perAddress.get(addr) ?? 0) + 1;
    perAddress.set(addr, n);
    sock.once('close', () => { const left = (perAddress.get(addr) ?? 1) - 1; if (left > 0) perAddress.set(addr, left); else perAddress.delete(addr); });
    if (n > PER_ADDRESS) { sock.end(render('Too many requests from your address at once. Try again in a moment.')); return; }
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy());
    sock.on('error', () => undefined);
    let buf = '';
    let done = false;
    sock.on('data', (chunk) => {
      if (done) return;
      buf += chunk.toString('utf8');
      if (buf.length > MAX_REQUEST) { done = true; sock.end(render('That request is too long.')); return; }
      const nl = buf.search(/\r?\n/);
      if (nl < 0) return;
      done = true;
      answer(deps, buf.slice(0, nl)).then((text) => sock.end(render(text))).catch((e) => {
        log(`finger: ${e instanceof Error ? e.message : String(e)}`);
        sock.end(render('Something went wrong. Try again later.'));
      });
    });
  });
  server.maxConnections = MAX_CONNECTIONS;
  return server;
}
