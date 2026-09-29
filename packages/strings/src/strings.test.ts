import { describe, expect, it } from 'vitest';
import { en, format, makeT } from './index';

const siteA = { name: 'Alpha', short_name: 'alpha', domain: 'a.test', homes_domain: 'a-homes.test' };
const siteB = { name: 'Beta', short_name: 'beta', domain: 'b.test', homes_domain: 'b-homes.test' };

describe('strings', () => {
  it('fills the site name from config', () => {
    expect(makeT(siteA)('landing.title')).toBe('Alpha');
    expect(makeT(siteB)('landing.title')).toBe('Beta');
  });

  it('fills params', () => {
    expect(makeT(siteA)('auth.welcomeBack', { handle: 'zerocool', count: 14 })).toBe('Welcome back, zerocool. 14 users online.');
  });

  it('fails loudly on a missing param or unknown placeholder', () => {
    expect(() => makeT(siteA)('auth.welcomeBack', { handle: 'zerocool' })).toThrow(/count/);
    expect(() => format('{site.nope}', siteA)).toThrow(/site\.nope/);
  });

  it('every string formats with all of its params supplied', () => {
    for (const [key, tpl] of Object.entries(en)) {
      const params: Record<string, string> = {};
      for (const m of tpl.matchAll(/\{([a-zA-Z0-9]+)\}/g)) params[m[1]!] = 'x';
      expect(() => format(tpl, siteA, params), key).not.toThrow();
    }
  });

  it('follows the voice guide: no exclamation marks in system text', () => {
    for (const [key, tpl] of Object.entries(en)) expect(tpl, key).not.toContain('!');
  });
});
