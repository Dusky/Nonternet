import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable } from '../test/harness';
import { EXEMPT, EXPORTERS } from './exporters';
import { formatMbox } from './mbox';

describe('mbox', () => {
  const post = (over: Partial<Parameters<typeof formatMbox>[0][0]> = {}) => ({ id: 'p_1', board: 'general', thread_id: 'p_1', reply_to: null, subject: 'Hello', body: 'text', posted_at: '2026-01-02T03:04:05Z', ...over });
  it('writes headers a mail or news reader understands', () => {
    const out = formatMbox([post({ id: 'p_2', thread_id: 'p_1', reply_to: 'p_1', subject: 'Re: Hello' })], { handle: 'zerocool', domain: 'example.test' });
    expect(out).toMatch(/^From zerocool@example\.test /);
    expect(out).toContain('From: zerocool <zerocool@example.test>');
    expect(out).toContain('Newsgroups: general');
    expect(out).toContain('Date: Fri, 02 Jan 2026 03:04:05 +0000');
    expect(out).toContain('Message-ID: <p_2@example.test>');
    expect(out).toContain('In-Reply-To: <p_1@example.test>');
  });
  it('quotes lines that would look like the start of another message (mboxrd)', () => {
    const out = formatMbox([post({ body: 'From me to you\n>From already quoted\nnot From here' })], { handle: 'a', domain: 'x.test' });
    expect(out).toContain('\n>From me to you\n>>From already quoted\nnot From here\n');
  });
  it('encodes a non-ASCII subject and keeps line breaks out of headers', () => {
    const out = formatMbox([post({ subject: 'café\r\nBcc: evil@x.test' })], { handle: 'a', domain: 'x.test' });
    expect(out).toContain('Subject: =?UTF-8?B?');
    expect(out).not.toMatch(/^Bcc:/m);
  });
  it('separates messages with a blank line', () => {
    const out = formatMbox([post({ id: 'p_1' }), post({ id: 'p_2' })], { handle: 'a', domain: 'x.test' });
    expect(out.split(/^From a@x\.test /m)).toHaveLength(3);
  });
});

// The rule from docs/12: a new kind of content cannot be added without deciding how it is exported.
describe.skipIf(!dbAvailable)('every table is exported or has a reason not to be', () => {
  let drop: () => Promise<void>;
  let tables: string[];
  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    tables = (await t.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map((r) => r.table_name);
  });
  afterAll(async () => drop());

  const exported = () => EXPORTERS.flatMap((e) => e.tables);

  it('has no table that is neither exported nor exempt', () => {
    const known = new Set([...exported(), ...Object.keys(EXEMPT)]);
    const missing = tables.filter((t) => !known.has(t));
    expect(missing, `These tables need an exporter in exports/exporters.ts, or an entry in EXEMPT saying why they are not someone's content: ${missing.join(', ')}`).toEqual([]);
  });
  it('does not list a table twice, or one that does not exist', () => {
    const all = [...exported(), ...Object.keys(EXEMPT)];
    expect(all.filter((t, i) => all.indexOf(t) !== i)).toEqual([]);
    expect(all.filter((t) => !tables.includes(t))).toEqual([]);
  });
  it('gives a reason for every exemption', () => {
    for (const [table, why] of Object.entries(EXEMPT)) expect(why.length, table).toBeGreaterThan(10);
  });
});
