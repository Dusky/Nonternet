// Seeds a throwaway database for scripts/load-test.mjs: N confirmed people (password "load-test-password")
// and a public board "lobby" with some threads. Never point it at a real site.
//   apps/core/node_modules/.bin/tsx apps/core/scripts/load-seed.ts <DATABASE_URL> <core URL> [people]
import pg from 'pg';
import { hashPassword } from '../src/passwords';
import { newId } from '../src/crypto';

const [url, core, n = '20'] = process.argv.slice(2);
if (!url || !core) { console.error('Usage: load-seed.ts <DATABASE_URL> <core URL> [people]'); process.exit(2); }
const db = new pg.Client({ connectionString: url });
await db.connect();
const hash = await hashPassword('load-test-password');
const handles: string[] = [];
for (let i = 0; i < Number(n); i++) {
  const h = `loader${i}`;
  handles.push(h);
  await db.query(`INSERT INTO users (id, handle, email, email_verified_at, password_hash, role) VALUES ($1, $2, $3, now(), $4, $5) ON CONFLICT DO NOTHING`,
    [newId('u'), h, `${h}@example.test`, hash, i === 0 ? 'trusted' : 'user']);
}
await db.end();
const login = await fetch(`${core}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: core }, body: JSON.stringify({ identifier: 'loader0', password: 'load-test-password' }) });
const sid = /sid=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')![1];
const call = (path: string, body: unknown) => fetch(`${core}/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: core, cookie: `sid=${sid}` }, body: JSON.stringify(body) });
await call('/boards', { slug: 'lobby', name: 'Lobby', visibility: 'public' });
for (let i = 0; i < 50; i++) await call('/boards/lobby/posts', { subject: `Seed thread ${i}`, body: `Seed post ${i}.\n`.repeat(5) });
console.log(handles.map((h) => `${h}:load-test-password`).join(','));
