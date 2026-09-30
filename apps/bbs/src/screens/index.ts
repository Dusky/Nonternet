import type { Action } from '../art';
import type { Session } from '../session';
import { lastCallers, settings, who } from './people';
import { boards, newscan } from './boards';
import { homepages } from './homepages';
import { mail } from './mail';
import { rings } from './rings';

export type Screen = (s: Session) => Promise<void>;

const later = (what: string): Screen => async (s) => { s.term.line(`${what} is not ready yet. Use the web for now: ${s.ctx.siteUrl}`); };

export const SCREENS: Record<Action, Screen> = {
  boards,
  newscan,
  mail,
  rings,
  homepages,
  who,
  lastcallers: lastCallers,
  doors: later('Door games'),
  qwk: later('QWK offline mail'),
  settings,
  goodbye: async () => undefined,
};
