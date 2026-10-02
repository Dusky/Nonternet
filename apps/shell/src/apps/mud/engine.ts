import type { MudAction, MudAlias, MudClient, MudTrigger } from '@app/shared';

// The MUD client's rules (docs/09): aliases, speedwalks, triggers, keys and variables. Rules only, never code (decided
// 2026-10-02): a rule matches text and does one of a fixed set of things. Everything here is pure, so it is unit-tested.

export const MAX_COMMANDS = 50; // one line of input never becomes more than this many commands
const MAX_DEPTH = 8; // an alias may use another alias, this deep

// ---------------------------------------------------------------- matching

const regexCache = new Map<string, RegExp | null>();
function compile(pattern: string, flags = 'i'): RegExp | null {
  const k = `${flags}/${pattern}`;
  if (!regexCache.has(k)) {
    let re: RegExp | null = null;
    try { re = new RegExp(pattern, flags); } catch { re = null; }
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(k, re);
  }
  return regexCache.get(k)!;
}

export const validRegex = (pattern: string) => compile(pattern) !== null;

/** Captures ($0 is the whole match, $1… the parts) when the text matches, else null. Words are matched without case. */
export function match(kind: 'contains' | 'start' | 'exact' | 'regex', pattern: string, text: string): string[] | null {
  const t = text.toLowerCase();
  const p = pattern.toLowerCase();
  switch (kind) {
    case 'exact': return t === p ? [text] : null;
    case 'contains': { const at = t.indexOf(p); return at >= 0 ? [text.slice(at, at + p.length)] : null; }
    case 'start': {
      // "kk" matches "kk" and "kk rat"; what follows the word is $1, and each word of it $2, $3…
      if (t !== p && !t.startsWith(`${p} `)) return null;
      const rest = text.slice(pattern.length).trim();
      return [text, rest, ...(rest ? rest.split(/\s+/) : [])];
    }
    case 'regex': {
      const re = compile(pattern);
      const m = re ? re.exec(text) : null;
      return m ? m.map((x) => x ?? '') : null;
    }
  }
}

/** Puts captures ($1…, $0, and $* for everything after the alias) and variables (@name) into a command. */
export function fill(template: string, caps: string[], vars: Record<string, string>): string {
  return template
    .replace(/\$(\d|\*)/g, (_, d: string) => (d === '*' ? caps[1] ?? '' : caps[Number(d)] ?? ''))
    .replace(/@([A-Za-z_][A-Za-z0-9_]{0,30})/g, (all, name: string) => (name in vars ? vars[name]! : all));
}

// ---------------------------------------------------------------- input

const DIRS: Record<string, string> = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest' };

/**
 * A speedwalk ("#3n 2e w") becomes its steps, and a repeat ("#5 kill rat") the command five times.
 * Anything else is null. Counts are capped so a typo can't send hundreds of commands.
 */
export function speedwalk(cmd: string): string[] | null {
  const m = /^#(\d{1,2})\s+(\S.*)$/.exec(cmd);
  if (m) return Array<string>(Math.min(Number(m[1]), 20)).fill(m[2]!); // a repeat: "#5 kill rat"
  const body = /^#\s*(.+)$/.exec(cmd)?.[1];
  if (!body) return null;
  const parts = body.trim().split(/\s+/);
  const out: string[] = [];
  for (const p of parts) {
    const s = /^(\d{0,2})(n|s|e|w|u|d|ne|nw|se|sw)$/i.exec(p);
    if (!s) return null;
    for (let i = 0; i < Math.min(Number(s[1] || 1), 20); i++) out.push(DIRS[s[2]!.toLowerCase()]!);
  }
  return out;
}

/** Splits on the separator, except where it is written twice ("a;;b" is one command "a;b"). */
export function splitCommands(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    if (line.startsWith(sep, i)) {
      if (line.startsWith(sep, i + sep.length)) { cur += sep; i += sep.length * 2 - 1; continue; }
      out.push(cur); cur = ''; i += sep.length - 1; continue;
    }
    cur += line[i];
  }
  out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

