import { installedApp } from './installed';
import type { AppId, BuiltinAppId } from './windows';

const paths: Record<BuiltinAppId, string> = {
  rings: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  homepages: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 3v9h14V8H5Zm2 2h4v2H7v-2Zm0 3h10v1.5H7V13Z',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20c0-3.3 3.1-6 7-6s7 2.7 7 6H2Zm15.5 0c0-2-.8-3.8-2.2-5.1 3.2.2 5.7 2.4 5.7 5.1h-3.5Z',
  mail: 'M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2.4V17h16V7.4l-8 5.3-8-5.3ZM5.6 7 12 11.2 18.4 7H5.6Z',
  files: 'M4 4h6l2 2h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm8 5v4H9.5l3.5 4 3.5-4H14V9h-2Z',
  terminal: 'M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h16V6H4Zm2.3 2.3L10 12l-3.7 3.7-1.4-1.4L7.2 12 4.9 9.7l1.4-1.4ZM11 15h6v2h-6v-2Z',
  chat: 'M4 4h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm14 4h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1v3l-4-3h-5a1 1 0 0 1-1-1v-1h6a3 3 0 0 0 3-3V8Z',
  mud: 'M12 2 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-4Zm0 4.2 4 2v3.3c0 3-1.8 5.3-4 6.3-2.2-1-4-3.3-4-6.3V8.2l4-2Z',
  studio: 'M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3V11.5Z',
  notifications: 'M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm7-6.2V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7A7 7 0 0 0 5 11v4.8l-2 2v1h18v-1l-2-2Z',
  boards: 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 4v2h10V8H7Zm0 3.5v2h7v-2H7Z',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.2 5.3-1.6-.9c.1-.6.1-1.2 0-1.8l1.6-.9-1.8-3.2-1.7.9a7 7 0 0 0-1.5-.9L15 5h-3.6l-.2 1.9c-.5.2-1 .5-1.5.9l-1.7-.9-1.8 3.2 1.6.9a7 7 0 0 0 0 1.8l-1.6.9 1.8 3.2 1.7-.9c.5.4 1 .7 1.5.9l.2 1.9H15l.2-1.9c.5-.2 1-.5 1.5-.9l1.7.9 1.8-3.2Z',
  admin: 'M12 3 5 6v5.5c0 4.3 2.8 7.6 7 9.5 4.2-1.9 7-5.2 7-9.5V6l-7-3Zm-1 12.2-3.2-3.2 1.4-1.4 1.8 1.8 4.2-4.2 1.4 1.4-5.6 5.6Z',
  // An open book.
  wiki: 'M3 5c3-1.3 6-1.3 8.5.3V20c-2.5-1.6-5.5-1.6-8.5-.3V5Zm18 0v14.7c-3-1.3-6-1.3-8.5.3V5.3C15 3.7 18 3.7 21 5ZM5 7.4v9.3c1.8-.4 3.6-.3 5 .3V8c-1.4-.7-3.2-.9-5-.6Zm9 .6v9c1.4-.6 3.2-.7 5-.3V7.4c-1.8-.3-3.6-.1-5 .6Z',
  addapps: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm11 0h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z',
};
// An added app brings its own icon: one SVG path from its manifest (checked to be only a path).
const pathOf = (id: AppId): string => (id.startsWith('app:') ? installedApp(id)?.icon ?? 'M4 4h16v16H4z' : paths[id as BuiltinAppId]);

// Simple filled icons, drawn in the current text colour so every theme can use them.
export function AppIcon({ id, size = 32 }: { id: AppId; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"><path d={pathOf(id)} fill="currentColor" /></svg>;
}

// Each app has its own sticker colour on the desktop and launcher, so they can be told apart at a glance.
const stickers: Record<BuiltinAppId, 1 | 2 | 3 | 4 | 5> = {
  boards: 1, wiki: 2, rings: 5, people: 4, mail: 3, files: 1, chat: 2, mud: 4, terminal: 1,
  homepages: 3, studio: 5, addapps: 4, notifications: 1, settings: 2, admin: 3,
};
const stickerOf = (id: AppId): number => (id.startsWith('app:') ? installedApp(id)?.sticker ?? 1 : stickers[id as BuiltinAppId]);

export function AppTile({ id }: { id: AppId }) {
  return <span className={`app-tile${id === 'terminal' ? ' is-terminal' : ''}`} data-sticker={stickerOf(id)}><AppIcon id={id} size={26} /></span>;
}
