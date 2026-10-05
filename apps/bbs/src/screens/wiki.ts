import { parseWiki, type Inline, type WikiChange, type WikiPageSummary, type WikiPageView, type WikiSearchHit } from '@app/shared';
import { CoreError } from '../core';
import type { Session } from '../session';
import { page } from './pager';
import { bold, cut, dim, heading, pad, when, wrap } from './util';

// The wiki in the terminal (docs/20, docs/04): read pages, follow their links by number, search, and see recent
// changes. Pages are written on the web; the terminal only reads them.

export interface RenderedPage { lines: string[]; links: { slug: string; title: string; exists: boolean }[] }

// A page as terminal lines. Wiki links show as "text[1]", numbered in the order they first appear, and are listed
// again at the foot with whether the page exists yet.
export function renderPage(p: WikiPageView, cols: number): RenderedPage {
  const w = Math.max(20, Math.min(79, cols - 1));
  const numbers = new Map<string, number>();
  const links: RenderedPage['links'] = [];
  const known = new Map(p.links.map((l) => [l.slug, l]));
  const inline = (segs: Inline[]) => segs.map((s) => {
    if (s.kind === 'wiki') {
      let n = numbers.get(s.slug);
      if (n === undefined) {
        n = links.length + 1;
        numbers.set(s.slug, n);
        links.push({ slug: s.slug, title: known.get(s.slug)?.title ?? s.target, exists: known.get(s.slug)?.exists ?? false });
      }
      return `${s.text}[${n}]`;
    }
    if (s.kind === 'link') return s.text === s.href ? s.href : `${s.text} <${s.href}>`;
    return s.text;
  }).join('');
  const lines: string[] = [heading(p.title, cols), dim(`Revision ${p.revision}, ${when(p.updated_at)}${p.updated_by ? ` by ${p.updated_by.handle}` : ''}`), ''];
  if (p.redirected_from) lines.splice(2, 0, dim(`(Moved from "${p.redirected_from}")`));
  for (const b of parseWiki(p.body)) {
    if (b.kind === 'heading') lines.push(bold(inline(b.content)));
    else if (b.kind === 'paragraph') lines.push(...wrap(inline(b.content), w));
    else if (b.kind === 'list') b.items.forEach((it, i) => {
      const mark = b.ordered ? `${i + 1}. ` : '- ';
      wrap(inline(it), w - 2 - mark.length).forEach((l, j) => lines.push(`  ${j ? ' '.repeat(mark.length) : mark}${l}`));
    });
    else if (b.kind === 'quote') for (const q of b.content) lines.push(...wrap(inline(q), w - 2).map((l) => `| ${l}`));
    else lines.push(...b.text.split('\n').map((l) => `    ${cut(l, w - 4)}`));
    lines.push('');
  }
  if (links.length) {
    lines.push(bold('Links on this page:'));
    links.forEach((l, i) => lines.push(`  ${pad(`${i + 1}.`, 4)}${cut(l.title, w - 20)}${l.exists ? '' : dim(' (no page yet)')}`));
  }
  return { lines, links };
}

const path = (ref: string) => `/wiki/${encodeURIComponent(ref)}`;

