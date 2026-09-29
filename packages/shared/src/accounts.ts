import { z } from 'zod';

// Handle rules from docs/02: unique, case-insensitive, 2–20 chars [A-Za-z0-9_-], starts with a letter.
export const HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,19}$/;
export const handleSchema = z.string().regex(HANDLE_PATTERN, 'handle must be 2–20 characters: letters, digits, _ or -, starting with a letter');

// Reserved handles (docs/02). The site short name is reserved too, so callers pass it in.
const RESERVED = ['admin', 'root', 'sysop', 'guest', 'all', 'postmaster', 'abuse', 'support', 'service', 'system', 'moderator', 'mod'];
export function isReservedHandle(handle: string, shortName: string): boolean {
  const h = handle.toLowerCase();
  return RESERVED.includes(h) || h === shortName.toLowerCase();
}

// PROPOSED (docs/02 says argon2id but sets no policy): length is what matters, no composition rules.
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const passwordSchema = z.string().min(PASSWORD_MIN, `password must be at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX);

export const signupInputSchema = z.object({
  handle: handleSchema,
  email: z.string().email().max(254),
  password: passwordSchema,
  display_name: z.string().trim().min(1).max(60).optional(),
  invite: z.string().trim().min(1).max(64).optional(),
});
export type SignupInput = z.infer<typeof signupInputSchema>;

// e.g. k3m9x-2qf7a. Lower-case letters and digits without look-alikes.
export const RECOVERY_CODE_PATTERN = /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/;

export const forgotPasswordSchema = z.object({ email: z.string().email().max(254) });
export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });

export const loginInputSchema = z.object({
  identifier: z.string().trim().min(1).max(254), // handle or email
  password: z.string().min(1).max(PASSWORD_MAX),
  totp: z.string().trim().regex(/^\d{6}$/).optional(),
  // Instead of a TOTP code: one of the single-use codes shown when two-factor was turned on.
  recovery_code: z.string().trim().toLowerCase().regex(RECOVERY_CODE_PATTERN).optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

// What /me returns.
export const meSchema = z.object({
  id: z.string(),
  handle: z.string(),
  display_name: z.string().nullable(),
  role: z.enum(['guest', 'user', 'trusted', 'admin']),
  email: z.string(),
  email_verified: z.boolean(),
  totp_enabled: z.boolean(),
  recovery_codes_remaining: z.number().int().nonnegative(),
  role_rev: z.number().int().nonnegative(),
  ops: z.array(z.string()),
  // An admin who has not set up TOTP yet: only /me and the TOTP setup calls work.
  limited: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;
