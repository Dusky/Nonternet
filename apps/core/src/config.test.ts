import { describe, expect, it } from 'vitest';
import { parseSiteConfig } from './config';

const valid = `
site:
  name: Test Site
  short_name: testsite
  domain: example.test
  homes_domain: example-homes.test
`;

describe('site config', () => {
  it('parses a minimal config and applies defaults', () => {
    const cfg = parseSiteConfig(valid);
    expect(cfg.site.name).toBe('Test Site');
    expect(cfg.signup.mode).toBe('invite');
    expect(cfg.limits.trusted_board_quota).toBe(3);
    expect(cfg.services).toEqual({ bbs: false, irc: false, mud: false });
  });

  it('has no fallback name: a config without site.name is rejected', () => {
    expect(() => parseSiteConfig(valid.replace('name: Test Site', ''))).toThrow(/site\.name/);
  });

  it('rejects an empty file', () => {
    expect(() => parseSiteConfig('')).toThrow(/Invalid site config/);
  });

  it('rejects homes_domain equal to domain', () => {
    expect(() => parseSiteConfig(valid.replace('example-homes.test', 'example.test'))).toThrow(/homes_domain/);
  });

  it('rejects a bad short_name', () => {
    expect(() => parseSiteConfig(valid.replace('testsite', 'Test Site'))).toThrow(/short_name/);
  });
});
