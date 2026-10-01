import { describe, expect, it } from 'vitest';
import { faviconSvg, tabTitle } from './tabInfo';

describe('the tab title', () => {
  it('names the app and the site', () => {
    expect(tabTitle({ site: 'Site', app: 'Boards' })).toBe('Boards · Site');
    expect(tabTitle({ site: 'Site' })).toBe('Site');
  });
  it('shows what is unread, and caps it', () => {
    expect(tabTitle({ site: 'Site', app: 'Mail', unread: 3 })).toBe('(3) Mail · Site');
    expect(tabTitle({ site: 'Site', unread: 250 })).toBe('(99+) Site');
    expect(tabTitle({ site: 'Site', unread: 0 })).toBe('Site');
  });
});

describe('the tab icon', () => {
  it('has a dot only when something is unread', () => {
    expect(faviconSvg({ accent: '#2b4fd6', bg: '#fff', badge: true })).toContain('<circle');
    expect(faviconSvg({ accent: '#2b4fd6', bg: '#fff', badge: false })).not.toContain('<circle');
  });
  it('never puts anything but a hex colour into the markup', () => {
    const svg = faviconSvg({ accent: '"><script>alert(1)</script>', bg: 'red', badge: false });
    expect(svg).not.toContain('script');
    expect(svg).toContain('#2b4fd6'); // fell back
  });
});
