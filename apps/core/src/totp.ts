import { generate, generateSecret, generateURI, verify } from 'otplib';

// Thin wrapper so the rest of core doesn't depend on the library's API. All functions take the
// current time as an argument (milliseconds), so tests can control the clock.
// Codes are accepted for the current 30 s step and one step either side (clock drift).
export const newTotpSecret = (): string => generateSecret();
export const totpUri = (issuer: string, label: string, secret: string): string => generateURI({ issuer, label, secret });

// The absolute 30 s time step the code belongs to, or null if it isn't valid right now.
// Callers store the step so the same code can't be used twice (see acceptTotp in accounts.ts).
export async function matchTotpStep(secret: string, token: string, nowMs: number): Promise<number | null> {
  const r = await verify({ secret, token, epoch: Math.floor(nowMs / 1000), epochTolerance: 30 });
  return r.valid && 'timeStep' in r && typeof r.timeStep === 'number' ? r.timeStep : null;
}

// Tests use this to act as the user's authenticator app.
export const currentTotp = (secret: string, nowMs: number): Promise<string> => generate({ secret, epoch: Math.floor(nowMs / 1000) });
