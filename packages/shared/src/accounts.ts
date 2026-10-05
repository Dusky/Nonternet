import { themeSchema, themeVariantSchema } from './profile';
import { z } from 'zod';

// Handle rules from docs/02: unique, case-insensitive, 2–20 chars [A-Za-z0-9_-], starts with a letter.
export const HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,19}$/;
export const handleSchema = z.string().regex(HANDLE_PATTERN, 'handle must be 2–20 characters: letters, digits, _ or -, starting with a letter');

// Reserved handles (docs/02). The site short name is reserved too, so callers pass it in.
const RESERVED = ['admin', 'root', 'sysop', 'guest', 'all', 'postmaster', 'abuse', 'support', 'service', 'system', 'moderator', 'mod',
  // IRC service names (docs/08): Ergo's own services and the site's bot.
  'chanserv', 'nickserv', 'histserv', 'hostserv', 'sitebot'];
export function isReservedHandle(handle: string, shortName: string): boolean {
  const h = handle.toLowerCase();
  return RESERVED.includes(h) || h === shortName.toLowerCase();
}

// PROPOSED (docs/02 says argon2id but sets no policy): length is what matters, no composition rules.
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const passwordSchema = z.string().min(PASSWORD_MIN, `password must be at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX);

export const APPLICATION_MIN = 20;
export const APPLICATION_MAX = 1000;

// One plain message, so the browser and the server say the same thing.
export const emailSchema = z.string().email('that email address does not look right').max(254);

export const signupInputSchema = z.object({
  handle: handleSchema,
  email: emailSchema,
  password: passwordSchema,
  display_name: z.string().trim().min(1).max(60).optional(),
  invite: z.string().trim().min(1).max(64).optional(),
  // Ticked at signup when the site asks for a minimum age (docs/02).
  age_confirmed: z.boolean().optional(),
  // Signing up from the terminal (docs/04) sets the terminal password too; it must differ from the website one.
  terminal_password: z.string().min(10).max(128).optional(),
  // Sign-up by application (docs/02): why the person wants to join, read by the admins.
  application: z.string().trim().min(APPLICATION_MIN, `say a little more: at least ${APPLICATION_MIN} characters`).max(APPLICATION_MAX).optional(),
});
export type SignupInput = z.infer<typeof signupInputSchema>;

// e.g. k3m9x-2qf7a. Lower-case letters and digits without look-alikes.
export const RECOVERY_CODE_PATTERN = /^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });

export const changePasswordSchema = z.object({ current_password: z.string().min(1).max(PASSWORD_MAX), new_password: passwordSchema });

export const loginInputSchema = z.object({
  identifier: z.string().trim().min(1).max(254), // handle or email
  password: z.string().min(1).max(PASSWORD_MAX),
  totp: z.string().trim().regex(/^\d{6}$/).optional(),
  // Instead of a TOTP code: one of the single-use codes shown when two-factor was turned on.
  recovery_code: z.string().trim().toLowerCase().regex(RECOVERY_CODE_PATTERN).optional(),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

// Passkeys (docs/02). The browser's answer is checked by the server's WebAuthn library, so here it is only
// limited in size; its shape is the library's business.
export const PASSKEY_NAME_MAX = 60;
export const passkeyNameSchema = z.string().trim().max(PASSKEY_NAME_MAX, `keep the name to ${PASSKEY_NAME_MAX} characters`);
const webauthnAnswer = z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 16_000, 'that answer is too big');
const challengeId = z.string().min(10).max(64);
export const passkeyOptionsSchema = z.object({ password: z.string().min(1, 'enter your password').max(PASSWORD_MAX) });
export const passkeyAddSchema = z.object({ challenge_id: challengeId, name: passkeyNameSchema, response: webauthnAnswer });
export const passkeyRenameSchema = z.object({ name: passkeyNameSchema.min(1, 'give it a name') });
export const passkeyLoginSchema = z.object({ challenge_id: challengeId, response: webauthnAnswer });
export const passkeySchema = z.object({ id: z.string(), name: z.string(), created_at: z.string(), last_used_at: z.string().nullable(), backed_up: z.boolean() });
export type Passkey = z.infer<typeof passkeySchema>;

// What /me returns.
export const meSchema = z.object({
  id: z.string(),
  handle: z.string(),
  display_name: z.string().nullable(),
  bio: z.string().nullable(),
  theme: themeSchema.nullable(),
  theme_variant: themeVariantSchema.nullable(),
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
