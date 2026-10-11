import { useQuery } from '@tanstack/react-query';
import type { MemoView } from '@app/shared';
import { api } from '../../api';
import { RelativeTime } from '../../components/ui';
import { RichText } from '../../components/RichText';
import { FeedLink } from '../../components/FeedLink';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { PersonLink } from '../people/PersonLink';
import { useT } from '../../hooks';
import { MemoReactions } from './MemoReactions';
import { MemoTools } from './MemoTools';

// Memos other people can see (docs/22): a person's public ones on their profile, or what a ring's members shared on its page.
export function SharedMemos({ source, title, headingId, feed }: { source: { handle: string } | { ring: string }; title: string; headingId: string; feed?: { href: string; title: string } }) {
  const t = useT();
  const path = 'handle' in source ? `/memos/public/${encodeURIComponent(source.handle)}` : `/rings/${encodeURIComponent(source.ring)}/memos`;
  const q = useQuery({ queryKey: ['memos', 'shared', path], queryFn: () => api.get<{ memos: MemoView[]; next: string | null }>(path) });
  const items = q.data?.memos ?? [];
  if (!items.length) return null;
  return (
    <section aria-labelledby={headingId} className="panel">
      <div className="panel-head">
        <h3 id={headingId}>{title}</h3>
        {feed && <FeedLink href={feed.href} title={feed.title} />}
      </div>
      <ul className="rows shared-memos">
        {items.map((m) => (
          <li key={m.id} className="memo">
            <RichText body={m.body} className="memo-body" />
            <p className="row-meta memo-meta">
              {'ring' in source && <><PersonLink app="people" to={m.owner.handle}>{m.owner.display_name || m.owner.handle}</PersonLink> · </>}
              <RelativeTime iso={m.created_at} />{m.edited_at && <> · {t('memos.edited')}</>}
              {' · '}<OpenAppLink app="memos" to={`m/${m.id}`}>{m.reply_count > 0 ? t('memos.replies', { count: m.reply_count }) : t('memos.openThread')}</OpenAppLink>
            </p>
            <MemoReactions memo={m} canReact={false} />
            <MemoTools memo={m} />
          </li>
        ))}
      </ul>
    </section>
  );
}
