import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardSummary, PostView, ThreadSummary } from '@app/shared';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, formatWhen, useMe, useT } from '../../hooks';
import { AppLink, useAppNav } from '../../nav';
import { Composer } from './Composer';
import { useListKeys } from './keys';
import { PostModTools, ReportPost } from './ModTools';
import { CharacterBadge, PersonLink } from '../people/PersonLink';

interface ThreadPage { board: BoardSummary; locked: boolean; posts: PostView[]; next: number | null }

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
  const me = useMe().data;
  const nav = useAppNav();
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'flat' | 'threaded'>('flat');
  const [replyTo, setReplyTo] = useState<PostView | null>(null);

  const q = useInfiniteQuery({
    queryKey: ['thread', slug, id, me?.id ?? null],
    queryFn: ({ pageParam }) => api.get<ThreadPage>(`/boards/${slug}/threads/${id}${pageParam ? `?after=${pageParam}` : ''}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const posts = useMemo(() => q.data?.pages.flatMap((p) => p.posts) ?? [], [q.data]);
  const board = q.data?.pages[0]?.board;
  const locked = q.data?.pages[0]?.locked ?? false;

  // Reading a thread moves your read pointer up to the last post you have loaded.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const last = posts[posts.length - 1];
    if (!me || !last || sent.current === last.id || q.hasNextPage) return;
    sent.current = last.id;
    api.put(`/boards/${slug}/read-pointer`, { post_id: last.id })
      .then(() => { void qc.invalidateQueries({ queryKey: ['boards'] }); void qc.invalidateQueries({ queryKey: ['board', slug] }); void qc.invalidateQueries({ queryKey: ['threads', slug] }); })
      .catch(() => { sent.current = null; });
  }, [posts, me, slug, qc, q.hasNextPage]);

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

  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  if (!board) return <p className="pad">{t('common.loading')}</p>;
  const subject = posts[0]?.subject || '';

  return (
    <div ref={root}>
      <p><AppLink to={slug}>&#8592; {t('boards.back', { name: board.name })}</AppLink></p>
      <h2>{subject} {locked && <span className="badge">{t('boards.badge.locked')}</span>}</h2>
      <div className="toolbar" role="group" aria-label={t('boards.view.label')}>
        <button type="button" className={`btn btn-quiet${view === 'flat' ? ' is-active' : ''}`} aria-pressed={view === 'flat'} onClick={() => setView('flat')}>{t('boards.view.flat')}</button>
        <button type="button" className={`btn btn-quiet${view === 'threaded' ? ' is-active' : ''}`} aria-pressed={view === 'threaded'} onClick={() => setView('threaded')}>{t('boards.view.threaded')}</button>
        {me && <button type="button" className="btn btn-quiet" onClick={goNextUnread} disabled={!unreadThreads.data?.threads.some((x) => x.unread && x.id !== id)}>{t('boards.nextUnread')}</button>}
      </div>
      <ol className="posts">
        {ordered.map(({ post, depth }) => {
          const parent = post.reply_to_id ? posts.find((p) => p.id === post.reply_to_id) : undefined;
          const name = post.author?.display_name || post.author?.handle;
          return (
            <li key={post.id} style={depth ? { marginLeft: `${Math.min(depth, 6) * 1.25}rem` } : undefined}>
              <article className="post" tabIndex={-1} data-nav data-state={post.state} aria-label={name ? t('boards.by', { name }) : undefined}>
                <header className="post-head">
                  {post.author ? <PersonLink app="people" to={post.author.handle}><strong>{post.author.display_name || post.author.handle}</strong></PersonLink> : null}
                  {post.author?.display_name && <span className="muted"> @{post.author.handle}</span>}
                  {post.author?.character && <> <CharacterBadge character={post.author.character} /></>}
                  <span className="muted"> · <time dateTime={post.posted_at}>{formatWhen(post.posted_at)}</time></span>
                  {view === 'flat' && parent?.author && <span className="muted"> · {t('boards.inReplyTo', { name: parent.author.display_name || parent.author.handle })}</span>}
                </header>
                {post.state === 'deleted' && <p className="muted">{t('boards.deleted')}</p>}
                {post.state === 'removed' && <p className="muted">{t('boards.removed')}</p>}
                {post.state === 'hidden' && <p className="muted">{t('boards.hidden')}</p>}
                {post.body !== null && <pre className="post-body">{post.body}</pre>}
                <footer className="post-actions">
                  {canReply && post.state === 'ok' && <button type="button" className="link" onClick={() => openReply(post)}>{t('boards.reply')}</button>}
                  {me && post.author && post.author.id !== me.id && post.state === 'ok' && <ReportPost post={post} />}
                  {me && post.author?.id === me.id && post.state === 'ok' && (
                    <button type="button" className="link" onClick={() => { if (window.confirm(t('boards.deleteConfirm'))) del.mutate(post.id); }}>{t('boards.delete')}</button>
                  )}
                </footer>
                {board.can_moderate && <PostModTools board={board} post={post} isThreadStart={post.id === id} locked={locked} />}
              </article>
            </li>
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
      <p className="hint">{t('boards.keys')}</p>
    </div>
  );
}

export function postNote(t: ReturnType<typeof useT>, board: BoardSummary, signedIn: boolean): string {
  if (board.archived) return t('boards.archivedNote');
  if (!signedIn) return t('boards.loginToPost');
  return board.visibility === 'private' ? t('boards.cannotPost') : t('boards.verifyToPost');
}
