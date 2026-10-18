import iconv from 'iconv-lite';

// The PC's symbols in the CP437 control range (☺ ♥ ♪ ► ↑ ⌂ …), which iconv-lite treats as control characters (research,
// 2026-10-18). Door games and old art draw with them. The codes a terminal acts on stay codes: bell, backspace, tab,
// line feed, form feed, carriage return and escape.
const GLYPHS = ' ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼';
const KEEP = new Set([0x07, 0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x1b]);
const TO_BYTE = new Map<string, number>([...GLYPHS].map((g, i) => [g, i] as const).filter(([, i]) => i > 0 && !KEEP.has(i)).concat([['⌂', 0x7f]]));

export function decodeCp437(b: Buffer): string {
  let out = '';
  let start = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i]!;
    if ((c > 0 && c < 0x20 && !KEEP.has(c)) || c === 0x7f) {
      out += iconv.decode(b.subarray(start, i), 'cp437') + (c === 0x7f ? '⌂' : [...GLYPHS][c]!);
      start = i + 1;
    }
  }
  return out + iconv.decode(b.subarray(start), 'cp437');
}

export function encodeCp437(s: string): Buffer {
  const parts: Buffer[] = [];
  let run = '';
  for (const ch of s) {
    const byte = TO_BYTE.get(ch);
    if (byte === undefined) { run += ch; continue; }
    if (run) { parts.push(iconv.encode(run, 'cp437')); run = ''; }
    parts.push(Buffer.from([byte]));
  }
  if (run) parts.push(iconv.encode(run, 'cp437'));
  return Buffer.concat(parts);
}
