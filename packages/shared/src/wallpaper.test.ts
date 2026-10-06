import { describe, expect, it } from 'vitest';
import { siteConfigSchema } from './site-config';
import { wallpaperChoiceSchema } from './wallpaper';

const site = { name: 'Test site', short_name: 'test', domain: 'test.example', homes_domain: 'homes.example' };

describe("the site's own wallpapers in the config", () => {
  it('defaults to dots and no pictures', () => {
    const c = siteConfigSchema.parse({ site });
    expect(c.ui.wallpapers).toEqual([]);
    expect(c.ui.default_wallpaper).toBe('dots');
  });
  it('takes listed pictures, and a default that is a pattern or one of them', () => {
    const c = siteConfigSchema.parse({ site, ui: { wallpapers: [{ id: 'hills', name: 'Hills', file: 'hills.webp' }], default_wallpaper: 'preset:hills' } });
    expect(c.ui.wallpapers[0]!.fit).toBe('cover');
    expect(siteConfigSchema.safeParse({ site, ui: { default_wallpaper: 'preset:hills' } }).success).toBe(false);
    expect(siteConfigSchema.safeParse({ site, ui: { default_wallpaper: 'paisley' } }).success).toBe(false);
  });
  it('refuses file names that reach outside the folder, and duplicate ids', () => {
    for (const file of ['../etc/passwd.png', 'sub/x.png', '.hidden.png', 'x.svg']) {
      expect(siteConfigSchema.safeParse({ site, ui: { wallpapers: [{ id: 'x', name: 'X', file }] } }).success, file).toBe(false);
    }
    const twice = [{ id: 'x', name: 'X', file: 'a.png' }, { id: 'x', name: 'Y', file: 'b.png' }];
    expect(siteConfigSchema.safeParse({ site, ui: { wallpapers: twice } }).success).toBe(false);
  });
  it('checks the shape of a choice', () => {
    for (const ok of ['dots', 'own', 'preset:hills']) expect(wallpaperChoiceSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['preset:', 'preset:../x', 'paisley']) expect(wallpaperChoiceSchema.safeParse(bad).success, bad).toBe(false);
  });
});
