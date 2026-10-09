import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

// Notifications beyond board posts (docs/23, E2): mail, reactions and ring news.
describe.skipIf(!dbAvailable)('site-wide notifications', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type C = ReturnType<typeof client>;
  const people: Record<string, { id: string; handle: string; c: C }> = {};
  const p = (n: string) => people[n]!;
  type N = { id: string; kind: string; read: boolean; count: number; subject: string; place: string; link: { app: string; to: string }; actor: { handle: string } };
  const list = async (who: string) => (await p(who).c.get('/api/v1/notifications')).body as { notifications: N[]; unread: number };
  const unread = async (who: string) => (await list(who)).notifications.filter((n) => !n.read);

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    ctx.deps.config.limits.trusted_board_quota = 50;
    ctx.deps.config.limits.trusted_ring_quota = 5;
    for (const [name, role] of [['owner', 'trusted'], ['alice', 'user'], ['bob', 'user'], ['carol', 'user']] as const) {
      const u = await makeUser(ctx, { role, handle: name });
      people[name] = { id: u.id, handle: u.handle, c: await loginAs(ctx, u.handle) };
    }
    await p('owner').c.post('/api/v1/boards', { slug: 'lounge', name: 'Lounge', visibility: 'public' });
  });
  afterAll(async () => drop());

  describe('mail', () => {
    it('tells people in a conversation about new mail, once per conversation with a count, and clears when they read it', async () => {
      const t = (await p('alice').c.post('/api/v1/mail', { to: ['bob'], subject: 'Plans', body: 'hello' })).body as { id: string };
      expect(await unread('alice')).toHaveLength(0); // nobody tells the sender
      expect((await unread('bob'))[0]).toMatchObject({ kind: 'mail', count: 1, subject: 'Plans', link: { app: 'mail', to: t.id }, actor: { handle: 'alice' } });
      await p('alice').c.post(`/api/v1/mail/${t.id}/messages`, { body: 'again' });
      await p('alice').c.post(`/api/v1/mail/${t.id}/messages`, { body: 'and again' });
      const n = await unread('bob');
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ kind: 'mail', count: 3 });
      expect((await p('bob').c.get('/api/v1/notifications/count')).body.unread).toBe(1);
      await p('bob').c.get(`/api/v1/mail/${t.id}`); // opening it answers it
      expect(await unread('bob')).toHaveLength(0);
      expect((await p('bob').c.get('/api/v1/notifications/count')).body.unread).toBe(0);
      await p('alice').c.post(`/api/v1/mail/${t.id}/messages`, { body: 'a new one after reading' });
      expect((await unread('bob'))[0]).toMatchObject({ count: 1 }); // a fresh line, not the old one
    });

    it('stays quiet for a muted conversation, a switched-off kind, and a conversation you left', async () => {
      const t = (await p('alice').c.post('/api/v1/mail', { to: ['carol'], subject: 'Muted', body: 'x' })).body as { id: string };
      await p('carol').c.post('/api/v1/notifications/read', { all: true });
      await p('carol').c.put(`/api/v1/mail/${t.id}/mute`);
      await p('alice').c.post(`/api/v1/mail/${t.id}/messages`, { body: 'shh' });
      expect(await unread('carol')).toHaveLength(0);
      await p('carol').c.delete(`/api/v1/mail/${t.id}/mute`);
      await p('carol').c.put('/api/v1/me/notification-prefs', { kind: 'mail', enabled: false });
      await p('alice').c.post(`/api/v1/mail/${t.id}/messages`, { body: 'off' });
      expect(await unread('carol')).toHaveLength(0);
      await p('carol').c.put('/api/v1/me/notification-prefs', { kind: 'mail', enabled: true });
      await p('alice').c.post(`/api/v1/mail/${t.id}/messages`, { body: 'on' });
      expect(await unread('carol')).toHaveLength(1);
      await p('carol').c.post(`/api/v1/mail/${t.id}/leave`);
      expect((await list('carol')).notifications.filter((n) => n.kind === 'mail')).toHaveLength(0); // gone with the conversation
    });
  });

  describe('reactions', () => {
    const thread = async (who: string, body = 'react to me') => (await p(who).c.post('/api/v1/boards/lounge/posts', { subject: 'Topic', body })).body as { id: string };

    it('tells the author, groups several into one line, and not for their own reaction', async () => {
      const t = await thread('alice');
      await p('alice').c.put(`/api/v1/posts/${t.id}/reactions/agree`);
      expect((await unread('alice')).filter((n) => n.kind === 'reaction')).toHaveLength(0);
      expect((await p('bob').c.put(`/api/v1/posts/${t.id}/reactions/agree`)).status).toBeLessThan(300);
      expect((await p('carol').c.put(`/api/v1/posts/${t.id}/reactions/love`)).status).toBeLessThan(300);
      const n = (await unread('alice')).filter((x) => x.kind === 'reaction');
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ count: 2, actor: { handle: 'carol' }, place: 'Lounge', link: { app: 'boards', to: `lounge/t/${t.id}` } });
    });

    it('does not tell twice for taking one back and adding it again, and respects the switch and a muted board', async () => {
      const t = await thread('alice');
      await p('alice').c.post('/api/v1/notifications/read', { all: true });
      await p('bob').c.put(`/api/v1/posts/${t.id}/reactions/love`);
      await p('bob').c.delete(`/api/v1/posts/${t.id}/reactions/love`);
      await p('bob').c.put(`/api/v1/posts/${t.id}/reactions/love`);
      expect((await unread('alice'))[0]!.count).toBe(2); // the second add counts; it is a new reaction after it was taken back
      await p('alice').c.post('/api/v1/notifications/read', { all: true });
      await p('alice').c.put('/api/v1/me/notification-prefs', { kind: 'reaction', enabled: false });
      await p('carol').c.put(`/api/v1/posts/${t.id}/reactions/love`);
      expect(await unread('alice')).toHaveLength(0);
      await p('alice').c.put('/api/v1/me/notification-prefs', { kind: 'reaction', enabled: true });
      await p('alice').c.put('/api/v1/boards/lounge/mute');
      await p('carol').c.delete(`/api/v1/posts/${t.id}/reactions/love`);
      await p('carol').c.put(`/api/v1/posts/${t.id}/reactions/agree`);
      expect(await unread('alice')).toHaveLength(0);
      await p('alice').c.delete('/api/v1/boards/lounge/mute');
    });

    it('drops it when the post is gone', async () => {
      const t = await thread('alice', 'short lived');
      await p('alice').c.post('/api/v1/notifications/read', { all: true });
      await p('bob').c.put(`/api/v1/posts/${t.id}/reactions/love`);
      expect(await unread('alice')).toHaveLength(1);
      await p('alice').c.delete(`/api/v1/posts/${t.id}`);
      expect(await unread('alice')).toHaveLength(0);
    });
  });

  describe('rings', () => {
    it('tells the ops about a request, tells the person when they are let in, and clears as it is dealt with', async () => {
      await p('owner').c.post('/api/v1/rings', { slug: 'knots', name: 'Knots', join_policy: 'approval' });
      await p('owner').c.post('/api/v1/notifications/read', { all: true });
      expect((await p('alice').c.post('/api/v1/rings/knots/join')).body.status).toBe('pending');
      const ask = (await unread('owner')).filter((n) => n.kind === 'ring_request');
      expect(ask).toHaveLength(1);
      expect(ask[0]).toMatchObject({ actor: { handle: 'alice' }, subject: 'Knots', link: { app: 'rings', to: 'knots' } });
      await p('bob').c.post('/api/v1/rings/knots/join');
      expect((await unread('owner')).filter((n) => n.kind === 'ring_request')[0]!.count).toBe(2);
      await p('alice').c.post('/api/v1/notifications/read', { all: true });
      const aliceId = p('alice').id;
      expect((await p('owner').c.post(`/api/v1/rings/knots/members/${aliceId}/approve`)).status).toBeLessThan(300);
      expect((await unread('alice')).filter((n) => n.kind === 'ring_joined')).toHaveLength(1);
    });

    it('tells someone they are invited, and the invitation goes away when they accept', async () => {
      await p('owner').c.post('/api/v1/rings/knots/invites', { handle: 'carol' });
      const inv = (await unread('carol')).filter((n) => n.kind === 'ring_invite');
      expect(inv).toHaveLength(1);
      expect(inv[0]).toMatchObject({ subject: 'Knots', actor: { handle: 'owner' } });
      await p('carol').c.post('/api/v1/rings/knots/join');
      expect((await unread('carol')).filter((n) => n.kind === 'ring_invite')).toHaveLength(0);
    });

    it('is switched off with the ring choice', async () => {
      await p('owner').c.post('/api/v1/rings', { slug: 'quiet', name: 'Quiet', join_policy: 'approval' });
      await p('owner').c.post('/api/v1/notifications/read', { all: true });
      await p('owner').c.put('/api/v1/me/notification-prefs', { kind: 'ring', enabled: false });
      await p('bob').c.post('/api/v1/rings/quiet/join');
      expect(await unread('owner')).toHaveLength(0);
      await p('owner').c.put('/api/v1/me/notification-prefs', { kind: 'ring', enabled: true });
    });
  });

  it('shows and saves the new choices', async () => {
    const s = (await p('bob').c.get('/api/v1/me/personal')).body.prefs;
    expect(Object.keys(s).sort()).toEqual(['mail', 'mention', 'reaction', 'reply', 'ring', 'watch']);
    expect((await p('bob').c.put('/api/v1/me/notification-prefs', { kind: 'nonsense', enabled: false })).status).toBe(400);
  });
});