function aliasFor(cmd: string, aliases: MudAlias[]): { alias: MudAlias; caps: string[] } | null {
  for (const alias of aliases) {
    if (!alias.enabled) continue;
    const caps = match(alias.match, alias.pattern, cmd);
    if (caps) return { alias, caps };
  }
  return null;
}

/**
 * What one typed line sends: split on the separator, each piece through speedwalk and aliases (an alias's commands go
 * through the same steps, a few levels deep), variables filled in. A line starting with a space is sent exactly as typed.
 */
export function expand(line: string, s: Pick<MudClient, 'aliases' | 'variables' | 'options'>): string[] {
  if (line.startsWith(' ')) return line.trim() ? [line.trim()] : [];
  const out: string[] = [];
  const walk = (text: string, depth: number) => {
    for (const piece of splitCommands(text, s.options.separator)) {
      if (out.length >= MAX_COMMANDS) return;
      const steps = s.options.speedwalk ? speedwalk(piece) : null;
      if (steps) { for (const st of steps) if (out.length < MAX_COMMANDS) walkOne(st, depth); continue; }
      walkOne(piece, depth);
    }
  };
  const walkOne = (cmd: string, depth: number) => {
    const hit = depth < MAX_DEPTH ? aliasFor(cmd, s.aliases) : null;
    if (hit) walk(fill(hit.alias.send, hit.caps, s.variables), depth + 1);
    else out.push(fill(cmd, [], s.variables));
  };
  walk(line, 0);
  return out;
}

// ---------------------------------------------------------------- triggers

export interface Highlight { colour: string; start: number; end: number } // [start, end) in the plain line; end -1 = whole line
export interface TriggerResult {
  gag: boolean; highlights: Highlight[]; send: string[]; capture: string[]; beep: boolean; notify: boolean; set: Record<string, string>;
}

/** Runs every enabled trigger over one line of plain text (what the game said, colours removed). */
export function runTriggers(line: string, triggers: MudTrigger[], vars: Record<string, string>): TriggerResult | null {
  let r: TriggerResult | null = null;
  for (const tr of triggers) {
    if (!tr.enabled) continue;
    const caps = match(tr.match, tr.pattern, line);
    if (!caps) continue;
    r ??= { gag: false, highlights: [], send: [], capture: [], beep: false, notify: false, set: {} };
    const at = line.toLowerCase().indexOf(caps[0]!.toLowerCase());
    for (const a of tr.actions) apply(r, a, caps, at, { ...vars, ...r.set });
  }
  return r;
}

function apply(r: TriggerResult, a: MudAction, caps: string[], at: number, vars: Record<string, string>) {
  switch (a.type) {
    case 'send': r.send.push(fill(a.text, caps, vars)); break;
    case 'highlight': r.highlights.push(a.line || at < 0 ? { colour: a.colour, start: 0, end: -1 } : { colour: a.colour, start: at, end: at + caps[0]!.length }); break;
    case 'gag': r.gag = true; break;
    case 'capture': if (!r.capture.includes(a.window)) r.capture.push(a.window); break;
    case 'beep': r.beep = true; break;
    case 'notify': r.notify = true; break;
    case 'set': r.set[a.name] = fill(a.value, caps, vars); break;
  }
}

// ---------------------------------------------------------------- keys

/** A key press as a name: "Numpad8", "Ctrl+K", "Alt+Shift+F2". Plain letters and digits without a modifier are null (they are typing). */
export function keyName(e: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  const base = e.code.startsWith('Numpad') ? e.code : /^F\d{1,2}$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean) as string[];
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  if (plain && !e.code.startsWith('Numpad') && !/^F\d{1,2}$/.test(e.key)) return null; // typing, Enter, arrows…
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
  return [...mods, base].join('+');
}

// The number pad walks when it is on (Num Lock off or on: codes are the same).
export const NUMPAD: Record<string, string> = {
  Numpad8: 'north', Numpad2: 'south', Numpad4: 'west', Numpad6: 'east', Numpad7: 'northwest', Numpad9: 'northeast',
  Numpad1: 'southwest', Numpad3: 'southeast', Numpad5: 'look', NumpadAdd: 'down', NumpadSubtract: 'up',
};

// A new id for a rule: short, lowercase, unique enough within one person's settings.
export const newId = () => Math.random().toString(36).slice(2, 10);
