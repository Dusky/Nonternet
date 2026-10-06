import type { CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import type { PublicSite } from '@app/shared';
import { useT } from '../hooks';

// The site's drawings (docs/10). Built from shapes in the theme's own colours, the same thick lines and hard
// shadows as its buttons and cards, so each one changes with the theme. All decorative: the words beside them say
// everything, so screen readers skip them.

export type SpotKind = 'mail' | 'notebook' | 'folder' | 'ring';

// A small drawing for an empty place. Each shape is drawn twice: once offset in the line colour (the shadow), then
// in place.
export function Spot({ kind }: { kind: SpotKind }) {
  return (
    <svg className={`spot spot-${kind}`} viewBox="0 0 128 96" width="128" height="96" aria-hidden="true" focusable="false">
      {SPOTS[kind]}
    </svg>
  );
}

const shadow = (d: string) => <path className="sp-ink" d={d} transform="translate(5 5)" />;

const SPOTS: Record<SpotKind, React.ReactNode> = {
  // An envelope with its flap open and nothing inside, and a round "0" sticker.
  mail: (
    <>
      {shadow('M20 34h80v50H20z')}
      <path className="sp-s2 sp-line" d="M20 34h80v50H20z" />
      <path className="sp-surface sp-line" d="M20 34 60 8l40 26" />
      <path className="sp-line" d="M20 34l40 28 40-28M20 84l28-24M100 84 72 60" />
      <circle className="sp-ink" cx="105" cy="31" r="12" />
      <circle className="sp-pop sp-line" cx="102" cy="28" r="12" />
      <text className="sp-label" x="102" y="32.5" textAnchor="middle">0</text>
    </>
  ),
  // An open notebook, the left page ruled and the right page blank, with a pencil across it.
  notebook: (
    <>
      {shadow('M14 20q23-8 48 0v62q-25-8-48 0zM66 20q25-8 48 0v62q-23-8-48 0z')}
      <path className="sp-surface sp-line" d="M14 20q23-8 48 0v62q-25-8-48 0z" />
      <path className="sp-s5 sp-line" d="M66 20q25-8 48 0v62q-23-8-48 0z" />
      <path className="sp-thin" d="M22 34q16-5 32 0M22 46q16-5 32 0M22 58q16-5 32 0M22 70q10-3 18-1" />
      <path className="sp-ink" d="M80 77 108 30l7 4-28 47-9 3z" transform="translate(3 3)" />
      <path className="sp-pop sp-line" d="M80 77 108 30l7 4-28 47-9 3z" />
      <path className="sp-line" d="M104 37l7 4M80 77l3 6" />
    </>
  ),
  // A folder with its front open and a dashed outline where a file would be.
  folder: (
    <>
      {shadow('M16 22h32l8 8h56v54H16z')}
      <path className="sp-s1 sp-line" d="M16 22h32l8 8h56v54H16z" />
      <path className="sp-dash" d="M30 18h52v40H30z" />
      <path className="sp-ink" d="M14 44h100l-8 40H22z" transform="translate(4 4)" />
      <path className="sp-s1 sp-line" d="M14 44h100l-8 40H22z" />
      <path className="sp-thin" d="M48 62h32" />
    </>
  ),
  // A ring of sites, one of them waiting to be filled in.
  ring: (
    <>
      <ellipse className="sp-orbit" cx="64" cy="50" rx="44" ry="32" />
      {[[64, 18], [104, 38], [96, 74], [32, 74], [24, 38]].map(([x, y], i) => (
        <g key={i}>
          <rect className="sp-ink" x={x! - 9 + 4} y={y! - 9 + 4} width="18" height="18" />
          <rect className={`${i === 0 ? 'sp-pop' : i === 3 ? 'sp-surface sp-empty' : 'sp-s4'} sp-line`} x={x! - 9} y={y! - 9} width="18" height="18" />
        </g>
      ))}
      <path className="sp-line" d="M27 74h10M32 69v10" />
    </>
  ),
};

// The not-found page: a window that has gone missing, with the ones dragged before it still on screen.
export function LostWindows() {
  const { pathname } = useLocation();
  return (
    <div className="lost-stack" aria-hidden="true">
      <div className="lost-win" style={{ '--n': 2 } as CSSProperties} />
      <div className="lost-win" style={{ '--n': 1 } as CSSProperties} />
      <div className="lost-win lost-front" style={{ '--n': 0 } as CSSProperties}>
        <div className="mini-title"><span>404</span><i /></div>
        <div className="lost-body">
          <code className="lost-path">{pathname.length > 40 ? `${pathname.slice(0, 39)}…` : pathname}</code>
          <span className="lost-code">404</span>
        </div>
      </div>
    </div>
  );
}

interface SceneThread { id: string; subject: string; board: { name: string } }

// The front page: the site as a small desktop, with the newest threads in a Boards window, a Terminal dialling in
// and a Chat window. Made from the site's own words and config, never a picture.
export function DesktopScene({ site, threads }: { site: PublicSite; threads: SceneThread[] }) {
  const t = useT();
  const dial = site.services.bbs ? `telnet ${site.bbs.host}` : site.services.mud ? `telnet ${site.mud.host} ${site.mud.port}` : site.domain;
  const rows = threads.slice(0, 4);
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene-win scene-boards">
        <div className="mini-title"><span>{t('app.boards')}</span><i /></div>
        <ul>
          {rows.length ? rows.map((r) => <li key={r.id}><b>{r.subject}</b><small>{r.board.name}</small></li>)
            : [70, 52, 84, 60].map((w, i) => <li key={i}><span className="bar" style={{ width: `${w}%` }} /><span className="bar bar-dim" style={{ width: `${w / 2}%` }} /></li>)}
        </ul>
      </div>
      <div className="scene-win scene-term">
        <div className="mini-title"><span>{t('app.terminal')}</span><i /></div>
        <pre>{`$ ${dial}\nCONNECT 33600\n\n  ${site.name}\n\n> `}<span className="scene-caret" /></pre>
      </div>
      <div className="scene-win scene-chat">
        <div className="mini-title"><span>{site.services.irc ? site.irc.lobby : t('app.chat')}</span><i /></div>
        <div className="scene-bubbles">
          <span className="bubble" style={{ width: '64%' }} />
          <span className="bubble bubble-me" style={{ width: '46%' }} />
          <span className="bubble" style={{ width: '78%' }} />
        </div>
      </div>
      <span className="scene-sticker" />
    </div>
  );
}

// The rings page: sites joined in a loop, and a light going round from one to the next, as a webring does.
const NODES = 9;
export function RingOrbit() {
  const at = (i: number) => {
    const a = (i / NODES) * Math.PI * 2 - Math.PI / 2;
    return [300 + Math.cos(a) * 250, 64 + Math.sin(a) * 44] as const;
  };
  return (
    <svg className="ring-orbit" viewBox="0 0 600 132" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <ellipse className="sp-orbit" cx="300" cy="64" rx="250" ry="44" />
      {Array.from({ length: NODES }, (_, i) => {
        const [x, y] = at(i);
        return (
          <g key={i} className={i === 0 ? 'ring-node ring-here' : 'ring-node'} style={{ '--i': i } as CSSProperties}>
            <rect className="sp-ink" x={x - 11 + 4} y={y - 11 + 4} width="22" height="22" />
            <rect className="sp-line ring-node-face" x={x - 11} y={y - 11} width="22" height="22" />
          </g>
        );
      })}
    </svg>
  );
}

// The MUD's tips: the tower, in the characters a MUD would draw it with.
export const TOWER = String.raw`    |>
   /^\
  |[ ]|
  |   |
  |[ ]|
 _|___|_`;
