import type { AppId } from './windows';

const paths: Record<AppId, string> = {
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.2 5.3-1.6-.9c.1-.6.1-1.2 0-1.8l1.6-.9-1.8-3.2-1.7.9a7 7 0 0 0-1.5-.9L15 5h-3.6l-.2 1.9c-.5.2-1 .5-1.5.9l-1.7-.9-1.8 3.2 1.6.9a7 7 0 0 0 0 1.8l-1.6.9 1.8 3.2 1.7-.9c.5.4 1 .7 1.5.9l.2 1.9H15l.2-1.9c.5-.2 1-.5 1.5-.9l1.7.9 1.8-3.2Z',
  admin: 'M12 3 5 6v5.5c0 4.3 2.8 7.6 7 9.5 4.2-1.9 7-5.2 7-9.5V6l-7-3Zm-1 12.2-3.2-3.2 1.4-1.4 1.8 1.8 4.2-4.2 1.4 1.4-5.6 5.6Z',
};

// Simple filled icons, drawn in the current text colour so every theme can use them.
export function AppIcon({ id }: { id: AppId }) {
  return <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" focusable="false"><path d={paths[id]} fill="currentColor" /></svg>;
}
