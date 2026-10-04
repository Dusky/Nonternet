import { connect, WindowMessenger, type RemoteProxy } from 'penpal';

// The app side of the bridge (docs/10, docs/15). An app runs in a sandboxed frame with an opaque origin: it has
// no cookies, no storage and no network of its own. Everything it needs goes through these calls to the shell,
// which checks each one against what the app's manifest asked for.
//
// Keep this small and stable: outside authors will build on it later.

export interface Doc<T = unknown> { id: string; data: T; updated_at: string }
export interface Profile { id: string; handle: string; display_name: string | null }
export type ThemeVars = Record<string, string>;

// What the shell offers. The names are flat so the protocol stays plain.
export type HostMethods = {
  storageList(collection: string): Promise<Doc[]>;
  storagePut(collection: string, id: string, data: unknown): Promise<Doc>;
  storageDelete(collection: string, id: string): Promise<void>;
  profileGet(): Promise<Profile>;
  uiSetTitle(title: string): Promise<void>;
  // Resolves true if the person pressed Undo before the note went away.
  uiToast(text: string, options?: { undo?: boolean; error?: boolean }): Promise<boolean>;
};
// What the app offers the shell.
export type AppMethods = {
  setTheme(vars: ThemeVars, scheme: 'light' | 'dark'): void;
};

export interface Host {
  storage: {
    list<T = unknown>(collection: string): Promise<Doc<T>[]>;
    put<T = unknown>(collection: string, id: string, data: T): Promise<Doc<T>>;
    delete(collection: string, id: string): Promise<void>;
  };
  profile(): Promise<Profile>;
  setTitle(title: string): Promise<void>;
  toast(text: string, options?: { undo?: boolean; error?: boolean }): Promise<boolean>;
}

// The theme arrives as CSS custom properties (--bg, --text, --accent, …) set on the root, so an app styled with
// var(--bg) and friends matches whichever of the site's themes the person uses, and follows a change at once.
export function applyTheme(vars: ThemeVars, scheme: 'light' | 'dark', root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(vars)) if (k.startsWith('--')) root.style.setProperty(k, v);
  root.style.colorScheme = scheme;
}

// The shell's origin comes in the address (#host=…); the frame can only be shown by the site anyway
// (frame-ancestors), so this is a second lock rather than the only one.
function hostOrigin(): string {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('host');
  return fromHash && /^https?:\/\/[^/]+$/.test(fromHash) ? fromHash : '*';
}

export async function connectToHost(opts: { onTheme?: (vars: ThemeVars, scheme: 'light' | 'dark') => void; timeout?: number } = {}): Promise<Host> {
  const methods: AppMethods = {
    setTheme(vars, scheme) { applyTheme(vars, scheme); opts.onTheme?.(vars, scheme); },
  };
  const conn = connect<HostMethods>({
    messenger: new WindowMessenger({ remoteWindow: window.parent, allowedOrigins: [hostOrigin()] }),
    methods,
    timeout: opts.timeout ?? 10_000,
  });
  const remote = (await conn.promise) as RemoteProxy<HostMethods>;
  return {
    storage: {
      list: (c) => remote.storageList(c) as Promise<never>,
      put: (c, id, data) => remote.storagePut(c, id, data) as Promise<never>,
      delete: (c, id) => remote.storageDelete(c, id),
    },
    profile: () => remote.profileGet(),
    setTitle: (t) => remote.uiSetTitle(t),
    toast: (t, o) => remote.uiToast(t, o),
  };
}
