// Wiki text (docs/20). What a person types is stored exactly as typed, and reads naturally as plain text in a terminal.
// This parser turns it into data (blocks of inline segments) that the web, the BBS and the Gemini mirror each render in
// their own way. It never produces HTML, so nothing written on a page can become markup, script or style.
//
//   # Heading / ## / ###         - item / * item / 1. item         > quote         ```  code block  ```
//   *emphasis*  **strong**  `code`  [text](https://…)  bare https://…  [[Page name]]  [[Page name|shown text]]
//
// Anything that doesn't fit a rule stays as the literal characters.

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'wiki'; text: string; target: string; slug: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; content: Inline[][] }
  | { kind: 'code'; text: string };

export const WIKI_TITLE_MAX = 120;
export const WIKI_BODY_MAX = 100_000;
export const WIKI_SUMMARY_MAX = 200;

// "Getting Started" -> "getting-started". Letters and digits of any script are kept; everything else between them
// becomes one hyphen. Two titles that differ only in case or punctuation are the same page.
export function wikiSlug(title: string): string {
  return title.normalize('NFC').toLowerCase().trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// Only these become clickable. A `javascript:` or `data:` address stays as text.
const SAFE_URL = /^(https?|gemini|gopher):\/\/[^\s<>"]+$/i;
export const isSafeUrl = (u: string): boolean => SAFE_URL.test(u);

export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const push = (seg: Inline) => { if (text) { out.push({ kind: 'text', text }); text = ''; } out.push(seg); };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\[\[([^\[\]|\n]{1,120})(?:\|([^\[\]\n]{1,200}))?\]\]/.exec(rest))) {
      const target = m[1]!.trim();
      const slug = wikiSlug(target);
      if (slug) { push({ kind: 'wiki', target, slug, text: (m[2] ?? target).trim() }); i += m[0].length; continue; }
    }
    if ((m = /^\[([^\[\]\n]{1,200})\]\(([^()\s]{1,2000})\)/.exec(rest)) && isSafeUrl(m[2]!)) {
      push({ kind: 'link', text: m[1]!, href: m[2]! }); i += m[0].length; continue;
    }
    if ((m = /^`([^`\n]+)`/.exec(rest))) { push({ kind: 'code', text: m[1]! }); i += m[0].length; continue; }
    if ((m = /^\*\*([^*\n]+)\*\*/.exec(rest))) { push({ kind: 'strong', text: m[1]! }); i += m[0].length; continue; }
    // *emphasis* only where it starts a word, so "2*3*4" and "a * b" stay as written.
    if ((m = /^\*([^*\s][^*\n]*?)\*(?![\p{L}\p{N}])/u.exec(rest)) && !/[\p{L}\p{N}]$/u.test(text)) { push({ kind: 'em', text: m[1]! }); i += m[0].length; continue; }
    if ((m = /^(https?|gemini|gopher):\/\/[^\s<>"]+/i.exec(rest)) && !/[\p{L}\p{N}]$/u.test(text)) {
      // A full stop or bracket right after an address is the sentence's, not the address's.
      const url = m[0].replace(/[.,;:!?)\]]+$/, '');
      push({ kind: 'link', text: url, href: url }); i += url.length; continue;
    }
    text += line[i];
    i += 1;
  }
  if (text) out.push({ kind: 'text', text });
  return out;
}

export function parseWiki(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => { if (para.length) { blocks.push({ kind: 'paragraph', content: parseInline(para.join(' ')) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      endPara();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) { code.push(lines[i]!); i += 1; }
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) { endPara(); blocks.push({ kind: 'heading', level: h[1]!.length as 1 | 2 | 3, content: parseInline(h[2]!.trim()) }); continue; }
    const item = (l: string) => /^\s{0,3}(?:[-*]|\d{1,3}[.)])\s+(.*)$/.exec(l);
    if (item(line)) {
      endPara();
      const ordered = /^\s{0,3}\d/.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && item(lines[i]!) && /^\s{0,3}\d/.test(lines[i]!) === ordered) { items.push(parseInline(item(lines[i]!)![1]!)); i += 1; }
      i -= 1;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      endPara();
      const quote: Inline[][] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) { quote.push(parseInline(lines[i]!.replace(/^>\s?/, ''))); i += 1; }
      i -= 1;
      blocks.push({ kind: 'quote', content: quote });
      continue;
    }
    if (line.trim() === '') { endPara(); continue; }
    para.push(line.trim());
  }
  endPara();
  return blocks;
}

// Every page a text links to, once each, by slug (for backlinks and wanted pages).
export function wikiLinks(body: string): { slug: string; target: string }[] {
  const seen = new Map<string, string>();
  for (const b of parseWiki(body)) {
    const lines = b.kind === 'list' ? b.items : b.kind === 'quote' ? b.content : b.kind === 'code' ? [] : [b.content];
    for (const l of lines) for (const s of l) if (s.kind === 'wiki' && !seen.has(s.slug)) seen.set(s.slug, s.target);
  }
  return [...seen].map(([slug, target]) => ({ slug, target }));
}

// The inline segments as plain text, for places that show no formatting (search snippets, feeds, terminals' link lists).
export const inlineText = (segs: Inline[]): string => segs.map((s) => s.text).join('');
