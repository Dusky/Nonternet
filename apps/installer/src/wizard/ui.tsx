import { useRef, useState, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';

// The wizard's few building blocks, drawn in the BBS style: a framed window with a title bar, a key line at the bottom,
// and inputs that only need the keyboard. Kept small and self-made, so the installer has no input library to keep up to date.

export const ACCENT = 'magentaBright';

export function Frame({ step, total, title, children, keys }: { step: number; total: number; title: string; children: ReactNode; keys: string }) {
  return (
    <Box flexDirection="column" borderStyle="double" borderColor={ACCENT} paddingX={1} width={78}>
      <Box justifyContent="space-between">
        <Text bold color={ACCENT}>{title}</Text>
        <Text dimColor>{`step ${step} of ${total}`}</Text>
      </Box>
      <Box flexDirection="column" marginY={1}>{children}</Box>
      <Text dimColor>{keys}</Text>
    </Box>
  );
}

// One line of text being typed. `focus` decides which field gets the keys.
export function TextField({ label, value, onChange, focus, secret, placeholder, error }: { label: string; value: string; onChange: (v: string) => void; focus: boolean; secret?: boolean; placeholder?: string; error?: string }) {
  // Keys can arrive faster than the screen redraws (fast typing, a paste), so each one builds on the last, not on the
  // value from the last redraw.
  const cur = useRef(value);
  cur.current = value;
  const change = (v: string) => { cur.current = v; onChange(v); };
  useInput((input, key) => {
    if (!focus) return;
    if (key.backspace || key.delete) return change(cur.current.slice(0, -1));
    if (key.return || key.tab || key.upArrow || key.downArrow || key.escape || key.ctrl || key.meta) return;
    if (input) change(cur.current + input.replace(/[\r\n\t]/g, ''));
  }, { isActive: focus });
  const shown = secret ? '•'.repeat(value.length) : value;
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={focus ? ACCENT : undefined}>{focus ? '› ' : '  '}</Text>
        <Box width={24}><Text bold={focus}>{label}</Text></Box>
        <Text inverse={focus}>{shown || ' '}</Text>
        {!shown && placeholder && !focus && <Text dimColor>{` ${placeholder}`}</Text>}
      </Box>
      {error && <Text color="red">{`    ${error}`}</Text>}
    </Box>
  );
}

// Pick one with the arrow keys.
export function Choice<T extends string>({ options, value, onChange, focus }: { options: { value: T; title: string; about?: string }[]; value: T; onChange: (v: T) => void; focus: boolean }) {
  useInput((_i, key) => {
    const at = options.findIndex((o) => o.value === value);
    if (key.upArrow) onChange(options[(at - 1 + options.length) % options.length]!.value);
    if (key.downArrow) onChange(options[(at + 1) % options.length]!.value);
  }, { isActive: focus });
  return (
    <Box flexDirection="column">
      {options.map((o) => (
        <Box key={o.value} flexDirection="column" marginBottom={o.about ? 1 : 0}>
          <Text color={o.value === value ? ACCENT : undefined} bold={o.value === value}>{`${o.value === value ? '(•)' : '( )'} ${o.title}`}</Text>
          {o.about && <Text dimColor>{`    ${o.about}`}</Text>}
        </Box>
      ))}
    </Box>
  );
}

// A list of on/off switches: arrows move, space flips.
export function Toggles<K extends string>({ items, values, onChange, focus }: { items: { key: K; title: string; about?: string }[]; values: Record<K, boolean>; onChange: (k: K, on: boolean) => void; focus: boolean }) {
  const [at, setAt] = useState(0);
  useInput((input, key) => {
    if (key.upArrow) setAt((n) => (n - 1 + items.length) % items.length);
    if (key.downArrow) setAt((n) => (n + 1) % items.length);
    if (input === ' ') { const k = items[at]!.key; onChange(k, !values[k]); }
  }, { isActive: focus });
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Box key={it.key}>
          <Text color={i === at && focus ? ACCENT : undefined}>{`${i === at && focus ? '›' : ' '} [${values[it.key] ? 'x' : ' '}] `}</Text>
          <Box width={26}><Text bold={i === at && focus}>{it.title}</Text></Box>
          {it.about && <Text dimColor>{it.about}</Text>}
        </Box>
      ))}
    </Box>
  );
}

// Big letters for the site's name, drawn from a tiny built-in block font (no figlet to install).
const FONT: Record<string, string[]> = {
  A: ['▄▀▄', '█▀█', '▀ ▀'], B: ['█▀▄', '█▀▄', '▀▀ '], C: ['▄▀▀', '█  ', ' ▀▀'], D: ['█▀▄', '█ █', '▀▀ '], E: ['█▀▀', '█▀▀', '▀▀▀'],
  F: ['█▀▀', '█▀ ', '▀  '], G: ['▄▀▀', '█ ▄', ' ▀▀'], H: ['█ █', '█▀█', '▀ ▀'], I: ['▀█▀', ' █ ', '▀▀▀'], J: ['  █', '▄ █', ' ▀ '],
  K: ['█ ▄', '█▀▄', '▀ ▀'], L: ['█  ', '█  ', '▀▀▀'], M: ['█▄█', '█ █', '▀ ▀'], N: ['█▄ █', '█ ▀█', '▀  ▀'], O: ['▄▀▄', '█ █', ' ▀ '],
  P: ['█▀▄', '█▀ ', '▀  '], Q: ['▄▀▄', '█ █', ' ▀▄'], R: ['█▀▄', '█▀▄', '▀ ▀'], S: ['▄▀▀', ' ▀▄', '▀▀ '], T: ['▀█▀', ' █ ', ' ▀ '],
  U: ['█ █', '█ █', ' ▀ '], V: ['█ █', '▀▄▀', ' ▀ '], W: ['█ █', '█▄█', '▀ ▀'], X: ['▀▄▀', ' █ ', '▀ ▀'], Y: ['█ █', ' █ ', ' ▀ '],
  Z: ['▀▀█', '▄▀ ', '▀▀▀'], ' ': ['  ', '  ', '  '], '-': ['   ', '▀▀▀', '   '], '0': ['█▀█', '█ █', '▀▀▀'], '1': ['▄█ ', ' █ ', '▀▀▀'],
};
export function banner(text: string): string[] {
  const letters = [...text.toUpperCase().slice(0, 16)].map((c) => FONT[c] ?? FONT[' ']!);
  return [0, 1, 2].map((row) => letters.map((l) => l[row]).join(' '));
}
export function Banner({ text }: { text: string }) {
  return <Box flexDirection="column">{banner(text).map((l, i) => <Text key={i} color={ACCENT}>{l}</Text>)}</Box>;
}
