import type { BoardSummary, PostPreview, PostView, ThreadSummary } from '@app/shared';
import { editMessage } from '../editor';
import type { Session } from '../session';
import { page } from './pager';
import { bold, cut, dim, heading, pad, when, wrap } from './util';

// Boards in the terminal (docs/04, 05): the same boards, threads and read pointers as the web, through the
// same API. Reading here moves the read pointer, so the web's unread counts follow.

type NewPost = PostView & { thread_subject: string };

async function listBoards(s: Session): Promise<BoardSummary[]> {
  return (await s.api.get<{ boards: BoardSummary[] }>('/boards')).boards.filter((b) => !b.hidden);
}

export async function boards(s: Session): Promise<void> {
  const t = s.term;
  for (;;) {
    s.at('Boards');
    const list = await listBoards(s);
    t.line(heading('Boards', t.cols));
    t.line(dim(`${pad('#', 4)}${pad('Board', 34)}${pad('Unread', 8)}Threads`));
    list.forEach((b, i) => t.line(`${pad(String(i + 1), 4)}${pad(cut(b.name + (b.archived ? ' (archived)' : ''), 33), 34)}${pad(b.unread ? bold(String(b.unread)) + ' '.repeat(Math.max(0, 8 - String(b.unread).length)) : '-', 8)}${b.thread_count}`));
    if (!list.length) t.line('There are no boards you can read yet.');
    t.write(`\nBoard number, ${bold('N')}ew scan, or ${bold('Q')} to go back: `);
    const answer = (await t.readLine({ max: 6 }))?.trim().toLowerCase();
    if (answer === undefined || answer === null || answer === 'q' || answer === '') return;
    if (answer === 'n') { await newscan(s); continue; }
    const b = list[Number(answer) - 1];
    if (!b) { t.line('There is no board with that number.'); continue; }
    await board(s, b);
  }
}

export async function board(s: Session, b: BoardSummary): Promise<void> {
  const t = s.term;
  let before: number | undefined;
  const stack: (number | undefined)[] = [];
  for (;;) {
    s.at(`Reading ${b.name}`);
    const r = await s.api.get<{ threads: ThreadSummary[]; next: number | null }>(`/boards/${b.slug}/threads?limit=${Math.max(5, Math.min(20, t.rows - 6))}${before ? `&before=${before}` : ''}`);
    t.line(heading(b.name, t.cols));
    if (b.description) t.line(dim(cut(b.description, t.cols - 1)));
    t.line(dim(`${pad('#', 4)}${pad('Subject', 40)}${pad('By', 16)}Replies`));
    r.threads.forEach((th, i) => {
      const mark = th.unread ? bold('*') : ' ';
      const subject = th.state === 'ok' || th.state === 'hidden' ? th.subject : `[${th.state}]`;
      t.line(`${pad(String(i + 1), 3)}${mark}${pad(cut(subject + (th.pinned ? ' [pinned]' : '') + (th.locked ? ' [locked]' : ''), 39), 40)}${pad(cut(th.author?.handle ?? '-', 15), 16)}${th.reply_count}`);
    });
    if (!r.threads.length) t.line('No threads yet.');
    const keys = [`number to read`, b.can_post && !b.archived ? `${bold('P')}ost` : '', r.next ? `${bold('M')}ore` : '', stack.length ? `${bold('B')}ack a page` : '', `${bold('A')}ll read`, `${bold('Q')}uit`].filter(Boolean);
    t.write(`\n${keys.join(', ')}: `);
    const answer = (await t.readLine({ max: 6 }))?.trim().toLowerCase();
    if (answer === undefined || answer === null || answer === 'q' || answer === '') return;
    if (answer === 'm' && r.next) { stack.push(before); before = r.next; continue; }
    if (answer === 'b' && stack.length) { before = stack.pop(); continue; }
    if (answer === 'a') { await s.api.put(`/boards/${b.slug}/read-pointer`, { all: true }); t.line('Marked the whole board read.'); continue; }
    if (answer === 'p' && b.can_post && !b.archived) { await compose(s, b, null); continue; }
    const th = r.threads[Number(answer) - 1];
    if (!th) { t.line('There is no thread with that number.'); continue; }
    await readThread(s, b, th.id);
  }
}

