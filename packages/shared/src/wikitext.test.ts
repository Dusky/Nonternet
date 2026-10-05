import { describe, expect, it } from 'vitest';
import { parseInline, parseWiki, wikiLinks, wikiSlug } from './wikitext';

describe('wiki text', () => {
  it('makes slugs that ignore case and punctuation, in any script', () => {
    expect(wikiSlug('Getting Started')).toBe('getting-started');
    expect(wikiSlug('  getting   started!! ')).toBe('getting-started');
    expect(wikiSlug('Café Ünïcode')).toBe('café-ünïcode');
    expect(wikiSlug('日本語 ページ')).toBe('日本語-ページ');
    expect(wikiSlug('***')).toBe('');
  });

  it('reads headings, lists, quotes, code and paragraphs', () => {
    const b = parseWiki('# Title\n\nSome text\nwrapped here.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n> more\n\n```\n# not a heading\n[[not a link]]\n```\n## Sub');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'heading']);
    expect(b[1]).toEqual({ kind: 'paragraph', content: [{ kind: 'text', text: 'Some text wrapped here.' }] });
    expect(b[3]).toMatchObject({ kind: 'list', ordered: true });
    expect(b[5]).toEqual({ kind: 'code', text: '# not a heading\n[[not a link]]' });
    expect(b[6]).toMatchObject({ kind: 'heading', level: 2 });
  });

  it('reads emphasis, code, links and wiki links, and leaves arithmetic and stray stars alone', () => {
    expect(parseInline('a *soft* and **loud** `x = 1` word')).toEqual([
      { kind: 'text', text: 'a ' }, { kind: 'em', text: 'soft' }, { kind: 'text', text: ' and ' }, { kind: 'strong', text: 'loud' },
      { kind: 'text', text: ' ' }, { kind: 'code', text: 'x = 1' }, { kind: 'text', text: ' word' },
    ]);
    expect(parseInline('2*3*4 and a * b')).toEqual([{ kind: 'text', text: '2*3*4 and a * b' }]);
    expect(parseInline('See [[Getting Started|the guide]] or [[FAQ]].')).toEqual([
      { kind: 'text', text: 'See ' }, { kind: 'wiki', target: 'Getting Started', slug: 'getting-started', text: 'the guide' },
      { kind: 'text', text: ' or ' }, { kind: 'wiki', target: 'FAQ', slug: 'faq', text: 'FAQ' }, { kind: 'text', text: '.' },
    ]);
    expect(parseInline('Go to https://example.org/a. Or [here](gemini://example.org/).')).toEqual([
      { kind: 'text', text: 'Go to ' }, { kind: 'link', text: 'https://example.org/a', href: 'https://example.org/a' },
      { kind: 'text', text: '. Or ' }, { kind: 'link', text: 'here', href: 'gemini://example.org/' }, { kind: 'text', text: '.' },
    ]);
  });

  it('never turns hostile text into anything but text', () => {
    const evil = '<script>alert(1)</script> [x](javascript:alert(1)) [y](data:text/html,hi) <img src=x onerror=alert(1)>';
    const segs = parseInline(evil);
    expect(segs.every((s) => s.kind === 'text')).toBe(true);
    expect(segs.map((s) => s.text).join('')).toBe(evil);
    const deep = '>'.repeat(5000) + ' x\n' + '- '.repeat(5000) + '*'.repeat(10000);
    expect(() => parseWiki(deep)).not.toThrow();
  });

  it('lists each linked page once, ignoring code blocks', () => {
    expect(wikiLinks('[[A]] and [[a]] and [[B|bee]]\n- [[C]]\n```\n[[D]]\n```')).toEqual([
      { slug: 'a', target: 'A' }, { slug: 'b', target: 'B' }, { slug: 'c', target: 'C' },
    ]);
  });
});
