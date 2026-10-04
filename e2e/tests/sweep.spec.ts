import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { makeAdmin, signIn, totp } from '../support/helpers';
import { BASE_URL, cli, CORE_PORT } from '../support/stack';

// A sweep of every screen, for a walkthrough by eye and by hand (not a pass/fail test). For each role, device and
// screen it saves a screenshot and records what went wrong: errors in the console, requests that failed, accessibility
// problems, sideways scrolling, things sticking out of the window, pictures that did not load and "Loading" that never
// ends. On the desktop it also presses every button and link on the screen (except ones that delete, suspend or
// restart) and notes clicks that cause an error.
//   SWEEP=/tmp/sweep pnpm --filter @app/e2e exec playwright test sweep
const OUT = process.env.SWEEP;
test.skip(!OUT, 'set SWEEP=<folder> to run the sweep');
test.use({ actionTimeout: 5000, navigationTimeout: 15_000 });

const DEMO_PASSWORD = 'demo walkthrough 1';
const THEMES = ['webring', 'after-dark', 'terminal', 'platinum', 'aqua'] as const;
const THEMED = new Set(['/', '/boards/synths', 'THREAD', '/boards/synths/new', '/mail', 'MAILTHREAD', '/people/ada', '/settings/profile', '/studio/files', '/admin/status', '/admin/users', '/chat', '/mud', '/terminal', '/login']);
const DESTRUCTIVE = /delete|remove|suspend|sign out|log out|decline|restart|update the site|erase|leave|block|revoke|reset|hide|lock|archive|ban|disconnect|demote|turn off|goodbye|reject|clear/i;

interface Finding { role: string; device: string; theme: string; route: string; kind: string; detail: string }
const findings: Finding[] = [];
const shots: { file: string; role: string; device: string; theme: string; route: string }[] = [];

const routes = (ids: Ids) => ({
  visitor: ['/', '/login', '/signup', '/forgot-password', '/legal/terms', '/legal/privacy', '/boards', '/boards/synths', ids.thread, '/rings', '/rings/handmade', '/people', '/people/ada', '/files', '/homepages', '/boards/bulletins', '/boards/polls'],
  user: ['/', '/boards', '/boards/new', '/boards/search/synth', '/boards/synths', ids.thread, '/boards/synths/new', '/boards/bulletins', `/boards/bulletins/${ids.bulletin}`, '/boards/polls', `/boards/polls/${ids.poll}`,
    '/rings', '/rings/new', '/rings/handmade', '/people', '/people/ada', '/mail', '/mail/new', ids.mailThread, '/files', ids.area ? `/files/${ids.area}` : '/files', '/chat', '/mud', '/terminal',
    '/homepages', '/homepages/guestbook/lin', '/studio/files', '/studio/assets', '/studio/widgets', '/studio/guestbook', '/studio/domains', '/studio/settings', '/notifications',
    ...['profile', 'account', 'password', 'two-factor', 'terminal', 'data', 'blocked', 'appearance', 'notifications', 'chat', 'boards'].map((s) => `/settings/${s}`)],
  admin: ['/admin/status', '/admin/users', `/admin/users/${ids.userId}`, '/admin/invites', '/admin/audit', '/admin/reports', '/admin/boards', '/admin/rings', '/admin/homepages', '/admin/settings', '/admin/announcements',
    '/admin/legal', '/admin/irc', '/admin/mud', '/admin/backups', '/admin/vouches', '/admin/stats', '/admin/console', '/admin/bbs', '/admin/updates', '/admin/applications', '/boards/synths/settings', '/boards/synths/modlog', '/boards/reports'],
});
interface Ids { thread: string; mailThread: string; bulletin: number; poll: string; area: string | null; userId: string }

