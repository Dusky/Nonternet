import sharp from 'sharp';
import { ApiError } from '../errors';

// The 88x31 button maker (M9-E, docs/07). Someone types two short lines and picks two colours; the site draws the
// button as SVG (or PNG for places that want one). Everything is checked and escaped here, so nothing a visitor puts
// in the address can become markup, and nothing is fetched or stored.
export const BUTTON_LINE_MAX = 14;
const HEX = /^[0-9a-f]{6}$/i;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface ButtonSpec { top: string; bottom: string; fg: string; bg: string }

export function parseButton(q: { text?: string; fg?: string; bg?: string }): ButtonSpec {
  const raw = (q.text ?? '').normalize('NFC');
  if (/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/.test(raw.replace(/\|/g, ''))) throw new ApiError(400, 'bad_text', 'Use plain letters and digits.');
  const [top = '', bottom = '', extra] = raw.split('|').map((l) => l.trim());
  if (extra !== undefined) throw new ApiError(400, 'bad_text', 'A button has up to two lines. Separate them with |.');
  if (!top) throw new ApiError(400, 'bad_text', 'Give the button some text.');
  for (const l of [top, bottom]) if ([...l].length > BUTTON_LINE_MAX) throw new ApiError(400, 'bad_text', `Each line can be up to ${BUTTON_LINE_MAX} characters.`);
  const fg = (q.fg ?? 'ffffff').replace(/^#/, '');
  const bg = (q.bg ?? '37474f').replace(/^#/, '');
  if (!HEX.test(fg) || !HEX.test(bg)) throw new ApiError(400, 'bad_colour', 'Colours are six hex digits, like 37474f.');
  return { top, bottom, fg: fg.toLowerCase(), bg: bg.toLowerCase() };
}

export function buttonSvg(b: ButtonSpec): string {
  const y1 = b.bottom ? 13 : 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="31" viewBox="0 0 88 31" role="img" aria-label="${esc([b.top, b.bottom].filter(Boolean).join(' '))}">` +
    `<rect width="88" height="31" fill="#${b.bg}"/><rect x=".5" y=".5" width="87" height="30" fill="none" stroke="#fff" stroke-opacity=".75"/>` +
    `<path d="M1 30.5h86.5V1" fill="none" stroke="#000" stroke-opacity=".5"/>` +
    `<text x="44" y="${y1}" text-anchor="middle" font-family="Verdana, Geneva, sans-serif" font-size="9" font-weight="bold" fill="#${b.fg}">${esc(b.top)}</text>` +
    (b.bottom ? `<text x="44" y="24" text-anchor="middle" font-family="Verdana, Geneva, sans-serif" font-size="9" fill="#${b.fg}">${esc(b.bottom)}</text>` : '') +
    `</svg>\n`;
}

export const buttonPng = (b: ButtonSpec): Promise<Buffer> => sharp(Buffer.from(buttonSvg(b))).png().toBuffer();
