import { createHmac } from 'node:crypto';

// Core and the BBS share one BBS_SECRET (docs/04). The token derived from it is what the BBS presents on
// core's private /internal/bbs/* endpoints: signing callers in, reporting its nodes, logging calls.
export interface BbsDeps { authToken: string }
export function bbsSecrets(secret: string): BbsDeps {
  if (secret.length < 32) throw new Error('BBS_SECRET must be at least 32 characters');
  return { authToken: createHmac('sha256', secret).update('bbs:auth').digest('base64url') };
}
