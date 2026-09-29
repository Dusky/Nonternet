import { z } from 'zod';

// Site roles (docs/03). One `role` value, read by every service.
export const ROLES = ['guest', 'user', 'trusted', 'admin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

// Scoped ops layered on top of a role.
export const OP_KINDS = ['board', 'ring', 'channel'] as const;
export type OpKind = (typeof OP_KINDS)[number];
