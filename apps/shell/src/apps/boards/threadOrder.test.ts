import { describe, expect, it } from 'vitest';
import type { PostView } from '@app/shared';
import { threadOrder } from './ThreadView';

const post = (id: string, reply_to_id: string | null): PostView => ({
  id, seq: Number(id.slice(1)), board_id: 'b', thread_id: 'p1', reply_to_id, subject: 's', body: 'x', state: 'ok', author: null, posted_at: '2026-01-01T00:00:00Z', edited_at: null,
});

describe('threadOrder', () => {
  it('puts each reply under the post it answers, in the order they were written', () => {
    const posts = [post('p1', null), post('p2', 'p1'), post('p3', 'p1'), post('p4', 'p2'), post('p5', 'p3')];
    expect(threadOrder(posts).map((x) => `${x.post.id}:${x.depth}`)).toEqual(['p1:0', 'p2:1', 'p4:2', 'p3:1', 'p5:2']);
  });
  it('shows a reply whose parent has not been loaded at the top level', () => {
    expect(threadOrder([post('p9', 'p1')]).map((x) => x.depth)).toEqual([0]);
  });
});
