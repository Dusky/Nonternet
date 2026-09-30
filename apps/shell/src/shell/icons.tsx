import type { AppId } from './windows';

const paths: Record<AppId, string> = {
  homepages: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 3v9h14V8H5Zm2 2h4v2H7v-2Zm0 3h10v1.5H7V13Z',
  studio: 'M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3V11.5Z',
  notifications: 'M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm7-6.2V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7A7 7 0 0 0 5 11v4.8l-2 2v1h18v-1l-2-2Z',
  boards: 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 4v2h10V8H7Zm0 3.5v2h7v-2H7Z',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.2 5.3-1.6-.9c.1-.6.1-1.2 0-1.8l1.6-.9-1.8-3.2-1.7.9a7 7 0 0 0-1.5-.9L15 5h-3.6l-.2 1.9c-.5.2-1 .5-1.5.9l-1.7-.9-1.8 3.2 1.6.9a7 7 0 0 0 0 1.8l-1.6.9 1.8 3.2 1.7-.9c.5.4 1 .7 1.5.9l.2 1.9H15l.2-1.9c.5-.2 1-.5 1.5-.9l1.7.9 1.8-3.2Z',
  admin: 'M12 3 5 6v5.5c0 4.3 2.8 7.6 7 9.5 4.2-1.9 7-5.2 7-9.5V6l-7-3Zm-1 12.2-3.2-3.2 1.4-1.4 1.8 1.8 4.2-4.2 1.4 1.4-5.6 5.6Z',
};

// Simple filled icons, drawn in the current text colour so every theme can use them.
export function AppIcon({ id, size = 32 }: { id: AppId; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"><path d={paths[id]} fill="currentColor" /></svg>;
}
