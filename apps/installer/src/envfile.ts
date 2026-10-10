// Reading and writing .env without losing its comments: a key that is there is changed in place, a commented-out
// "# KEY=" line is uncommented, and a new key goes at the end.
export function envGet(text: string, key: string): string | undefined {
  let found: string | undefined;
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] === key) found = m[2];
  }
  return found;
}

export function envSet(text: string, key: string, value: string): string {
  if (/[\n\r]/.test(value)) throw new Error(`${key} cannot hold a line break`);
  const lines = text.split('\n');
  const live = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (live >= 0) { lines[live] = `${key}=${value}`; return lines.join('\n'); }
  const commented = lines.findIndex((l) => new RegExp(`^#\\s*${key}=`).test(l));
  if (commented >= 0) {
    // The example's trailing "# note" goes on its own line above: sitectl reads values up to the end of the line.
    const note = /\s{2,}(#\s.*)$/.exec(lines[commented]!)?.[1];
    lines.splice(commented, 1, ...(note ? [note] : []), `${key}=${value}`);
    return lines.join('\n');
  }
  const body = text.endsWith('\n') || text === '' ? text : `${text}\n`;
  return `${body}${key}=${value}\n`;
}
