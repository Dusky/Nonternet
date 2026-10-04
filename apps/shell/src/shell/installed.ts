import { createElement, type ComponentType } from 'react';
import { create } from 'zustand';
import type { CatalogApp } from '@app/shared';
import type { AppId } from './windows';

// The apps this person has added (docs/10), as the server last said. The registry in apps.tsx reads it, so the
// desktop, launcher, apps menu, palette and windows all treat an added app like a built-in one.
interface Installed { apps: CatalogApp[]; loaded: boolean; set: (apps: CatalogApp[]) => void }
export const useInstalled = create<Installed>((set) => ({
  apps: [],
  loaded: false,
  set: (apps) => set({ apps, loaded: true }),
}));

export const appKey = (catalogId: string): AppId => `app:${catalogId}`;
export const catalogIdOf = (id: AppId): string | null => (id.startsWith('app:') ? id.slice(4) : null);
export const installedApp = (id: AppId): CatalogApp | undefined => {
  const c = catalogIdOf(id);
  return c ? useInstalled.getState().apps.find((a) => a.id === c) : undefined;
};

// One component per app, kept, so React sees the same component each time the registry is read.
const hosts = new Map<string, ComponentType>();
export function hostComponent(catalogId: string, Host: ComponentType<{ appId: string }>): ComponentType {
  let c = hosts.get(catalogId);
  if (!c) {
    c = function InstalledApp() { return createElement(Host, { appId: catalogId }); };
    hosts.set(catalogId, c);
  }
  return c;
}