test('sweep every screen', async ({ browser, page }) => {
  test.setTimeout(3 * 60 * 60_000);
  mkdirSync(join(OUT!, 'shots'), { recursive: true });
  cli(['seed-demo', '--url', `http://127.0.0.1:${CORE_PORT}`]);
  const admin = await makeAdmin(page);
  const ids = await gather(page, admin);

  const plan = routes(ids);
  for (const device of ['desktop', 'phone'] as const) {
    for (const role of ['visitor', 'user', 'admin'] as const) {
      const list = role === 'admin' ? plan.admin : role === 'user' ? plan.user : plan.visitor;
      for (const theme of THEMES) {
        const these = theme === 'webring' ? list : list.filter((r) => THEMED.has(r) || (r === ids.thread && THEMED.has('THREAD')) || (r === ids.mailThread && THEMED.has('MAILTHREAD')));
        if (!these.length) continue;
        const ctx = await context(browser, device, theme);
        const p = await ctx.newPage();
        const live = watch(p);
        if (role === 'user') await signIn(p, 'tansy', DEMO_PASSWORD);
        if (role === 'admin') await signIn(p, admin.handle, admin.password, { recovery: admin.recoveryCodes[(device === 'phone' ? 5 : 0) + THEMES.indexOf(theme)]! });
        for (const route of these) {
          await visit(p, live, { role, device, theme, route });
          if (device === 'desktop' && theme === 'webring' && role !== 'visitor') await crawl(p, live, { role, device, theme, route });
        }
        await ctx.close();
        save();
      }
    }
  }
  save();
});

function save() {
  writeFileSync(join(OUT!, 'report.json'), JSON.stringify({ findings, shots }, null, 2));
}

async function context(browser: Browser, device: 'desktop' | 'phone', theme: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    ...(device === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }),
    colorScheme: theme === 'after-dark' || theme === 'terminal' ? 'dark' : 'light',
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('ui:theme', t); localStorage.setItem('ui:seen-look-2026-10', '1'); } catch { /* storage blocked */ } }, theme);
  return ctx;
}

// What the page says went wrong, collected as it happens.
function watch(p: Page) {
  const live = { errors: [] as string[], failed: [] as string[] };
  p.on('pageerror', (e) => live.errors.push(`uncaught: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) live.errors.push(m.text().slice(0, 300)); });
  p.on('response', (r) => {
    const u = new URL(r.url());
    if (r.status() >= 400 && !(u.pathname === '/api/v1/me' && r.status() === 401)) live.failed.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
  });
  return live;
}
const flush = (live: ReturnType<typeof watch>) => { const out = { errors: [...live.errors], failed: [...live.failed] }; live.errors.length = 0; live.failed.length = 0; return out; };

type Where = Omit<Finding, 'kind' | 'detail'>;
const note = (w: Where, kind: string, detail: string) => findings.push({ ...w, kind, detail });

async function settle(p: Page) {
  await p.waitForTimeout(700);
  await p.getByText(/^Loading/).first().waitFor({ state: 'hidden', timeout: 6000 }).catch(() => undefined);
  await p.waitForTimeout(300);
}

async function visit(p: Page, live: ReturnType<typeof watch>, w: Where) {
  try { await p.goto(w.route); } catch (e) { note(w, 'navigation', String(e).slice(0, 200)); return; }
  await settle(p);
  if (await p.getByText(/^Loading/).first().isVisible().catch(() => false)) note(w, 'stuck-loading', 'Loading still shown after 7 s');
  const { errors, failed } = flush(live);
  for (const e of errors) note(w, 'console', e);
  for (const f of failed) note(w, 'request', f);
  const layout = await p.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('.xterm, [aria-hidden="true"], .sr-only')) continue;
      if (r.right > vw + 2 && r.left < vw) {
        const scroller = (() => { for (let a = el.parentElement; a; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return a; } return null; })();
        if (!scroller) { const k = `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80); if (!seen.has(k)) { seen.add(k); out.push(`sticks out of the window: ${k} (right ${Math.round(r.right)})`); } }
      }
      // Text cut off inside a box that can't scroll.
      if (el.children.length === 0 && el.textContent?.trim() && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow === 'hidden' && getComputedStyle(el).textOverflow !== 'ellipsis') {
        const k = `clip:${el.tagName}.${el.className}`.slice(0, 80);
        if (!seen.has(k)) { seen.add(k); out.push(`text clipped: "${el.textContent.trim().slice(0, 40)}" in ${el.tagName.toLowerCase()}.${el.className}`.slice(0, 160)); }
      }
    }
    for (const img of Array.from(document.images)) if (img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().width) out.push(`picture did not load: ${img.getAttribute('src')?.slice(0, 80)}`);
    return out.slice(0, 15);
  });
  for (const l of layout) note(w, 'layout', l);
  const alerts = await p.locator('.alert-error, [role="alert"]').allInnerTexts().catch(() => []);
  for (const a of alerts) if (a.trim()) note(w, 'alert', a.trim().slice(0, 200));
  if (w.theme === 'webring') {
    const axe = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('.xterm').analyze().catch(() => null);
    for (const v of axe?.violations ?? []) note(w, 'a11y', `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`.slice(0, 300));
  }
  const file = `${w.role}-${w.device}-${w.theme}-${w.route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_') || 'home'}.png`;
  await p.screenshot({ path: join(OUT!, 'shots', file), fullPage: true }).catch(() => undefined);
  shots.push({ file, ...w });
}

