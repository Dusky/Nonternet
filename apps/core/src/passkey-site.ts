// The site a passkey belongs to is the hostname people visit. Browsers refuse an IP address there, so a local
// address (the tests, a dev machine on 127.0.0.1) uses localhost on the same port instead.
export function passkeySite(publicUrl: string): { rpID: string; origin: string } {
  const url = new URL(publicUrl);
  if (/^(127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname)) {
    url.hostname = 'localhost';
    return { rpID: 'localhost', origin: url.origin };
  }
  return { rpID: url.hostname, origin: url.origin };
}
