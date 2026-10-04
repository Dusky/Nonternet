import { createCollection } from '@tanstack/react-db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import type { BoardSummary, MailMessageView, MailThreadView } from '@app/shared';
import { api } from './api';
import { queryClient } from './queryClient';

// Client-side data with TanStack DB (docs/17 P13, a pilot on Boards and Mail). A collection holds rows the screen
// reads with useLiveQuery; a change made through it shows at once and is saved behind it by the handler below. If
// the server refuses, the change is rolled back by itself and the caller is told. Each collection uses the same
// Query key the rest of the app already uses, so an invalidation anywhere (a live event, another screen) refreshes it.

// The board list, with the person's own watching and unread state.
const boards = new Map<string, ReturnType<typeof makeBoards>>();
function makeBoards(meId: string) {
  return createCollection(queryCollectionOptions({
    id: `boards:${meId}`,
    queryKey: ['boards', meId],
    // The same response, under the same key, as the board list and the palette read with useQuery.
    queryFn: () => api.get<{ boards: BoardSummary[] }>('/boards'),
    select: (d: { boards: BoardSummary[] }) => d.boards,
    queryClient,
    getKey: (b: BoardSummary) => b.slug,
    // Watching and "mark all read" are the two changes made from the list or a board's page.
    onUpdate: async ({ transaction }) => {
      for (const m of transaction.mutations) {
        const slug = m.original.slug;
        if ('watching' in m.changes) await (m.changes.watching ? api.put(`/boards/${slug}/watch`, {}) : api.del(`/boards/${slug}/watch`));
        if ('unread' in m.changes && m.changes.unread === 0) await api.put(`/boards/${slug}/read-pointer`, { all: true });
        void queryClient.invalidateQueries({ queryKey: ['board', slug] });
        void queryClient.invalidateQueries({ queryKey: ['threads', slug] });
      }
    },
  }));
}
export function boardsCollection(meId: string) {
  let c = boards.get(meId);
  if (!c) { c = makeBoards(meId); boards.set(meId, c); }
  return c;
}

// One mail conversation's messages. Sending inserts a pending message (its id starts with "pending-") that the
// server's copy replaces; deleting marks it deleted at once.
const conversations = new Map<string, ReturnType<typeof makeConversation>>();
function makeConversation(threadId: string) {
  return createCollection(queryCollectionOptions({
    id: `mail:${threadId}`,
    queryKey: ['mail', 'thread', threadId],
    queryFn: () => api.get<MailThreadView>(`/mail/${threadId}`),
    select: (d: MailThreadView) => d.messages,
    queryClient,
    getKey: (m: MailMessageView) => m.id,
    onInsert: async ({ transaction }) => {
      for (const m of transaction.mutations) await api.post(`/mail/${threadId}/messages`, { body: m.modified.body });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'list'] });
    },
    onUpdate: async ({ transaction }) => {
      for (const m of transaction.mutations) if (m.changes.deleted) await api.del(`/mail/${threadId}/messages/${m.original.id}`);
    },
  }));
}
export function conversationCollection(threadId: string) {
  let c = conversations.get(threadId);
  if (!c) { c = makeConversation(threadId); conversations.set(threadId, c); }
  return c;
}
export const isPending = (id: string) => id.startsWith('pending-');
export const pendingId = () => `pending-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
