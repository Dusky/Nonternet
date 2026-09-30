import { createHmac } from 'node:crypto';

// Everything shared between core and Ergo comes from one IRC_SECRET (docs/08): the auth-script's
// bearer token, the Ergo HTTP API token and the bot's password. Each is derived, so leaking one
// does not give away the others.
export interface IrcSecrets { authToken: string; apiToken: string; botPassword: string }

export function ircSecrets(secret: string): IrcSecrets {
  if (secret.length < 32) throw new Error('IRC_SECRET must be at least 32 characters');
  const derive = (purpose: string) => createHmac('sha256', secret).update(`irc:${purpose}`).digest('base64url');
  return { authToken: derive('auth-script'), apiToken: derive('api'), botPassword: derive('bot') };
}

export const BOT_NICK = 'sitebot'; // reserved in @app/shared, so no user can take it

export interface IrcDeps {
  secrets: IrcSecrets;
  host: string;      // where the bot connects (Ergo's plain listener on the private network)
  port: number;
  apiUrl: string;    // Ergo's HTTP API, e.g. http://ergo:8089
}