// `ref` is "site" or "ring:{slug}"; `name` is how the wiki is called on screen.
export async function wiki(s: Session, ref = 'site', name = 'Wiki'): Promise<void> {
  const t = s.term;
  const trail: string[] = [];
  let slug: string | null = 'home';
  for (;;) {
    if (slug === null) { // the wiki's own menu
      s.at(name);
      t.line(heading(name, t.cols));
      t.write(`${bold('H')}ome page, ${bold('A')}ll pages, ${bold('S')}earch, ${bold('R')}ecent changes, ${bold('Q')} to go back: `);
      const k = await t.choose('hasrq');
      t.line();
      if (k === null || k === 'q') return;
      if (k === 'h') slug = 'home';
      else slug = await (k === 'a' ? allPages : k === 's' ? search : changes)(s, ref);
      continue;
    }
    let p: WikiPageView;
    try {
      p = await s.api.get<WikiPageView>(`${path(ref)}/pages/${encodeURIComponent(slug)}`);
    } catch (e) {
      if (!(e instanceof CoreError) || e.status !== 404) throw e;
      t.line(slug === 'home' ? 'This wiki has no home page yet. Pages are written on the web.' : 'There is no page by that name yet. Pages are written on the web.');
      slug = trail.pop() ?? null;
      continue;
    }
    s.at(`${name}: ${p.title}`);
    const r = renderPage(p, t.cols);
    await page(s, r.lines);
    t.write(`\n${r.links.length ? 'Link number, ' : ''}${trail.length ? `${bold('B')}ack, ` : ''}${bold('M')}enu, or ${bold('Q')} to go back: `);
    const a = (await t.pick('bmq'))?.trim().toLowerCase();
    if (a === undefined || a === null || a === 'q' || a === '') return;
    if (a === 'm') { trail.length = 0; slug = null; continue; }
    if (a === 'b') { slug = trail.pop() ?? null; continue; }
    const l = r.links[Number(a) - 1];
    if (!l) { t.line('There is no link with that number.'); continue; }
    trail.push(p.slug);
    slug = l.slug;
  }
}

// A numbered list to pick a page from. Returns the slug picked, or null to go back to the wiki's menu.
async function choosePage(s: Session, title: string, rows: { slug: string; line: string }[], empty: string): Promise<string | null> {
  const t = s.term;
  t.line(heading(title, t.cols));
  if (!rows.length) { t.line(empty); return null; }
  await page(s, rows.map((r, i) => `${pad(String(i + 1), 4)}${r.line}`));
  for (;;) {
    t.write('\nPage number, or Enter to go back: ');
    const a = (await t.pick(''))?.trim();
    if (!a) return null;
    const r = rows[Number(a) - 1];
    if (r) return r.slug;
    t.line('There is no page with that number.');
  }
}

async function allPages(s: Session, ref: string): Promise<string | null> {
  const r = await s.api.get<{ pages: WikiPageSummary[] }>(`${path(ref)}/pages`);
  const w = Math.min(79, s.term.cols - 1);
  return choosePage(s, 'All pages', r.pages.map((p) => ({ slug: p.slug, line: `${pad(cut(p.title, w - 16), w - 15)}${dim(p.updated_at.slice(0, 10))}` })), 'This wiki has no pages yet.');
}

async function search(s: Session, ref: string): Promise<string | null> {
  const t = s.term;
  t.write('Search for: ');
  const q = (await t.readLine({ max: 200 }))?.trim();
  if (!q) return null;
  const r = await s.api.get<{ hits: WikiSearchHit[] }>(`${path(ref)}/search?q=${encodeURIComponent(q)}`);
  const w = Math.min(79, t.cols - 1);
  // Snippets mark the matched words with \u0002…\u0003; the terminal shows them bold.
  const snip = (x: string) => cut(x.replace(/\s+/g, ' '), w - 8).replace(/\u0002/g, '\x1b[1m').replace(/\u0003/g, '\x1b[0m');
  return choosePage(s, `Pages matching "${cut(q, 40)}"`, r.hits.map((h) => ({ slug: h.slug, line: `${bold(cut(h.title, w - 4))}\n      ${snip(h.snippet)}` })), 'No pages match that.');
}

async function changes(s: Session, ref: string): Promise<string | null> {
  const r = await s.api.get<{ changes: WikiChange[] }>(`${path(ref)}/changes`);
  const w = Math.min(79, s.term.cols - 1);
  const line = (c: WikiChange) => {
    const what = c.created ? 'new page' : c.reverted_to ? `put back revision ${c.reverted_to}` : c.summary || `revision ${c.revision}`;
    return `${dim(when(c.created_at))} ${cut(c.page.title, 30)} ${dim(`- ${c.editor?.handle ?? 'deleted account'}: ${cut(what, Math.max(10, w - 70))}`)}`;
  };
  return choosePage(s, 'Recent changes', r.changes.slice(0, 50).map((c) => ({ slug: c.page.slug, line: line(c) })), 'Nothing has changed yet.');
}
