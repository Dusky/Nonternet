import type { z } from 'zod';

type ZodIssue = z.core.$ZodIssue;

// What a person reads when a form is refused (docs/00: plain voice). Our schemas give their own messages where it matters
// ("enter the 6-digit code"); zod's built-in ones ("String must contain at least 1 character(s)") are turned into plain words,
// naming the field the way a person would.
const field = (issue: ZodIssue) => {
  const last = [...issue.path].reverse().find((p) => typeof p === 'string') as string | undefined;
  return last ? last.replace(/_/g, ' ') : 'answer';
};
const sentence = (s: string) => { const t = s.trim(); return `${t[0]!.toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`; };
// zod 4's own messages ("Invalid input: expected string, received undefined", "Too small: expected string to have >=1
// characters", "Invalid email address"); anything else is a message we wrote and is kept.
const BUILT_IN = /^(Invalid|Too (small|big)|Expected|Required|Unrecognized)/;

export function plainZodMessage(issue: ZodIssue | undefined): string {
  if (!issue) return 'Something in the form is not right.';
  if (!BUILT_IN.test(issue.message)) return sentence(issue.message);
  const name = field(issue);
  switch (issue.code) {
    case 'invalid_type':
      return /received (undefined|null)\b/.test(issue.message) ? `Fill in the ${name}.` : `The ${name} is not right.`;
    case 'too_small':
      if (issue.origin === 'string') return Number(issue.minimum) <= 1 ? `Fill in the ${name}.` : `The ${name} needs at least ${issue.minimum} characters.`;
      if (issue.origin === 'array' || issue.origin === 'set') return Number(issue.minimum) <= 1 ? `Choose at least one ${name}.` : `Choose at least ${issue.minimum} ${name}.`;
      return `The ${name} must be at least ${issue.minimum}.`;
    case 'too_big':
      if (issue.origin === 'string') return `The ${name} can be at most ${issue.maximum} characters.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Choose at most ${issue.maximum} ${name}.`;
      return `The ${name} can be at most ${issue.maximum}.`;
    case 'invalid_format':
      return issue.format === 'email' ? 'That email address does not look right.' : issue.format === 'url' ? 'That address does not look right.' : `The ${name} is not in the right form.`;
    case 'invalid_value':
      return `Choose one of the options for ${name}.`;
    default:
      return `The ${name} is not right.`;
  }
}
