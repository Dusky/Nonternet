// Small pure helpers for the chat window, kept apart from the store so they can be tested on their own.

// Tab completion: finish the word before the caret from the nicks in the channel. Pressing Tab again
// steps to the next match. At the start of a line the nick gets ": " after it, like other IRC clients.
export interface Completion { text: string; caret: number; matches: string[]; index: number; start: number }

export function completeNick(text: string, caret: number, nicks: string[], prev: Completion | null): Completion | null {
  // A repeat Tab continues the same list, as long as the box still holds what the last Tab left.
  if (prev && prev.text === text && prev.caret === caret && prev.matches.length > 1) {
    return insertAt(text, prev.start, caret, prev.matches, (prev.index + 1) % prev.matches.length);
  }
  const word = /([^\s]*)$/.exec(text.slice(0, caret))![1]!;
  if (!word) return null;
  const matches = nicks.filter((n) => n.toLowerCase().startsWith(word.toLowerCase())).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (!matches.length) return null;
  return insertAt(text, caret - word.length, caret, matches, 0);
}

// Replaces text[start..replaceEnd] with the chosen nick and its suffix.
function insertAt(text: string, start: number, replaceEnd: number, matches: string[], index: number): Completion {
  const insert = `${matches[index]!}${start === 0 ? ': ' : ' '}`;
  return { text: text.slice(0, start) + insert + text.slice(replaceEnd), caret: start + insert.length, matches, index, start };
}

// "Today", "Yesterday", or the date, for the lines that separate one day from the next.
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
export function dayLabel(ms: number, now: number, words: { today: string; yesterday: string }): string {
  if (dayKey(ms) === dayKey(now)) return words.today;
  if (dayKey(ms) === dayKey(now - 86_400_000)) return words.yesterday;
  return new Date(ms).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', ...(new Date(ms).getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) });
}

// Who is typing: nick → when to stop showing them. "active" refreshes, "done" (or silence) clears.
export const TYPING_SHOW_MS = 6000;
export function typingNow(typing: ReadonlyMap<string, number>, now: number): string[] {
  return [...typing].filter(([, until]) => until > now).map(([n]) => n).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
