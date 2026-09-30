import { createHash } from 'node:crypto';
import { strToU8, unzipSync, zipSync } from 'fflate';
import iconv from 'iconv-lite';
import type { AppDeps } from './deps';
import type { Ctx, SessionUser } from './accounts';
import { createPost, listBoards, setReadPointer } from './boards';
import { ApiError } from './errors';

// QWK offline mail (docs/04, M8; PROPOSED format details, VERIFY with a real reader). A .QWK packet is a zip
// with CONTROL.DAT (the site and the conferences), MESSAGES.DAT (128-byte blocks: a header per message,
// then its text with lines ended by 0xE3) and one index per conference. Replies come back as a .REP zip
// with <BBSID>.MSG in the same block format. Text is CP437. Conferences are the person's boards, numbered
// once and kept, so a reply finds its board again. Message numbers are the posts' site-wide sequence.

const BLOCK = 128;
const LINE_END = 0xe3;
export const MAX_PACKET_MESSAGES = 2000;
export const MAX_REP_MESSAGES = 200;
export const MAX_REP_BYTES = 1024 * 1024;

export const bbsId = (shortName: string) => (shortName.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BBS').slice(0, 8);

const cp = (s: string) => iconv.encode(s.replace(/[\u{10000}-\u{10FFFF}]/gu, '?'), 'cp437');
function field(s: string, width: number): Buffer {
  const b = Buffer.alloc(width, 0x20);
  cp(s).copy(b, 0, 0, width);
  return b;
}
const pad2 = (n: number) => String(n).padStart(2, '0');

// Microsoft Binary Format single, used by the .NDX files for block numbers.
export function msbin(n: number): Buffer {
  const out = Buffer.alloc(4);
  if (n <= 0) return out;
  const e = Math.floor(Math.log2(n)) + 1;
  const m = Math.round((n / 2 ** e) * 2 ** 24);
  out[0] = m & 0xff; out[1] = (m >> 8) & 0xff; out[2] = (m >> 16) & 0x7f; out[3] = e + 128;
  return out;
}

export interface QwkMessage { conf: number; number: number; ref: number; date: Date; to: string; from: string; subject: string; body: string; private?: boolean }

// One message as header + text blocks.
export function messageBlocks(m: QwkMessage): Buffer {
  // Long names and subjects don't fit the header; the QWKE convention repeats them at the top of the text.
  const kludges = [m.subject.length > 25 ? `Subject: ${m.subject}` : '', m.from.length > 25 ? `From: ${m.from}` : '', m.to.length > 25 ? `To: ${m.to}` : ''].filter(Boolean);
  const text = [...kludges, ...(kludges.length ? [''] : []), ...m.body.replace(/\r\n?/g, '\n').split('\n')].join('\n');
  const body = Buffer.from(cp(text).map((b) => (b === 0x0a ? LINE_END : b)));
  const textBlocks = Math.ceil((body.length + 1) / BLOCK);
  const padded = Buffer.alloc(textBlocks * BLOCK, 0x20);
  body.copy(padded);
  padded[body.length] = LINE_END;
  const h = Buffer.alloc(BLOCK, 0x20);
  h.write(m.private ? '*' : ' ', 0, 'latin1');
  field(String(m.number), 7).copy(h, 1);
  const d = m.date;
  field(`${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}-${String(d.getUTCFullYear()).slice(2)}`, 8).copy(h, 8);
  field(`${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`, 5).copy(h, 16);
  field(m.to.toUpperCase(), 25).copy(h, 21);
  field(m.from.toUpperCase(), 25).copy(h, 46);
  field(m.subject, 25).copy(h, 71);
  field('', 12).copy(h, 96);
  field(m.ref ? String(m.ref) : '', 8).copy(h, 108);
  field(String(textBlocks + 1), 6).copy(h, 116);
  h[122] = 0xe1; // active
  h.writeUInt16LE(m.conf, 123);
  h.writeUInt16LE(0, 125);
  h[127] = 0x20;
  return Buffer.concat([h, padded]);
}

export interface Conference { conf: number; name: string }

export function buildPacket(opts: { id: string; siteName: string; sysop: string; user: string; now: Date; conferences: Conference[]; messages: QwkMessage[] }): Uint8Array {
  const { id, now } = opts;
  const first = Buffer.alloc(BLOCK, 0x20);
  field('Produced by the site BBS (QWK)', BLOCK).copy(first);
  const parts: Buffer[] = [first];
  const ndx = new Map<number, Buffer[]>();
  let block = 1;
  for (const m of opts.messages) {
    const b = messageBlocks(m);
    (ndx.get(m.conf) ?? ndx.set(m.conf, []).get(m.conf)!).push(Buffer.concat([msbin(block + 1), Buffer.from([m.conf & 0xff])]));
    parts.push(b);
    block += b.length / BLOCK;
  }
  const control = [
    opts.siteName, '', '', opts.sysop, `00000,${id}`,
    `${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}-${now.getUTCFullYear()},${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}:${pad2(now.getUTCSeconds())}`,
    opts.user.toUpperCase(), '', '0', String(opts.messages.length), String(Math.max(0, opts.conferences.length - 1)),
    ...opts.conferences.flatMap((c) => [String(c.conf), c.name.slice(0, 13)]),
    'WELCOME', 'NEWS', 'GOODBYE',
  ].join('\r\n') + '\r\n';
  const files: Record<string, Uint8Array> = { 'CONTROL.DAT': cp(control), 'MESSAGES.DAT': Buffer.concat(parts), 'DOOR.ID': strToU8(`DOOR = ${id}\r\nVERSION = 1.0\r\nSYSTEM = ${id}\r\nCONTROLNAME = ${id}\r\nCONTROLTYPE = ADD\r\nCONTROLTYPE = DROP\r\n`) };
  for (const [conf, rows] of ndx) files[`${String(conf).padStart(3, '0')}.NDX`] = Buffer.concat(rows);
  return zipSync(files, { level: 6 });
}

export interface RepMessage { conf: number; ref: number; to: string; subject: string; body: string }

// Reads a .REP zip: <BBSID>.MSG, whose first block names the site and whose messages carry the conference
// number in the message-number field.
export function parseRep(zip: Uint8Array, id: string): RepMessage[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw new ApiError(400, 'bad_packet', 'That is not a REP packet (it should be a zip file).'); }
  const name = Object.keys(files).find((n) => n.toUpperCase() === `${id}.MSG`);
  if (!name) throw new ApiError(400, 'bad_packet', `The packet has no ${id}.MSG in it. Is it a reply packet for this site?`);
  const data = Buffer.from(files[name]!);
  if (data.length < BLOCK || data.length % BLOCK !== 0) throw new ApiError(400, 'bad_packet', 'The reply file is damaged.');
  const head = iconv.decode(data.subarray(0, BLOCK), 'cp437').trim().toUpperCase();
  if (!head.startsWith(id)) throw new ApiError(400, 'bad_packet', `This reply packet is for ${head.split(/\s/)[0] || 'another site'}, not ${id}.`);
  const out: RepMessage[] = [];
  let at = BLOCK;
  while (at + BLOCK <= data.length) {
    const h = data.subarray(at, at + BLOCK);
    const text = (a: number, b: number) => iconv.decode(h.subarray(a, b), 'cp437').trim();
    const blocks = Number(text(116, 122));
    if (!Number.isInteger(blocks) || blocks < 1 || at + blocks * BLOCK > data.length) throw new ApiError(400, 'bad_packet', 'The reply file is damaged.');
    const conf = Number(text(1, 8)) || h.readUInt16LE(123);
    const raw = data.subarray(at + BLOCK, at + blocks * BLOCK);
    let body = iconv.decode(Buffer.from(raw.map((b) => (b === LINE_END ? 0x0a : b))), 'cp437').replace(/\s+$/, '');
    let subject = text(71, 96);
    let to = text(21, 46);
    // QWKE: long fields repeated at the top of the text.
    const lines = body.split('\n');
    while (lines.length && /^(Subject|To|From): /i.test(lines[0]!)) {
      const [, k, v] = /^(\w+): (.*)$/.exec(lines.shift()!)!;
      if (k!.toLowerCase() === 'subject') subject = v!.trim();
      if (k!.toLowerCase() === 'to') to = v!.trim();
    }
    if (lines[0] === '' && lines.length !== body.split('\n').length) lines.shift();
    body = lines.join('\n');
    out.push({ conf, ref: Number(text(108, 116)) || 0, to, subject, body });
    if (out.length > MAX_REP_MESSAGES) throw new ApiError(413, 'too_many', `A reply packet can hold up to ${MAX_REP_MESSAGES} messages.`);
    at += blocks * BLOCK;
  }
  return out;
}

