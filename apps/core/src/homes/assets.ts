// The asset library (docs/07): dividers, 88x31 buttons, backgrounds and signs in the spirit of the
// early web. Every one is drawn here as SVG, written for this project, so there is nothing to
// license and nothing that names the site. Someone who adds one gets their own copy in their files.
export interface Asset { id: string; title: string; category: 'divider' | 'button' | 'background' | 'sign'; width: number; height: number; svg: string }

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
const FONT = 'font-family="Verdana, Geneva, sans-serif"';

// An 88x31 button: a beveled box with two lines of text.
const button = (id: string, title: string, top: string, bottom: string, bg: string, fg: string): Asset => ({
  id, title, category: 'button', width: 88, height: 31,
  svg: svg(88, 31,
    `<rect width="88" height="31" fill="${bg}"/><rect x=".5" y=".5" width="87" height="30" fill="none" stroke="#fff" stroke-opacity=".75"/>` +
    `<path d="M1 30.5h86.5V1" fill="none" stroke="#000" stroke-opacity=".5"/>` +
    `<text x="44" y="13" text-anchor="middle" ${FONT} font-size="9" font-weight="bold" fill="${fg}">${top}</text>` +
    `<text x="44" y="24" text-anchor="middle" ${FONT} font-size="9" fill="${fg}">${bottom}</text>`),
});

const stars = (n: number, w: number, h: number, seed: number): string => {
  let x = seed;
  const rnd = () => (x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return Array.from({ length: n }, () => `<circle cx="${Math.floor(rnd() * w)}" cy="${Math.floor(rnd() * h)}" r="${(0.6 + rnd() * 1.1).toFixed(1)}" fill="#fff" fill-opacity="${(0.5 + rnd() * 0.5).toFixed(2)}"/>`).join('');
};

export const ASSETS: Asset[] = [
  {
    id: 'divider-rainbow', title: 'Rainbow bar', category: 'divider', width: 480, height: 8,
    svg: svg(480, 8, ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'].map((c, i) => `<rect x="${i * 80}" width="80" height="8" fill="${c}"/>`).join('')),
  },
  {
    id: 'divider-stars', title: 'Row of stars', category: 'divider', width: 480, height: 20,
    svg: svg(480, 20, Array.from({ length: 12 }, (_, i) => `<path transform="translate(${20 + i * 40} 10)" d="M0-8 2.4-2.5 8-2.5 3.6 1 5.2 7 0 3.4-5.2 7-3.6 1-8-2.5-2.4-2.5Z" fill="${i % 2 ? '#f9a825' : '#ef6c00'}"/>`).join('')),
  },
  {
    id: 'divider-wave', title: 'Wavy line', category: 'divider', width: 480, height: 16,
    svg: svg(480, 16, `<path d="M0 8 ${Array.from({ length: 24 }, (_, i) => `q10 ${i % 2 ? 8 : -8} 20 0`).join(' ')}" fill="none" stroke="#1e88e5" stroke-width="3" stroke-linecap="round"/>`),
  },
  {
    id: 'divider-chain', title: 'Chain', category: 'divider', width: 480, height: 16,
    svg: svg(480, 16, Array.from({ length: 24 }, (_, i) => `<ellipse cx="${10 + i * 20}" cy="8" rx="9" ry="5" fill="none" stroke="#757575" stroke-width="2.5"/>`).join('')),
  },
  button('button-handmade', 'Made by hand', 'MADE BY', 'HAND', '#37474f', '#ffee58'),
  button('button-anywhere', 'Best viewed anywhere', 'BEST VIEWED', 'ANYWHERE', '#1b5e20', '#f1f8e9'),
  button('button-notracking', 'No tracking', 'NO TRACKING', 'HERE', '#4a148c', '#f3e5f5'),
  button('button-guestbook', 'Sign my guestbook', 'SIGN MY', 'GUESTBOOK', '#b71c1c', '#fff8e1'),
  button('button-webring', 'Part of a ring', 'PART OF A', 'WEB RING', '#0d47a1', '#e3f2fd'),
  button('button-under', 'Under construction', 'UNDER', 'CONSTRUCTION', '#f57f17', '#212121'),
  {
    id: 'bg-stars', title: 'Night sky', category: 'background', width: 200, height: 200,
    svg: svg(200, 200, `<rect width="200" height="200" fill="#0b1437"/>${stars(28, 200, 200, 7)}`),
  },
  {
    id: 'bg-graph', title: 'Graph paper', category: 'background', width: 40, height: 40,
    svg: svg(40, 40, `<rect width="40" height="40" fill="#fbfff5"/><path d="M0 .5H40M.5 0V40" stroke="#9ccc65" stroke-width="1"/><path d="M0 20.5H40M20.5 0V40" stroke="#c5e1a5" stroke-width="1"/>`),
  },
  {
    id: 'bg-checker', title: 'Checkerboard', category: 'background', width: 40, height: 40,
    svg: svg(40, 40, `<rect width="40" height="40" fill="#fff59d"/><rect width="20" height="20" fill="#ffcc80"/><rect x="20" y="20" width="20" height="20" fill="#ffcc80"/>`),
  },
  {
    id: 'sign-construction', title: 'Under construction sign', category: 'sign', width: 120, height: 90,
    svg: svg(120, 90,
      `<rect x="55" y="46" width="10" height="44" fill="#6d4c41"/><rect x="4" y="4" width="112" height="46" rx="4" fill="#fdd835" stroke="#212121" stroke-width="3"/>` +
      `<path d="M4 34 30 4h20L18 50H4Z M52 50 84 4h20L72 50Z" fill="#212121" fill-opacity=".85"/>` +
      `<text x="60" y="26" text-anchor="middle" ${FONT} font-size="10" font-weight="bold" fill="#212121">UNDER</text>` +
      `<text x="60" y="40" text-anchor="middle" ${FONT} font-size="9" font-weight="bold" fill="#212121">CONSTRUCTION</text>`),
  },
];
export const assetById = (id: string): Asset | undefined => ASSETS.find((a) => a.id === id);
