#!/usr/bin/env node
// A load test (docs/19): signed-in people reading boards, threads and mail and now and then posting, as a
// busy evening would look. No dependencies: Node's own fetch, with a fixed number of concurrent callers.
//   node scripts/load-test.mjs --url http://127.0.0.1:3373 --users user1:pass,user2:pass --seconds 30 --concurrency 20 --board lobby
// The people must exist and be confirmed; the board must exist and they must be able to post there.
// Point it at a test copy of the site, never production: it really posts.
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const base = (args.url ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const seconds = Number(args.seconds ?? 20);
const concurrency = Number(args.concurrency ?? 10);
const board = args.board ?? 'lobby';
const people = (args.users ?? '').split(',').filter(Boolean).map((u) => { const [h, ...p] = u.split(':'); return { handle: h, password: p.join(':') }; });
if (!people.length) { console.error('Give --users handle:password,…'); process.exit(2); }
const origin = new URL(args.origin ?? base).origin;

async function login(p) {
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ identifier: p.handle, password: p.password }) });
  if (!r.ok) throw new Error(`login ${p.handle}: ${r.status} ${await r.text()}`);
  const sid = /sid=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1];
  if (!sid) throw new Error(`login ${p.handle}: no session cookie`);
  return sid;
}

const stats = new Map(); // name → { n, errors, times[] }
function note(name, ms, ok) {
  const s = stats.get(name) ?? { n: 0, errors: 0, times: [] };
  s.n++; if (!ok) s.errors++; s.times.push(ms);
  stats.set(name, s);
}
async function timed(name, sid, method, path, body) {
  const t0 = performance.now();
  let ok = false;
  try {
    const r = await fetch(`${base}${path}`, { method, headers: { cookie: `sid=${sid}`, origin, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    ok = r.ok;
    const text = await r.text();
    return ok ? JSON.parse(text || 'null') : null;
  } catch { return null; } finally { note(name, performance.now() - t0, ok); }
}

// One caller: a loop of what a person does, weighted towards reading.
async function caller(sid, until) {
  let threads = [];
  while (Date.now() < until) {
    const roll = Math.random();
    if (roll < 0.25) await timed('boards list', sid, 'GET', '/api/v1/boards');
    else if (roll < 0.5) { const r = await timed('thread list', sid, 'GET', `/api/v1/boards/${board}/threads?limit=30`); if (r?.threads?.length) threads = r.threads; }
    else if (roll < 0.75 && threads.length) await timed('read thread', sid, 'GET', `/api/v1/boards/${board}/threads/${threads[Math.floor(Math.random() * threads.length)].id}`);
    else if (roll < 0.85) await timed('mail list', sid, 'GET', '/api/v1/mail');
    else if (roll < 0.93) await timed('notifications', sid, 'GET', '/api/v1/notifications/count');
    else if (roll < 0.98) await timed('who is online', sid, 'GET', '/api/v1/online');
    else await timed('post', sid, 'POST', `/api/v1/boards/${board}/posts`, threads.length && Math.random() < 0.7
      ? { body: `A reply under load at ${new Date().toISOString()}.`, reply_to: threads[0].id }
      : { subject: `Load test ${Date.now() % 100000}`, body: 'A new thread made by the load test.' });
  }
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
const sids = [];
for (const p of people) sids.push(await login(p));
console.log(`Load test: ${concurrency} callers for ${seconds}s against ${base} as ${people.length} people`);
const until = Date.now() + seconds * 1000;
const t0 = Date.now();
await Promise.all(Array.from({ length: concurrency }, (_, i) => caller(sids[i % sids.length], until)));
const elapsed = (Date.now() - t0) / 1000;
let total = 0, errors = 0;
console.log(`\n${'what'.padEnd(16)}${'count'.padStart(8)}${'errors'.padStart(8)}${'p50 ms'.padStart(9)}${'p95 ms'.padStart(9)}${'p99 ms'.padStart(9)}`);
for (const [name, s] of [...stats].sort()) {
  total += s.n; errors += s.errors;
  console.log(`${name.padEnd(16)}${String(s.n).padStart(8)}${String(s.errors).padStart(8)}${pct(s.times, 50).toFixed(1).padStart(9)}${pct(s.times, 95).toFixed(1).padStart(9)}${pct(s.times, 99).toFixed(1).padStart(9)}`);
}
console.log(`\n${total} requests in ${elapsed.toFixed(1)}s: ${(total / elapsed).toFixed(0)} per second, ${errors} errors (${((errors / Math.max(1, total)) * 100).toFixed(2)}%).`);
if (args['max-error-rate'] && errors / Math.max(1, total) > Number(args['max-error-rate'])) process.exit(1);
if (args['max-p95'] && [...stats.values()].some((s) => pct(s.times, 95) > Number(args['max-p95']))) process.exit(1);
