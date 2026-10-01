import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

// The art pack (docs/04): screens and menus that an operator can replace without touching code. Screens are
// text with {{placeholders}}; the site's name and addresses come from config, never from the files, so a
// rename needs no art changes (CLAUDE.md placeholder rule).
//   {{site.name}} {{site.domain}} {{site.url}} {{handle}} {{node}} and any value passed in
//   {{c:cyan}} {{c:bold}} {{c:reset}} …   colours (ANSI SGR)
//   {{center:62:site.name}}              a value centred in a field of that width

const SGR: Record<string, string> = {
  reset: '0', bold: '1', dim: '2', underline: '4', reverse: '7',
  black: '30', red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36', white: '37',
  'bright-black': '90', 'bright-red': '91', 'bright-green': '92', 'bright-yellow': '93', 'bright-blue': '94', 'bright-magenta': '95', 'bright-cyan': '96', 'bright-white': '97',
};

export const ACTIONS = ['boards', 'newscan', 'mail', 'rings', 'homepages', 'who', 'lastcallers', 'doors', 'qwk', 'oneliners', 'bulletins', 'polls', 'files', 'settings', 'goodbye'] as const;
export type Action = (typeof ACTIONS)[number];
const menuSchema = z.object({
  title: z.string().min(1).max(60),
  items: z.array(z.object({ key: z.string().regex(/^[A-Za-z0-9]$/), label: z.string().min(1).max(60), action: z.enum(ACTIONS) })).min(1),
}).refine((m) => new Set(m.items.map((i) => i.key.toUpperCase())).size === m.items.length, 'two items share a key');
export type Menu = z.infer<typeof menuSchema>;

export class ArtPack {
  private cache = new Map<string, string>();
  readonly menus: Record<string, Menu>;

  constructor(readonly dir: string, private readonly vars: Record<string, string>) {
    const raw = parse(readFileSync(join(dir, 'menus.yaml'), 'utf8')) as Record<string, unknown>;
    this.menus = Object.fromEntries(Object.entries(raw).map(([k, v]) => {
      const m = menuSchema.safeParse(v);
      if (!m.success) throw new Error(`art pack menus.yaml: menu "${k}": ${m.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      return [k, m.data];
    }));
    if (!this.menus.main) throw new Error('art pack menus.yaml needs a "main" menu');
  }

  has(screen: string): boolean { return existsSync(join(this.dir, `${screen}.txt`)); }

  // A screen with its placeholders filled in. Unknown placeholders are left empty.
  render(screen: string, values: Record<string, string | number> = {}, opts: { color?: boolean } = {}): string {
    let text = this.cache.get(screen);
    if (text === undefined) {
      text = this.has(screen) ? readFileSync(join(this.dir, `${screen}.txt`), 'utf8') : '';
      this.cache.set(screen, text);
    }
    return fill(text, { ...this.vars, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)])) }, opts.color ?? true);
  }
}

export function fill(text: string, vars: Record<string, string>, color = true): string {
  return text.replace(/\{\{([a-z0-9_.:-]+)\}\}/gi, (_, token: string) => {
    if (token.startsWith('c:')) {
      const code = SGR[token.slice(2)];
      return color && code ? `\x1b[${code}m` : '';
    }
    const m = /^center:(\d+):(.+)$/.exec(token);
    if (m) {
      const w = Number(m[1]);
      const v = [...(vars[m[2]!] ?? '')].slice(0, w).join('');
      const left = Math.floor((w - [...v].length) / 2);
      return ' '.repeat(left) + v + ' '.repeat(w - [...v].length - left);
    }
    return vars[token] ?? '';
  });
}
