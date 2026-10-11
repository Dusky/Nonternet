import { describe, expect, it } from 'vitest';
import { deviceParts } from './device';

describe('deviceParts', () => {
  it('names common browsers and systems, and leaves the unknown empty', () => {
    expect(deviceParts('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toEqual({ browser: 'Firefox', os: 'Linux' });
    expect(deviceParts('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toEqual({ browser: 'Safari', os: 'iOS' });
    expect(deviceParts('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toEqual({ browser: 'Edge', os: 'Windows' });
    expect(deviceParts('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')).toEqual({ browser: 'Chrome', os: 'Android' });
    expect(deviceParts('curl/8.0')).toEqual({ browser: null, os: null });
  });
});
