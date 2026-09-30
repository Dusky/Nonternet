// Anything in core that changes what IRC should look like calls ircSyncSoon(); the running sync
// worker (if any) then makes a pass within a moment. Without a worker it does nothing.
let hook: () => void = () => undefined;
export const setSyncHook = (fn: () => void) => { hook = fn; };
export const ircSyncSoon = () => hook();

// The running worker, for the admin console (null when chat is off or in tests without Ergo).
import type { IrcSync } from './sync';
let current: IrcSync | null = null;
export const setCurrentSync = (s: IrcSync | null) => { current = s; };
export const currentSync = () => current;
