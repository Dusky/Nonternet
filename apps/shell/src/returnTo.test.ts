import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './returnTo';

const ORIGIN = 'https://example.net';

describe('safeReturnTo', () => {
  it('accepts a path on this site, keeping its query and hash', () => {
    expect(safeReturnTo('/settings/password?x=1#top', ORIGIN)).toEqual({ kind: 'app', to: '/settings/password?x=1#top' });
    expect(safeReturnTo('/', ORIGIN)).toEqual({ kind: 'app', to: '/' });
  });

  it('accepts a full URL on this origin', () => {
    expect(safeReturnTo('https://example.net/admin/users', ORIGIN)).toEqual({ kind: 'app', to: '/admin/users' });
  });

  it('sends server-side paths (the OIDC sign-in step) to a full page load', () => {
    const url = 'https://example.net/api/v1/oidc/interaction/abc123';
    expect(safeReturnTo(url, ORIGIN)).toEqual({ kind: 'page', url });
    expect(safeReturnTo('/oidc/auth/xyz', ORIGIN)).toEqual({ kind: 'page', url: 'https://example.net/oidc/auth/xyz' });
  });

  it('refuses another origin, including look-alikes and tricks', () => {
    for (const bad of [
      'https://evil.example/x', 'http://example.net/x', '//evil.example/x', 'https://example.net.evil.example/x',
      'https://example.net@evil.example/x', 'https://evil.example\\@example.net/', '/\\evil.example', 'javascript:alert(1)',
      'data:text/html,hi', ' //evil.example', '\t//evil.example',
    ]) expect(safeReturnTo(bad, ORIGIN), bad).toBeNull();
  });

  it('treats a scheme-relative oddity as a path on this site, never as another site', () => {
    // Browsers read "https:evil.example" relative to the current origin, so it can only stay here.
    expect(safeReturnTo('https:evil.example', ORIGIN)).toEqual({ kind: 'app', to: '/evil.example' });
  });

  it('refuses nothing, empty and unparseable values', () => {
    expect(safeReturnTo(null, ORIGIN)).toBeNull();
    expect(safeReturnTo(undefined, ORIGIN)).toBeNull();
    expect(safeReturnTo('', ORIGIN)).toBeNull();
    expect(safeReturnTo('http://[::1', ORIGIN)).toBeNull();
  });

  it('never returns to a page that only makes sense before logging in', () => {
    for (const p of ['/login', '/signup', '/forgot-password', '/reset-password?token=x', '/verify-email?token=x']) expect(safeReturnTo(p, ORIGIN), p).toBeNull();
  });
});
