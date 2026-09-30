import type { Action } from '../art';
import type { Session } from '../session';
import { lastCallers, settings, who } from './people';
import { boards, newscan } from './boards';
import { homepages } from './homepages';
import { mail } from './mail';
import { rings } from './rings';
import { doors } from './doors';
import { qwk } from './qwk';

export type Screen = (s: Session) => Promise<void>;

export const SCREENS: Record<Action, Screen> = {
  boards,
  newscan,
  mail,
  rings,
  homepages,
  who,
  lastcallers: lastCallers,
  doors,
  qwk,
  settings,
  goodbye: async () => undefined,
};
