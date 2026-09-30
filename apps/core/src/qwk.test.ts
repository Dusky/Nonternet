import { unzipSync, zipSync } from 'fflate';
import iconv from 'iconv-lite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';
import { bbsId, messageBlocks, msbin, parseRep } from './qwk';

// A REP file the way offline readers write it: a first block with the BBS id, then messages whose
// message-number field holds the conference number.
function rep(id: string, msgs: { conf: number; ref?: number; subject: string; body: string; to?: string }[]): Uint8Array {
  const first = Buffer.alloc(128, 0x20);
  first.write(id, 0, 'latin1');
  const parts = [first, ...msgs.map((m) => {
    const b = messageBlocks({ conf: m.conf, number: m.conf, ref: m.ref ?? 0, date: new Date('2026-09-30T12:00:00Z'), to: m.to ?? 'ALL', from: 'ME', subject: m.subject, body: m.body });
    return b;
  })];
  return zipSync({ [`${id}.MSG`]: Buffer.concat(parts) });
}

describe('the QWK format', () => {
  it('writes block numbers as Microsoft Binary Format floats', () => {
    expect([...msbin(1)]).toEqual([0, 0, 0, 0x81]);
    expect([...msbin(2)]).toEqual([0, 0, 0, 0x82]);
    expect([...msbin(3)]).toEqual([0, 0, 0x40, 0x82]);
    expect([...msbin(0)]).toEqual([0, 0, 0, 0]);
  });

  it('lays out a message header and CP437 text in 128-byte blocks', () => {
    const b = messageBlocks({ conf: 7, number: 1234, ref: 99, date: new Date('2026-09-30T21:05:00Z'), to: 'all', from: 'zerocool', subject: 'Café hours', body: 'Open at nine.\nClosed Mondays.' });
    expect(b.length % 128).toBe(0);
    const h = (a: number, z: number) => iconv.decode(b.subarray(a, z), 'cp437');
    expect(h(1, 8).trim()).toBe('1234');
    expect(h(8, 16)).toBe('09-30-26');
    expect(h(16, 21)).toBe('21:05');
    expect(h(21, 46).trim()).toBe('ALL');
    expect(h(46, 71).trim()).toBe('ZEROCOOL');
    expect(h(71, 96).trim()).toBe('Café hours');
    expect(h(108, 116).trim()).toBe('99');
    expect(Number(h(116, 122))).toBe(b.length / 128);
    expect(b[122]).toBe(0xe1);
    expect(b.readUInt16LE(123)).toBe(7);
    expect(b.subarray(128).indexOf(0xe3)).toBe('Open at nine.'.length);
    expect(b[71 + 3]).toBe(0x82); // the é of Café, in CP437
  });

  it('keeps subjects longer than the header in QWKE lines, and reads them back', () => {
    const long = 'A subject that is much longer than twenty-five characters';
    const msgs = parseRep(rep('TESTSITE', [{ conf: 2, subject: long, body: 'Hello there.' }]), 'TESTSITE');
    expect(msgs).toEqual([{ conf: 2, ref: 0, to: 'ALL', subject: long, body: 'Hello there.' }]);
  });

  it('refuses reply packets for another site or broken ones', () => {
    expect(() => parseRep(rep('OTHER', [{ conf: 1, subject: 'x', body: 'y' }]), 'TESTSITE')).toThrow(/no TESTSITE.MSG/);
    expect(() => parseRep(new Uint8Array([1, 2, 3]), 'TESTSITE')).toThrow(/zip/);
    expect(() => parseRep(zipSync({ 'TESTSITE.MSG': new Uint8Array(100) }), 'TESTSITE')).toThrow(/damaged/);
  });

  it('makes an 8-character id from the short name', () => {
    expect(bbsId('testsite')).toBe('TESTSITE');
    expect(bbsId('my-great-place!')).toBe('MYGREATP');
  });
});

describe.skipIf(!dbAvailable)('QWK offline mail', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  it('packs new posts from your boards, moves your read pointers, and posts your replies once', async () => {
    const owner = await makeUser(ctx, { role: 'trusted' });
    const oc = await loginAs(ctx, owner.handle);
    await oc.post('/api/v1/boards', { slug: 'lounge', name: 'Lounge', visibility: 'public' });
    await oc.post('/api/v1/boards', { slug: 'quiet', name: 'Quiet', visibility: 'public' });
    const th = (await oc.post('/api/v1/boards/lounge/posts', { subject: 'Offline readers', body: 'Who still uses one?\nI do.' })).body;
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await c.put('/api/v1/boards/lounge/watch', { watching: true });
    const info = (await c.get('/api/v1/me/qwk')).body;
    expect(info).toMatchObject({ bbs_id: 'TESTSITE', packet: 'TESTSITE.QWK', conferences: [{ conf: 1, slug: 'lounge', name: 'Lounge' }] });

    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/me/qwk/packet', headers: { origin: 'https://example.test', cookie: `sid=${c.sid}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="TESTSITE.QWK"');
    expect(res.headers['x-message-count']).toBe('1');
    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files).sort()).toEqual(['001.NDX', 'CONTROL.DAT', 'DOOR.ID', 'MESSAGES.DAT']);
    const control = iconv.decode(Buffer.from(files['CONTROL.DAT']!), 'cp437').split('\r\n');
    expect(control[4]).toBe('00000,TESTSITE');
    expect(control[6]).toBe(u.handle.toUpperCase());
    expect(control.slice(9, 13)).toEqual(['1', '0', '1', 'Lounge']);
    const msgs = Buffer.from(files['MESSAGES.DAT']!);
    expect(iconv.decode(msgs.subarray(128 + 71, 128 + 96), 'cp437').trim()).toBe('Offline readers');
    expect(iconv.decode(msgs.subarray(256), 'cp437')).toContain('Who still uses one?πI do.'); // 0xE3 is π in CP437
    expect(files['001.NDX']!.length).toBe(5);
    // Making the packet moved the pointer, so the web shows nothing unread there.
    expect((await c.get('/api/v1/boards')).body.boards.find((b: { slug: string }) => b.slug === 'lounge').unread).toBe(0);

    // Replies come back: one to the thread, one new thread, one to a conference that isn't theirs.
    const seq = (await oc.get(`/api/v1/boards/lounge/threads/${th.id}`)).body.posts[0].seq;
    const packet = rep('TESTSITE', [
      { conf: 1, ref: seq, subject: 'Re: Offline readers', body: 'Me too, with a CP437 café.' },
      { conf: 1, subject: 'Packets are back', body: 'A brand new thread.' },
      { conf: 42, subject: 'Lost', body: 'Nowhere to go.' },
    ]);
    const send = () => ctx.app.inject({ method: 'POST', url: '/api/v1/me/qwk/reply', payload: Buffer.from(packet), headers: { origin: 'https://example.test', cookie: `sid=${c.sid}`, 'content-type': 'application/octet-stream' } });
    const r = await send();
    expect(r.json()).toEqual({ posted: 2, skipped: [{ subject: 'Lost', reason: 'conference 42 is not one of yours' }] });
    const thread = (await oc.get(`/api/v1/boards/lounge/threads/${th.id}`)).body.posts;
    expect(thread[1]).toMatchObject({ reply_to_id: th.id, author: { handle: u.handle }, body: 'Me too, with a CP437 café.' });
    const threads = (await oc.get('/api/v1/boards/lounge/threads')).body.threads;
    expect(threads.map((t: { subject: string }) => t.subject)).toContain('Packets are back');
    expect((await send()).json().error.code).toBe('already_uploaded');
  });
});
