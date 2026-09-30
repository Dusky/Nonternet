import { createHmac } from 'node:crypto';

// Core and the MUD share one MUD_SECRET (docs/09). Two tokens are derived from it: one the MUD presents
// when it asks core to check a login, one core presents when it tells the MUD what changed.
export interface MudSecrets { authToken: string; controlToken: string }
export function mudSecrets(secret: string): MudSecrets {
  if (secret.length < 32) throw new Error('MUD_SECRET must be at least 32 characters');
  const derive = (purpose: string) => createHmac('sha256', secret).update(`mud:${purpose}`).digest('base64url');
  return { authToken: derive('auth'), controlToken: derive('control') };
}

export interface MudDeps {
  secrets: MudSecrets;
  url: string; // the MUD's internal web server, e.g. http://mud:4001 (never routed from outside)
}
