import { generate, generateSecret, generateURI, verify } from 'otplib';

// Thin wrapper so the rest of core doesn't depend on the library's API.
// Codes are accepted for the current 30 s step and one step either side (clock drift).
export const newTotpSecret = (): string => generateSecret();
export const totpUri = (issuer: string, label: string, secret: string): string => generateURI({ issuer, label, secret });
export async function checkTotp(secret: string, token: string): Promise<boolean> {
  return (await verify({ secret, token, epochTolerance: 30 })).valid;
}
// Tests use this to act as the user's authenticator app.
export const currentTotp = (secret: string): Promise<string> => generate({ secret });
