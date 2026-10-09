import { badgeText, useAppBadge } from '../shell/appBadges';
import type { AppId } from '../shell/windows';
import { useT } from '../hooks';

// The little number on an app's icon. The number itself is hidden from screen readers; the button or link it sits on
// says "3 unread" through appLabel() instead.
export function AppBadge({ id }: { id: AppId }) {
  const b = useAppBadge(id);
  if (!b) return null;
  return <span className={`app-badge${b.strong ? ' is-strong' : ''}`} aria-hidden="true" data-badge={id}>{badgeText(b.count)}</span>;
}

// "Boards, 3 unread" for the accessible name of an icon.
export function useAppLabel(id: AppId, base: string): string {
  const t = useT();
  const b = useAppBadge(id);
  return b ? t('app.badge', { app: base, count: b.count }) : base;
}
