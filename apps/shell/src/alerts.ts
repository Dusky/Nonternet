// Alerts for a tab nobody is looking at (M9-B): a desktop notification and/or a short chime when something
// arrives. Both are off until the person turns them on, and they are kept on this device. A desktop
// notification says only that something came (never what), so nothing shows on a locked screen.
export interface AlertPrefs { desktop: boolean; sound: boolean }
const KEY = 'ui:alerts';

export function alertPrefs(): AlertPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AlertPrefs>;
    return { desktop: v.desktop === true, sound: v.sound === true };
  } catch { return { desktop: false, sound: false }; }
}
export function saveAlertPrefs(p: AlertPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* a convenience only */ }
}

export const desktopSupported = (): boolean => typeof Notification !== 'undefined';

// What to do when something arrives. A chime plays whatever the tab is doing; a desktop notification only when
// the tab is hidden or unfocused (if you are looking at it, the badge is enough). Neither more than once per
// few seconds, so a burst is one nudge.
export const MIN_GAP_MS = 4000;
export function decide(input: { prefs: AlertPrefs; permission: NotificationPermission | 'unsupported'; looking: boolean; sinceLastMs: number }): { chime: boolean; notify: boolean } {
  if (input.sinceLastMs < MIN_GAP_MS) return { chime: false, notify: false };
  return {
    chime: input.prefs.sound,
    notify: input.prefs.desktop && input.permission === 'granted' && !input.looking,
  };
}

let ctx: AudioContext | null = null;
let lastAt = 0;

// Browsers only allow sound after the person has used the page once, so the first click or key unlocks it.
export function unlockAudio(): void {
  if (ctx || typeof AudioContext === 'undefined') return;
  try { ctx = new AudioContext(); } catch { ctx = null; }
}
if (typeof window !== 'undefined') {
  const once = () => { unlockAudio(); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}

// Two soft notes, a rising third: about a third of a second, quiet.
export function playChime(): void {
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const now = ctx.currentTime;
  [[659.25, 0], [880, 0.12]].forEach(([freq, at]) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq!;
    gain.gain.setValueAtTime(0, now + at!);
    gain.gain.linearRampToValueAtTime(0.07, now + at! + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at! + 0.22);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + at!);
    osc.stop(now + at! + 0.25);
  });
}

export async function askDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!desktopSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}

// Called when a hint says something arrived. `text` is the words for the notification, `onClick` what opening it does.
export function arrive(text: { title: string; body: string; tag: string }, onClick: () => void): void {
  const permission = desktopSupported() ? Notification.permission : 'unsupported';
  const looking = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
  const now = Date.now();
  const d = decide({ prefs: alertPrefs(), permission, looking, sinceLastMs: now - lastAt });
  if (!d.chime && !d.notify) return;
  lastAt = now;
  if (d.chime) playChime();
  if (d.notify) {
    try {
      const n = new Notification(text.title, { body: text.body, tag: text.tag, icon: undefined });
      n.onclick = () => { window.focus(); onClick(); n.close(); };
    } catch { /* some browsers only allow these from a service worker; the chime and the badge still work */ }
  }
}
