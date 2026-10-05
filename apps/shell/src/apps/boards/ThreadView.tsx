import { useConfirm } from '../../components/feedback';
import { Fragment, type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { infiniteQueryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardSummary, PostView, ThreadSummary } from '@app/shared';
import { api } from '../../api';
import { Alert, Avatar, BackLink, Loading, RelativeTime, useCopy } from '../../components/ui';
import { errorText, useMe, useT } from '../../hooks';
import { usePrefs } from '../../devicePrefs';
import { useAppNav, useSubtitle } from '../../nav';
import { Composer } from './Composer';
import { canEditPost, EditedNote, EditPost, ReactionBar } from './PostExtras';
import { useListKeys } from './keys';
import { PostModTools, ReportPost } from './ModTools';
import { CharacterBadge, PersonLink } from '../people/PersonLink';

interface ThreadPage { board: BoardSummary; locked: boolean; posts: PostView[]; next: number | null }

// One thread's pages: shared by the thread screen and the links that prefetch it.
export const threadQuery = (slug: string, id: string, meId: string | null) => infiniteQueryOptions({
  queryKey: ['thread', slug, id, meId],
  queryFn: ({ pageParam }) => api.get<ThreadPage>(`/boards/${slug}/threads/${id}${pageParam ? `?after=${pageParam}` : ''}`),
  initialPageParam: undefined as number | undefined,
  getNextPageParam: (last) => last.next ?? undefined,
  staleTime: 15_000,
});

// Puts replies under what they answer. Anything whose parent is not loaded stands at the top level.
export function threadOrder(posts: PostView[]): { post: PostView; depth: number }[] {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const kids = new Map<string, PostView[]>();
  const top: PostView[] = [];
  for (const p of posts) {
    if (p.reply_to_id && byId.has(p.reply_to_id)) kids.set(p.reply_to_id, [...(kids.get(p.reply_to_id) ?? []), p]);
    else top.push(p);
  }
  const out: { post: PostView; depth: number }[] = [];
  const walk = (p: PostView, depth: number) => {
    out.push({ post: p, depth });
    for (const k of kids.get(p.id) ?? []) walk(k, depth + 1);
  };
  top.forEach((p) => walk(p, 0));
  return out;
}

export function ThreadView({ slug, id }: { slug: string; id: string }) {
  const t = useT();
  const confirm = useConfirm();
  const me = useMe().data;
  const nav = useAppNav();
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const [boardPrefs] = usePrefs('boards');
  const [view, setView] = useState<'flat' | 'threaded'>(boardPrefs.view);
  const [replyTo, setReplyTo] = useState<PostView | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const { copied, copy } = useCopy();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const q = useInfiniteQuery(threadQuery(slug, id, me?.id ?? null));
  const posts = useMemo(() => q.data?.pages.flatMap((p) => p.posts) ?? [], [q.data]);
  const board = q.data?.pages[0]?.board;
  // Replies that arrive while this is open (pushed over the live channel) are counted in a pill, so they aren't missed.
  const shownCount = useRef<number | null>(null);
  const [fresh, setFresh] = useState(0);
  useEffect(() => {
    if (!posts.length) return;
    if (shownCount.current !== null && posts.length > shownCount.current) {
      const added = posts.slice(shownCount.current).filter((p) => p.author?.id !== me?.id).length;
      if (added) setFresh((n) => n + added);
    }
    shownCount.current = posts.length;
  }, [posts, me?.id]);
  const lastSeen = useRef<number | null>(null);
  // "New since your last visit": remember, per thread on this device, how far you had read, and mark where it ends.
  const seenKey = me ? `ui:seen:${me.id}:${id}` : null;
  if (lastSeen.current === null && seenKey && posts.length) {
    let v = 0;
    try { v = Number(localStorage.getItem(seenKey) ?? 0) || 0; } catch { /* a convenience */ }
    lastSeen.current = v;
  }
  useEffect(() => {
    const top = posts.reduce((m, p) => Math.max(m, p.seq), 0);
    if (seenKey && top && document.visibilityState === 'visible') { try { localStorage.setItem(seenKey, String(top)); } catch { /* a convenience */ } }
  }, [posts, seenKey]);
  // A link to one post (#p_…) scrolls to it once it has loaded.
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h.startsWith('p_') && posts.some((p) => p.id === h)) document.getElementById(`post-${h}`)?.scrollIntoView({ block: 'center' });
  }, [posts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = q.data?.pages[0]?.locked ?? false;

  // Reading a thread moves your read pointer up to the last post you have loaded, but only while the tab is in
  // front: a reply that arrives while it is in the background is not read until you come back to it.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const last = posts[posts.length - 1];
    if (!me || !last || sent.current === last.id || q.hasNextPage) return;
    const mark = () => {
      sent.current = last.id;
      api.put(`/boards/${slug}/read-pointer`, { post_id: last.id })
        .then(() => { void qc.invalidateQueries({ queryKey: ['boards'] }); void qc.invalidateQueries({ queryKey: ['board', slug] }); void qc.invalidateQueries({ queryKey: ['threads', slug] }); })
        .catch(() => { sent.current = null; });
    };
    if (document.visibilityState === 'visible') { mark(); return; }
    const onVisible = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', onVisible); mark(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [posts, me, slug, qc, q.hasNextPage]);

  const pin = useMutation({
    mutationFn: (on: boolean) => (on ? api.put(`/boards/${slug}/threads/${id}/pin`, {}) : api.del(`/boards/${slug}/threads/${id}/pin`)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['thread', slug] }); void qc.invalidateQueries({ queryKey: ['threads', slug] }); },
  });
  const del = useMutation({
    mutationFn: (postId: string) => api.del(`/posts/${postId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['thread', slug] }),
  });

  const unreadThreads = useQuery({
    queryKey: ['threads', slug, 'unread-scan', me?.id ?? null],
    queryFn: () => api.get<{ threads: ThreadSummary[] }>(`/boards/${slug}/threads?limit=100`),
    enabled: Boolean(me),
  });
  const goNextUnread = () => {
    const next = unreadThreads.data?.threads.find((x) => x.unread && x.id !== id);
    if (next) nav.go(`${slug}/t/${next.id}`);
  };

  const ordered = useMemo(() => (view === 'flat' ? posts.map((post) => ({ post, depth: 0 })) : threadOrder(posts)), [posts, view]);
  const last = posts[posts.length - 1];
  const target = replyTo ?? last;
  const canReply = Boolean(board?.can_post) && (!locked || Boolean(board?.can_moderate));
  const openReply = (p?: PostView) => { setReplyTo(p ?? target ?? null); setTimeout(() => document.getElementById('compose-body')?.focus(), 0); };
  useListKeys(root, { r: () => canReply && openReply(), n: goNextUnread });

  useSubtitle(posts[0]?.subject);
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  if (!board) return <Loading rows={4} />;
  const subject = posts[0]?.subject || '';

  return (
    <div ref={root}>
      <BackLink to={slug}>{t('boards.back', { name: board.name })}</BackLink>
      <h2 className="thread-title">{subject} {posts[0]?.pinned && <span className="badge sticker">{t('pin.badge')}</span>} {locked && <span className="badge">{t('boards.badge.locked')}</span>}</h2>
      <div className="toolbar" role="group" aria-label={t('boards.view.label')}>
        <button type="button" className={`btn btn-quiet${view === 'flat' ? ' is-active' : ''}`} aria-pressed={view === 'flat'} onClick={() => setView('flat')}>{t('boards.view.flat')}</button>
        <button type="button" className={`btn btn-quiet${view === 'threaded' ? ' is-active' : ''}`} aria-pressed={view === 'threaded'} onClick={() => setView('threaded')}>{t('boards.view.threaded')}</button>
        {board.can_moderate && posts[0] && <button type="button" className="btn btn-quiet" disabled={pin.isPending} onClick={() => pin.mutate(!posts[0]!.pinned)}>{posts[0].pinned ? t('pin.unpin') : t('pin.pin')}</button>}
        {me && <button type="button" className="btn btn-quiet" onClick={goNextUnread} disabled={!unreadThreads.data?.threads.some((x) => x.unread && x.id !== id)}>{t('boards.nextUnread')}</button>}
      </div>
      {fresh > 0 && (
        <p className="new-pill" role="status">
          <button type="button" className="btn btn-primary" onClick={() => { setFresh(0); document.getElementById(`post-${posts[posts.length - 1]!.id}`)?.scrollIntoView({ block: 'center' }); }}>
            {t('post.newReplies', { count: fresh })}
          </button>
        </p>
      )}
      <ol className="posts">
        {ordered.map(({ post, depth }, idx) => {
          const seen = lastSeen.current ?? 0;
          const divider = seen > 0 && idx > 0 && post.seq > seen && ordered[idx - 1]!.post.seq <= seen;
          const editable = canEditPost(post, me?.id, board);
          const parent = post.reply_to_id ? posts.find((p) => p.id === post.reply_to_id) : undefined;
          const name = post.author?.display_name || post.author?.handle;
          return (
            <Fragment key={post.id}>
              {divider && <li className="new-divider"><div role="separator" aria-label={t('post.newSince')}>{t('post.newSince')}</div></li>}
            <li id={`post-${post.id}`} className={depth ? 'post-nested' : undefined} style={depth ? ({ '--depth': depth } as CSSProperties) : undefined}>
              <article className="post" tabIndex={-1} data-nav data-state={post.state} aria-label={name ? t('boards.by', { name }) : undefined}>
                <header className="post-head">
                  <span className="post-who">
                    {post.author ? <PersonLink app="people" to={post.author.handle} className="person"><Avatar id={post.author.id} name={post.author.display_name || post.author.handle} /><strong>{post.author.display_name || post.author.handle}</strong></PersonLink> : null}
                    {post.author?.display_name && <span className="muted">@{post.author.handle}</span>}
                    {post.author?.character && <CharacterBadge character={post.author.character} />}
                  </span>
                  <span className="post-when muted">
                    <span><RelativeTime iso={post.posted_at} /><EditedNote post={post} /></span>
                    {view === 'flat' && parent?.author && <span>{t('boards.inReplyTo', { name: parent.author.display_name || parent.author.handle })}</span>}
                  </span>
                </header>
                {post.state === 'deleted' && <p className="muted">{t('boards.deleted')}</p>}
                {post.state === 'removed' && <p className="muted">{t('boards.removed')}</p>}
                {post.state === 'hidden' && <p className="muted">{t('boards.hidden')}</p>}
                {editing === post.id
                  ? <EditPost post={post} slug={slug} isStart={post.id === id} asMod={editable.asMod} onDone={() => setEditing(null)} />
                  : post.body !== null && <pre className="post-body">{post.body}</pre>}
                {post.state === 'ok' && boardPrefs.reactions && <ReactionBar post={post} slug={slug} signedIn={Boolean(me)} canReact={!board.archived} />}
                <footer className="post-actions">
                  {post.state === 'ok' && <button type="button" className="link" onClick={() => { void copy(`${window.location.origin}${nav.href(`${slug}/t/${id}`)}#${post.id}`); setCopiedId(post.id); }}>{copied && copiedId === post.id ? t('common.copied') : t('post.copyLink')}</button>}
                  {editable.ok && editing !== post.id && <button type="button" className="link" onClick={() => setEditing(post.id)}>{t('edit.edit')}</button>}
                  {canReply && post.state === 'ok' && <button type="button" className="link" onClick={() => openReply(post)}>{t('boards.reply')}</button>}
                  {me && post.author && post.author.id !== me.id && post.state === 'ok' && <ReportPost post={post} />}
                  {me && post.author?.id === me.id && post.state === 'ok' && (
                    <button type="button" className="link" onClick={() => { void confirm({ message: t('boards.deleteConfirm'), confirmLabel: t('confirm.deletePost'), danger: true }).then((ok) => ok && del.mutate(post.id)); }}>{t('boards.delete')}</button>
                  )}
                </footer>
                {board.can_moderate && <PostModTools board={board} post={post} isThreadStart={post.id === id} locked={locked} />}
              </article>
            </li>
            </Fragment>
          );
        })}
      </ol>
      {del.isError && <Alert kind="error">{errorText(del.error)}</Alert>}
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('boards.more')}</button>}
      {canReply && target ? (
        <Composer slug={slug} replyTo={target} onPosted={() => setReplyTo(null)} key={target.id} />
      ) : (
        <p className="muted">{locked && board.can_post ? t('boards.locked') : postNote(t, board, Boolean(me))}</p>
      )}
    </div>
  );
}

export function postNote(t: ReturnType<typeof useT>, board: BoardSummary, signedIn: boolean): string {
  if (board.archived) return t('boards.archivedNote');
  if (!signedIn) return t('boards.loginToPost');
  return board.visibility === 'private' ? t('boards.cannotPost') : t('boards.verifyToPost');
}
