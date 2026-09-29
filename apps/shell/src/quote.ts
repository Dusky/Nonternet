// Replies quote in the style terminal readers know: the author's initials, then "> " (docs/05).
export function initials(name: string): string {
  const words = name.split(/[\s._-]+/u).filter(Boolean);
  const letters = words.length > 1 ? words.slice(0, 2).map((w) => [...w][0]!) : [...(words[0] ?? '?')].slice(0, 2);
  return letters.join('').toUpperCase();
}

// Quote the text of a post. Lines already quoted by someone else keep their own initials, so a
// long conversation shows who said what. Blank lines stay blank.
export function quoteReply(name: string, body: string, columns = 79): string {
  const prefix = `${initials(name)}> `;
  const lines = body.split('\n').map((l) => (/^[A-Z0-9]{1,3}> /u.test(l) ? `> ${l}`.replace(/^> ([A-Z0-9]{1,3}> )/u, '$1') : `${prefix}${l}`.trimEnd()));
  const wrapped = lines.flatMap((l) => {
    if ([...l].length <= columns) return [l];
    const m = /^([A-Z0-9]{1,3}> )/u.exec(l);
    const p = m?.[1] ?? prefix;
    const words = l.slice(p.length).split(' ');
    const out: string[] = [];
    let cur = '';
    for (const w of words) {
      if (cur && [...(p + cur + ' ' + w)].length > columns) { out.push(p + cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
    }
    out.push(p + cur);
    return out;
  });
  return `${wrapped.join('\n')}\n\n`;
}