// Replies under what they answer, like the web's threaded view.
function threadOrder(posts: PostView[]): { post: PostView; depth: number }[] {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const kids = new Map<string, PostView[]>();
  const top: PostView[] = [];
  for (const p of posts) {
    if (p.reply_to_id && byId.has(p.reply_to_id)) kids.set(p.reply_to_id, [...(kids.get(p.reply_to_id) ?? []), p]);
    else top.push(p);
  }
  const out: { post: PostView; depth: number }[] = [];
  const walk = (p: PostView, d: number) => { out.push({ post: p, depth: d }); for (const k of kids.get(p.id) ?? []) walk(k, d + 1); };
  top.forEach((p) => walk(p, 0));
  return out;
}

// "  [Agree 2, Thanks 1]": counts only. Reacting happens on the web.
function reactionLine(p: PostView): string {
  const r = (p.reactions ?? []).filter((x) => x.count > 0);
  return r.length ? `  [${r.map((x) => `${x.name[0]!.toUpperCase()}${x.name.slice(1)} ${x.count}`).join(', ')}]` : '';
}

function renderPost(s: Session, p: PostView, n: number, total: number, depth = 0): string[] {
  const w = Math.min(79, s.term.cols - 1) - Math.min(depth, 6) * 2;
  const indent = ' '.repeat(Math.min(depth, 6) * 2);
  const who = p.author ? `${p.author.display_name ? `${p.author.display_name} (${p.author.handle})` : p.author.handle}${p.author.character ? `, as ${p.author.character.name}` : ''}` : 'a deleted account';
  const head = [`${indent}${bold(`[${n}/${total}]`)} ${bold(cut(p.subject || '', w - 10))}`, `${indent}${dim(`From ${who} · ${when(p.posted_at)} UTC${p.edited_at ? ' (edited)' : ''}${reactionLine(p)}`)}`];
  const body = p.state === 'deleted' ? ['[deleted by its author]'] : p.state === 'removed' ? ['[removed by a moderator]'] : p.body === null ? ['[hidden by a moderator]'] : wrap(p.body, w);
  return [...head, '', ...body.map((l) => indent + l), ''];
}

async function readThread(s: Session, b: BoardSummary, threadId: string): Promise<void> {
  const t = s.term;
  let threaded = false;
  const all: PostView[] = [];
  let after: number | undefined;
  let locked = false;
  do {
    const r = await s.api.get<{ posts: PostView[]; next: number | null; locked: boolean }>(`/boards/${b.slug}/threads/${threadId}?limit=200${after ? `&after=${after}` : ''}`);
    all.push(...r.posts);
    locked = r.locked;
    after = r.next ?? undefined;
  } while (after && all.length < 2000);
  let i = 0;
  const canReply = b.can_post && !b.archived && (!locked || b.can_moderate);
  for (;;) {
    const order = threaded ? threadOrder(all) : all.map((post) => ({ post, depth: 0 }));
    if (i >= order.length) i = order.length - 1;
    const { post, depth } = order[i]!;
    s.at(`Reading ${b.name}`);
    await page(s, renderPost(s, post, i + 1, order.length, depth));
    // Reading moves the pointer up to what has been seen.
    await s.api.put(`/boards/${b.slug}/read-pointer`, { post_id: post.id }).catch(() => undefined);
    const keys = [i + 1 < order.length ? `${bold('Enter')} next` : '', i > 0 ? `${bold('P')}revious` : '', canReply && post.state === 'ok' ? `${bold('R')}eply` : '', `${bold('T')}${threaded ? ' flat' : 'hreaded'}`, `${bold('Q')}uit`].filter(Boolean);
    t.write(`${keys.join(', ')}: `);
    const k = await t.readKey();
    t.write('\r\x1b[K');
    if (!k || k.name === 'escape') return;
    const c = k.name === 'char' ? k.ch.toLowerCase() : k.name;
    if (c === 'q') return;
    if (c === 'enter' || c === 'n' || c === ' ' || c === 'down') { if (i + 1 < order.length) i++; else return; }
    else if ((c === 'p' || c === 'up') && i > 0) i--;
    else if (c === 't') threaded = !threaded;
    else if (c === 'r' && canReply && post.state === 'ok') {
      const made = await compose(s, b, post);
      if (made) { all.push(made); i = (threaded ? threadOrder(all) : all.map((p) => ({ post: p }))).findIndex((x) => x.post.id === made.id); }
    }
  }
}