// ---------------------------------------------------------------- the service

// The boards in a person's packet: the ones they watch, or every board they can read if they watch none.
// Each keeps the conference number it was first given.
async function conferences(deps: AppDeps, v: SessionUser): Promise<{ conf: number; board_id: string; slug: string; name: string }[]> {
  const all = (await listBoards(deps, v)).boards.filter((b) => !b.archived && !b.hidden);
  const watched = all.filter((b) => b.watching);
  const chosen = watched.length ? watched : all;
  await deps.db.tx(async (q) => {
    const have = new Map((await q.query<{ board_id: string; conf: number }>(`SELECT board_id, conf FROM qwk_conferences WHERE user_id = $1`, [v.userId])).rows.map((r) => [r.board_id, r.conf]));
    let next = Math.max(0, ...have.values()) + 1;
    for (const b of chosen) if (!have.has(b.id) && next <= 9999) { await q.query(`INSERT INTO qwk_conferences (user_id, board_id, conf) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [v.userId, b.id, next]); have.set(b.id, next++); }
  });
  const nums = new Map((await deps.db.query<{ board_id: string; conf: number }>(`SELECT board_id, conf FROM qwk_conferences WHERE user_id = $1`, [v.userId])).rows.map((r) => [r.board_id, r.conf]));
  return chosen.filter((b) => nums.has(b.id)).map((b) => ({ conf: nums.get(b.id)!, board_id: b.id, slug: b.slug, name: b.name })).sort((a, b) => a.conf - b.conf);
}

export async function qwkInfo(deps: AppDeps, v: SessionUser) {
  const confs = await conferences(deps, v);
  return { bbs_id: bbsId(deps.config.site.short_name), packet: `${bbsId(deps.config.site.short_name)}.QWK`, reply: `${bbsId(deps.config.site.short_name)}.REP`, conferences: confs.map((c) => ({ conf: c.conf, slug: c.slug, name: c.name })) };
}

// Builds a packet of everything new since the read pointers, and moves the pointers past it (as a BBS
// does when a packet is made).
export async function makePacket(deps: AppDeps, v: SessionUser): Promise<{ name: string; zip: Uint8Array; count: number }> {
  if (v.role === 'guest') throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address to use offline mail.');
  const confs = await conferences(deps, v);
  const id = bbsId(deps.config.site.short_name);
  const messages: QwkMessage[] = [];
  const upTo = new Map<string, string>();
  for (const c of confs) {
    if (messages.length >= MAX_PACKET_MESSAGES) break;
    const r = await deps.db.query<{ id: string; seq: string; subject: string; body: string; posted_at: Date; author: string | null; ref_seq: string | null; ref_author: string | null; thread_subject: string }>(
      `SELECT p.id, p.seq, p.subject, p.body, p.posted_at, u.handle AS author, rp.seq AS ref_seq, ru.handle AS ref_author,
              (SELECT t.subject FROM posts t WHERE t.id = COALESCE(p.thread_root_id, p.id)) AS thread_subject
       FROM posts p LEFT JOIN users u ON u.id = p.author_id LEFT JOIN posts rp ON rp.id = p.reply_to_id LEFT JOIN users ru ON ru.id = rp.author_id
       WHERE p.board_id = $1 AND p.seq > COALESCE((SELECT last_read_seq FROM read_state WHERE user_id = $2 AND board_id = $1), 0)
         AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.author_id IS DISTINCT FROM $2
         AND NOT EXISTS (SELECT 1 FROM posts t WHERE t.id = p.thread_root_id AND t.hidden_at IS NOT NULL)
       ORDER BY p.seq LIMIT $3`, [c.board_id, v.userId, MAX_PACKET_MESSAGES - messages.length]);
    for (const p of r.rows) {
      messages.push({ conf: c.conf, number: Number(p.seq), ref: p.ref_seq ? Number(p.ref_seq) : 0, date: p.posted_at, from: p.author ?? 'deleted account', to: p.ref_author ?? 'ALL', subject: p.subject || p.thread_subject, body: p.body });
    }
    if (r.rows.length) upTo.set(c.slug, r.rows.at(-1)!.id);
  }
  const zip = buildPacket({ id, siteName: deps.config.site.name, sysop: 'Sysop', user: v.handle, now: new Date(deps.now()), conferences: confs.map((c) => ({ conf: c.conf, name: c.name })), messages });
  for (const [slug, postId] of upTo) await setReadPointer(deps, v, slug, { post_id: postId });
  return { name: `${id}.QWK`, zip, count: messages.length };
}

// Takes a REP packet: each message becomes a post through the same path as any post, with the same checks.
export async function takeReplies(deps: AppDeps, v: SessionUser, zip: Buffer, _ctx: Ctx): Promise<{ posted: number; skipped: { subject: string; reason: string }[] }> {
  if (v.role === 'guest') throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address to use offline mail.');
  if (zip.length > MAX_REP_BYTES) throw new ApiError(413, 'too_large', 'That reply packet is too big.');
  const id = bbsId(deps.config.site.short_name);
  const sha = createHash('sha256').update(zip).digest('hex');
  const seen = await deps.db.query(`SELECT 1 FROM qwk_uploads WHERE user_id = $1 AND sha256 = $2`, [v.userId, sha]);
  if (seen.rowCount) throw new ApiError(409, 'already_uploaded', 'You already sent this reply packet, so nothing was posted twice.');
  const msgs = parseRep(new Uint8Array(zip), id);
  const confs = new Map((await deps.db.query<{ conf: number; slug: string; board_id: string }>(
    `SELECT q.conf, b.slug, b.id AS board_id FROM qwk_conferences q JOIN boards b ON b.id = q.board_id WHERE q.user_id = $1`, [v.userId])).rows.map((r) => [r.conf, r]));
  let posted = 0;
  const skipped: { subject: string; reason: string }[] = [];
  for (const m of msgs) {
    const c = confs.get(m.conf);
    if (!c) { skipped.push({ subject: m.subject, reason: `conference ${m.conf} is not one of yours` }); continue; }
    let replyTo: string | undefined;
    if (m.ref) {
      const r = await deps.db.query<{ id: string }>(`SELECT id FROM posts WHERE seq = $1 AND board_id = $2 AND deleted_at IS NULL`, [m.ref, c.board_id]);
      replyTo = r.rows[0]?.id;
    }
    try {
      await createPost(deps, v, c.slug, replyTo ? { body: m.body, reply_to: replyTo } : { subject: m.subject || '(no subject)', body: m.body });
      posted++;
    } catch (e) {
      skipped.push({ subject: m.subject, reason: e instanceof ApiError ? e.message : 'could not be posted' });
    }
  }
  await deps.db.query(`INSERT INTO qwk_uploads (user_id, sha256, posted) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [v.userId, sha, posted]);
  return { posted, skipped };
}
