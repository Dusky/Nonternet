import { useQuery } from '@tanstack/react-query';
import type { WallpaperSettings } from '@app/shared';
import { api } from './api';
import { saveWallpaperPref } from './theme';

// The desktop wallpaper saved on the account (docs/10), and putting it on screen.
export const useWallpaper = (enabled = true) => useQuery({ queryKey: ['wallpaper'], queryFn: () => api.get<WallpaperSettings>('/me/wallpaper'), enabled, staleTime: 60_000 });
export const applyWallpaperSettings = (w: WallpaperSettings) => saveWallpaperPref({ choice: w.choice, fit: w.fit, version: w.own?.version ?? null });