// Writes a new thread (replyTo null) or a reply, with the site's preview so the caller sees what a classic
// terminal can't show before it is posted.
async function compose(s: Session, b: BoardSummary, replyTo: PostView | null): Promise<PostView | null> {
  const t = s.term;
  s.at(`Writing in ${b.name}`);
  let subject: string | undefined;
  if (!replyTo) {
    t.write('Subject: ');
    const sub = await t.readLine({ max: 71 });
    if (!sub?.trim()) { t.line('No subject, so nothing was posted.'); return null; }
    subject = sub.trim();
  } else t.line(dim(`Replying to ${replyTo.author?.handle ?? 'a deleted account'}: ${replyTo.subject}`));
  const body = await editMessage(s, { quote: replyTo?.body ? { author: replyTo.author?.handle ?? 'Someone', body: replyTo.body } : undefined });
  if (body === null) return null;
  const preview = await s.api.post<PostPreview>(`/boards/${b.slug}/posts/preview`, { body }).catch(() => null);
  for (const w of preview?.warnings ?? []) t.line(`\x1b[33m${w}\x1b[0m`);
  t.write(`Post it? [Y/n] `);
  if ((await t.choose('yn', 'y')) === 'n') { t.line('Not posted.'); return null; }
  const made = await s.api.post<PostView>(`/boards/${b.slug}/posts`, { subject, body, reply_to: replyTo?.id });
  t.line(bold('Posted.'));
  return made;
}

// The new-message scan: every board with something unread, oldest first, post by post.
export async function newscan(s: Session): Promise<void> {
  const t = s.term;
  s.at('New scan');
  const list = (await listBoards(s)).filter((b) => (b.unread ?? 0) > 0);
  if (!list.length) { t.line('Nothing new. You are all caught up.'); return; }
  for (const b of list) {
    let after: number | undefined;
    for (;;) {
      const r = await s.api.get<{ posts: NewPost[]; next: number | null }>(`/boards/${b.slug}/new?limit=50${after ? `&after=${after}` : ''}`);
      if (!r.posts.length) break;
      t.line(heading(`${b.name}: new messages`, t.cols));
      for (let i = 0; i < r.posts.length; i++) {
        const p = r.posts[i]!;
        s.at(`New scan: ${b.name}`);
        await page(s, [dim(`in "${cut(p.thread_subject, 60)}"`), ...renderPost(s, p, i + 1, r.posts.length)]);
        await s.api.put(`/boards/${b.slug}/read-pointer`, { post_id: p.id }).catch(() => undefined);
        const canReply = b.can_post && !b.archived;
        t.write(`${bold('Enter')} next, ${canReply ? `${bold('R')}eply, ` : ''}${bold('S')}kip this board, ${bold('Q')}uit: `);
        const k = await t.readKey();
        t.write('\r\x1b[K');
        if (!k || k.name === 'escape' || (k.name === 'char' && k.ch.toLowerCase() === 'q')) return;
        if (k.name === 'char' && k.ch.toLowerCase() === 's') { await s.api.put(`/boards/${b.slug}/read-pointer`, { all: true }); break; }
        if (k.name === 'char' && k.ch.toLowerCase() === 'r' && canReply) await compose(s, b, p);
      }
      if (!r.next) break;
      after = r.next;
    }
  }
  t.line('That is everything new.');
}