// Presses each button, tab and in-app link on the screen in turn, from a fresh load each time.
async function crawl(p: Page, live: ReturnType<typeof watch>, w: Where) {
  const targets = await p.evaluate((destructive) => {
    const re = new RegExp(destructive, 'i');
    const out: { label: string; index: number; kind: string }[] = [];
    const els = Array.from(document.querySelectorAll<HTMLElement>('main button, main [role="tab"], main a[href^="/"], .window button, .window a[href^="/"], [role="dialog"] button'));
    const seen = new Set<string>();
    els.forEach((el, index) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || (el as HTMLButtonElement).disabled) return;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!label || re.test(label) || seen.has(label)) return;
      seen.add(label);
      out.push({ label, index, kind: el.tagName.toLowerCase() });
    });
    return out.slice(0, 18);
  }, DESTRUCTIVE.source);
  for (const t of targets) {
    try { await p.goto(w.route); await settle(p); } catch { continue; }
    flush(live);
    const el = p.locator('main button, main [role="tab"], main a[href^="/"], .window button, .window a[href^="/"], [role="dialog"] button').nth(t.index);
    const before = await p.evaluate(() => document.body.innerText.length + location.href);
    try { await el.click({ timeout: 3000 }); } catch (e) { note({ ...w, route: `${w.route} → ${t.label}` }, 'click-failed', String(e).split('\n')[0]!.slice(0, 200)); continue; }
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => document.body.innerText.length + location.href);
    const { errors, failed } = flush(live);
    const where = { ...w, route: `${w.route} → ${t.label}` };
    for (const e of errors) note(where, 'console', e);
    for (const f of failed) note(where, 'request', f);
    const alerts = await p.locator('.alert-error').allInnerTexts().catch(() => []);
    for (const a of alerts) if (a.trim()) note(where, 'alert', a.trim().slice(0, 200));
    if (before === after && t.kind !== 'a') note(where, 'dead-click', 'nothing on the page changed');
  }
}

async function gather(page: Page, admin: Awaited<ReturnType<typeof makeAdmin>>): Promise<Ids> {
  const api = page.context().request;
  const h = { origin: BASE_URL };
  await api.post('/api/v1/auth/login', { data: { identifier: 'tansy', password: DEMO_PASSWORD }, headers: h });
  const threads = (await (await api.get('/api/v1/boards/synths/threads')).json()).threads as { id: string }[];
  const mail = (await (await api.get('/api/v1/mail')).json()).threads as { id: string }[];
  const bulletins = (await (await api.get('/api/v1/bulletins')).json()).bulletins as { number: number }[];
  const polls = (await (await api.get('/api/v1/polls')).json()).polls as { id: string }[];
  const me = (await (await api.get('/api/v1/me')).json()).user as { id: string };
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });
  await api.post('/api/v1/auth/login', { data: { identifier: admin.handle, password: admin.password, totp: await totp(admin.secret, 1) }, headers: h });
  const area = await api.post('/api/v1/admin/files/areas', { data: { slug: 'tools', name: 'Tools and utilities', description: 'Small programs and fonts.', visibility: 'public', upload_role: 'user' }, headers: h });
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });
  return {
    thread: `/boards/synths/t/${threads[0]!.id}`, mailThread: mail[0] ? `/mail/${mail[0].id}` : '/mail', bulletin: bulletins[0]?.number ?? 1,
    poll: polls[0]?.id ?? '', area: area.ok() ? 'tools' : null, userId: me.id,
  };
}
