import { z } from 'zod';

// Settings for the chat and MUD clients, kept on the account (decided 2026-10-02): they follow the person to any
// browser and are part of their export (docs/12). Rules only, never code: every action is one of a fixed set.

const id = z.string().regex(/^[a-z0-9]{1,16}$/);
const group = z.string().trim().max(30).default('');
const commands = z.string().max(1000); // one or more commands, split on the separator

// ---------------------------------------------------------------- chat
export const chatClientSchema = z.object({
  ignore: z.array(z.string().trim().min(1).max(64)).max(200).default([]),   // nicks whose lines are hidden
  highlights: z.array(z.string().trim().min(1).max(64)).max(50).default([]), // words that count as a mention
}).prefault({});
export type ChatClient = z.infer<typeof chatClientSchema>;

// ---------------------------------------------------------------- MUD
export const HIGHLIGHT_COLOURS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'pop'] as const;
export const MATCH_KINDS = ['contains', 'start', 'exact', 'regex'] as const;
export const mudActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send'), text: commands }),                                  // send commands ($1… are captures)
  z.object({ type: z.literal('highlight'), colour: z.enum(HIGHLIGHT_COLOURS), line: z.boolean().default(false) }),
  z.object({ type: z.literal('gag') }),                                                    // hide the line
  z.object({ type: z.literal('capture'), window: z.string().trim().min(1).max(30) }),    // copy the line to a side window
  z.object({ type: z.literal('beep') }),
  z.object({ type: z.literal('notify') }),                                                 // a desktop notification if the tab is hidden
  z.object({ type: z.literal('set'), name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,30}$/), value: z.string().max(200) }),
]);
export type MudAction = z.infer<typeof mudActionSchema>;

export const mudAliasSchema = z.object({ id, pattern: z.string().min(1).max(200), match: z.enum(['exact', 'start', 'regex']).default('start'), send: commands, group, enabled: z.boolean().default(true) });
export const mudTriggerSchema = z.object({ id, pattern: z.string().min(1).max(300), match: z.enum(MATCH_KINDS).default('contains'), actions: z.array(mudActionSchema).min(1).max(8), group, enabled: z.boolean().default(true) });
export const mudTimerSchema = z.object({ id, label: z.string().trim().max(40).default(''), every: z.number().int().min(1).max(3600), send: commands, group, enabled: z.boolean().default(false) });
export const mudKeySchema = z.object({ id, key: z.string().min(1).max(40), send: commands, enabled: z.boolean().default(true) });
export const mudButtonSchema = z.object({ id, label: z.string().trim().min(1).max(20), send: commands });
export type MudAlias = z.infer<typeof mudAliasSchema>;
export type MudTrigger = z.infer<typeof mudTriggerSchema>;
export type MudTimer = z.infer<typeof mudTimerSchema>;
export type MudKey = z.infer<typeof mudKeySchema>;
export type MudButton = z.infer<typeof mudButtonSchema>;

// What a new player starts with under the log, so a phone can play without typing everything. They are the person's
// own from the start: rename, change or remove them in the editor (game commands, so not translated).
export const DEFAULT_MUD_BUTTONS: MudButton[] = [
  { id: 'look', label: 'Look', send: 'look' }, { id: 'inv', label: 'Inventory', send: 'inventory' },
  { id: 'help', label: 'Help', send: 'help' }, { id: 'tower', label: 'Tower', send: 'season' },
];

export const mudClientSchema = z.object({
  aliases: z.array(mudAliasSchema).max(200).default([]),
  triggers: z.array(mudTriggerSchema).max(200).default([]),
  timers: z.array(mudTimerSchema).max(20).default([]),
  keys: z.array(mudKeySchema).max(100).default([]),
  buttons: z.array(mudButtonSchema).max(24).default(() => DEFAULT_MUD_BUTTONS.map((b) => ({ ...b }))),
  variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,30}$/), z.string().max(200)).prefault({}),
  history: z.array(z.string().max(500)).max(200).default([]), // recent commands, newest first
  options: z.object({
    separator: z.string().min(1).max(2).default(';'),   // splits several commands typed on one line
    speedwalk: z.boolean().default(true),                // "#3n 2e" walks
    echo: z.boolean().default(true),                     // show what you typed in the log
    numpad: z.boolean().default(true),                   // the number pad walks (8 north, 2 south…)
    panel: z.boolean().default(true),                    // gauges, map and windows beside the log
    screenreader: z.boolean().default(false),            // ask the game for plain text (no drawn maps)
    fontSize: z.number().int().min(11).max(24).default(15),
  }).prefault({}),
}).prefault({});
export type MudClient = z.infer<typeof mudClientSchema>;

// ---------------------------------------------------------------- desktop
// Where the icons sit and what the person has hidden (docs/10). An item key is an app id ('boards', 'app:todo'); later
// shortcuts and widgets add their own keys. Nothing here is code: positions, ids and a few words.
export const DESKTOP_MAX_COL = 5;
export const DESKTOP_MAX_ROW = 39;
const itemKey = z.string().regex(/^[A-Za-z0-9:_.-]{1,64}$/);
export const desktopClientSchema = z.object({
  positions: z.record(itemKey, z.object({ col: z.number().int().min(0).max(DESKTOP_MAX_COL), row: z.number().int().min(0).max(DESKTOP_MAX_ROW) })).default({})
    .refine((p) => Object.keys(p).length <= 100, 'Too many icons are placed.'),   // big screens: where each icon sits
  phone_order: z.array(itemKey).max(100).default([]),                              // phones: the order of the app grid
  hidden: z.array(itemKey).max(100).default([])                                    // apps left off the desktop and the phone grid
    .refine((h) => !h.includes('settings'), 'Settings cannot be hidden, so there is always a way back.'),
}).prefault({});
export type DesktopClient = z.infer<typeof desktopClientSchema>;

export const CLIENT_SCHEMAS = { chat: chatClientSchema, mud: mudClientSchema, desktop: desktopClientSchema } as const;
export type ClientName = keyof typeof CLIENT_SCHEMAS;
export const CLIENT_NAMES = Object.keys(CLIENT_SCHEMAS) as ClientName[];
export const CLIENT_SETTINGS_MAX_BYTES = 262_144;
