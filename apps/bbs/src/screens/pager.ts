import type { Session } from '../session';

// Shows lines a screenful at a time. Returns false if the caller stopped early (Q or Escape).
export async function page(s: Session, lines: string[]): Promise<boolean> {
  const per = Math.max(5, s.term.rows - 2);
  for (let i = 0; i < lines.length; i++) {
    s.term.line(lines[i]);
    if ((i + 1) % per === 0 && i + 1 < lines.length && !(await s.pause())) return false;
  }
  return true;
}
