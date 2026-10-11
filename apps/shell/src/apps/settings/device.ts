// A short name for where a session is, from its browser's user agent: "Firefox on Linux". Only for showing; nothing
// depends on it, and an odd or missing user agent just reads as "a browser".
const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/SamsungBrowser\//, 'Samsung Internet'], [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'], [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'], [/Android/, 'Android'], [/CrOS/, 'ChromeOS'], [/Windows/, 'Windows'], [/Mac OS X|Macintosh/, 'macOS'], [/Linux/, 'Linux'],
];

export function deviceParts(ua: string): { browser: string | null; os: string | null } {
  return { browser: BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null, os: SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null };
}
