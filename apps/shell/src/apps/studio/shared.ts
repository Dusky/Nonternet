import type { HomepageSummary, HomeFileEntry } from '@app/shared';


export interface Mine { homepage: HomepageSummary; files: HomeFileEntry[] }

export interface AssetInfo { id: string; title: string; category: string; width: number; height: number }

export const fmt = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
