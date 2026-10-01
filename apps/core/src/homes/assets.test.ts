import { describe, expect, it } from 'vitest';
import { ASSETS } from './assets';
import { TEMPLATES } from './templates';

// The name is built from pieces so this file does not itself contain the placeholder (tests/placeholder-name.test.ts).
const SITE_NAMES = new RegExp(['test site', ['non', 'ternet'].join('')].join('|'), 'i');

describe('the asset library', () => {
  it('has unique ids and every category', () => {
    expect(new Set(ASSETS.map((a) => a.id)).size).toBe(ASSETS.length);
    expect(new Set(ASSETS.map((a) => a.category))).toEqual(new Set(['divider', 'button', 'background', 'sign', 'blinkie']));
  });
  it('is plain, well-formed SVG with no script, links or event handlers', () => {
    for (const a of ASSETS) {
      expect(a.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), a.id).toBe(true);
      expect(a.svg.trimEnd().endsWith('</svg>'), a.id).toBe(true);
      expect(a.svg, a.id).not.toMatch(/<script|<foreignObject|<a[ >]|href=|xlink|\son\w+=|javascript:|<image|<use/i);
      expect(a.svg, a.id).toContain(`width="${a.width}"`);
    }
  });
  it('has classic 88x31 buttons', () => {
    const buttons = ASSETS.filter((a) => a.category === 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const b of buttons) expect([b.width, b.height]).toEqual([88, 31]);
  });
});

describe('templates', () => {
  it('make a front page and a style file, and never name the site', () => {
    for (const t of TEMPLATES) {
      const files = t.files({ handle: 'zerocool', title: 'My page' });
      expect(Object.keys(files), t.id).toContain('index.html');
      expect(files['index.html'], t.id).toContain('<title>');
      expect(JSON.stringify(files), t.id).not.toMatch(SITE_NAMES);
    }
  });
});
