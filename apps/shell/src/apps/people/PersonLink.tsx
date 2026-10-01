import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CharacterBadge as Badge } from '@app/shared';
import { HoverCard } from '../../components/HoverCard';
import { useMe, useT } from '../../hooks';
import { appById } from '../../shell/apps';
import { OpenAppLink } from '../../shell/OpenAppLink';
import type { AppId } from '../../shell/windows';

// A link into another app that also works for visitors who aren't signed in (they have no desktop to
// open windows on, so it is a plain link to the app's page).
export function PersonLink({ app, to, children, className }: { app: AppId; to: string; children: ReactNode; className?: string }) {
  const me = useMe().data;
  if (me) {
    const link = <OpenAppLink app={app} to={to} className={className}>{children}</OpenAppLink>;
    return app === 'people' && /^[a-z0-9_-]{2,40}$/i.test(to) ? <HoverCard handle={to} meId={me.id}>{link}</HoverCard> : link;
  }
  return <Link to={`${appById(app).path}/${to}`} className={className}>{children}</Link>;
}

// "as Tansy, level 4": the MUD character someone features beside their name (docs/09).
export function CharacterBadge({ character }: { character: Badge | null | undefined }) {
  const t = useT();
  if (!character) return null;
  return <span className="char-badge">{t('people.as', { name: character.name, level: character.level })}</span>;
}
