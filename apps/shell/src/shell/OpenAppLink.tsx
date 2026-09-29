import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsDesktop } from '../hooks';
import { appById } from './apps';
import { useWindows, type AppId } from './windows';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { app: AppId; to: string };

// A link from one app to a place in another. It has a real address, so it opens in a new tab like
// any link; a plain click opens the other app's window at that place on the desktop, or its page
// on a phone.
export function OpenAppLink({ app, to, onClick, ...rest }: Props) {
  const desktop = useIsDesktop();
  const open = useWindows((s) => s.open);
  const navigate = useNavigate();
  const href = `${appById(app).path}/${to}`;
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (desktop) { open(app, to); navigate('/'); } else navigate(href);
  };
  return <a {...rest} href={href} onClick={click} />;
}
