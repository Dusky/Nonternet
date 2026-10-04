import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { plainZodMessage } from './zod-message';

const msg = (schema: z.ZodTypeAny, value: unknown) => plainZodMessage(schema.safeParse(value).error?.issues[0]);

describe('form errors in plain words', () => {
  it("turns zod's own messages into plain sentences that name the field", () => {
    const form = z.object({ password: z.string().min(1).max(200), terminal_password: z.string().min(10), email: z.string().email(), options: z.array(z.string()).min(2), count: z.number().max(5) });
    const ok = { password: 'x', terminal_password: 'long enough', email: 'a@example.org', options: ['a', 'b'], count: 1 };
    expect(msg(form, { ...ok, password: '' })).toBe('Fill in the password.');
    expect(msg(form, { ...ok, password: undefined })).toBe('Fill in the password.');
    expect(msg(form, { ...ok, terminal_password: 'short' })).toBe('The terminal password needs at least 10 characters.');
    expect(msg(form, { ...ok, email: 'nope' })).toBe('That email address does not look right.');
    expect(msg(form, { ...ok, options: ['a'] })).toBe('Choose at least 2 options.');
    expect(msg(form, { ...ok, count: 9 })).toBe('The count can be at most 5.');
  });

  it('keeps our own messages, as sentences', () => {
    expect(msg(z.string().regex(/^\d{6}$/, 'enter the 6-digit code'), 'abc')).toBe('Enter the 6-digit code.');
  });
});
