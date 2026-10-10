import { z } from 'zod';

// Everything the installer asks (docs/19). The wizard fills this in step by step; `--answers file.yaml` gives it all at
// once. It never holds the site's own secrets: those are made by the installer and written to .env only. It may hold
// an SMTP address with a password and backup storage keys, so an answers file is private like .env.

export const PROFILES = ['web', 'web-chat', 'everything', 'custom'] as const;
export type Profile = (typeof PROFILES)[number];
export const SERVICE_NAMES = ['irc', 'bbs', 'mud', 'gopher', 'finger', 'gemini'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

const domain = z.string().trim().toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'a domain like example.net');

export const answersSchema = z.object({
  profile: z.enum(PROFILES).default('web-chat'),
  site: z.object({
    name: z.string().trim().min(1).max(40),
    short_name: z.string().trim().regex(/^[a-z][a-z0-9-]{1,19}$/, '2–20 lowercase letters, digits or -, starting with a letter'),
    domain,
    homes_domain: domain,
  }).refine((s) => s.homes_domain !== s.domain && !s.homes_domain.endsWith(`.${s.domain}`) && !s.domain.endsWith(`.${s.homes_domain}`),
    { path: ['homes_domain'], message: 'homepages need a separate domain of their own, not a name under the site’s domain' }),
  // Only for "custom": the other profiles decide this themselves.
  services: z.object(Object.fromEntries(SERVICE_NAMES.map((s) => [s, z.boolean().optional()])) as Record<ServiceName, z.ZodOptional<z.ZodBoolean>>).default({}),
  signup: z.object({ mode: z.enum(['open', 'invite', 'application']).default('invite'), minimum_age: z.number().int().min(0).max(120).default(16) }).prefault({}),
  limits: z.object({
    homepage_quota_mb: z.number().positive().max(100_000).default(50),
    file_quota_mb: z.number().positive().max(1_000_000).default(250),
    file_max_mb: z.number().positive().max(10_000).default(25),
  }).prefault({}),
  mail: z.object({
    smtp_url: z.string().trim().regex(/^smtps?:\/\/.+/, 'an address like smtp://user:pass@mail.example.net:587'),
    from: z.string().trim().email(),
  }),
  admin: z.object({ via: z.enum(['web', 'cli']).default('web') }).prefault({}),
  backups: z.object({
    to: z.enum(['local', 'rsync', 's3']).default('local'),
    rsync_target: z.string().trim().optional(),   // user@host:/path
    s3: z.object({ endpoint: z.string().url(), bucket: z.string().min(3), region: z.string().default('auto'), access_key_id: z.string().optional(), secret_access_key: z.string().optional() }).optional(),
    keep_days: z.number().int().min(1).max(3650).default(30),
    hour: z.number().int().min(0).max(23).default(3),
  }).prefault({})
    .refine((b) => b.to !== 'rsync' || Boolean(b.rsync_target), { path: ['rsync_target'], message: 'where to copy backups to, like backup@other-host:/srv/backups' })
    .refine((b) => b.to !== 's3' || Boolean(b.s3), { path: ['s3'], message: 'the storage endpoint and bucket' }),
  extras: z.object({
    agent: z.boolean().default(true),            // updates and restarts from the admin console
    wiki_starter: z.boolean().default(true),     // the wiki's starter help pages
    demo: z.boolean().default(false),            // sample people and posts: for a staging site only
    firewall: z.boolean().default(false),        // ufw: only the ports this site uses
    unattended_upgrades: z.boolean().default(false),
    fail2ban: z.boolean().default(false),
  }).prefault({}),
  ports: z.object({ bbs_ssh_public: z.number().int().min(1).max(65535).default(2222) }).prefault({}),
});
export type Answers = z.infer<typeof answersSchema>;
export type AnswersInput = z.input<typeof answersSchema>;

// What each profile turns on. "custom" starts from "web-chat" and then takes the answers' own choices.
export const PROFILE_SERVICES: Record<Exclude<Profile, 'custom'>, Record<ServiceName, boolean>> = {
  web: { irc: false, bbs: false, mud: false, gopher: false, finger: false, gemini: false },
  'web-chat': { irc: true, bbs: false, mud: false, gopher: false, finger: false, gemini: false },
  everything: { irc: true, bbs: true, mud: true, gopher: true, finger: true, gemini: true },
};

export const PROFILE_TEXT: Record<Profile, { title: string; about: string }> = {
  web: { title: 'Just the web', about: 'Boards, mail, homepages, the wiki and the rest of the desktop. Fewest ports and moving parts.' },
  'web-chat': { title: 'Web and chat', about: 'Everything on the web, plus the IRC chat server (port 6697).' },
  everything: { title: 'The whole thing', about: 'Web, chat, the BBS (telnet and SSH), the MUD, and the Gopher, Gemini and finger mirrors.' },
  custom: { title: 'Choose for myself', about: 'Pick each service and setting.' },
};

export function servicesFor(a: Pick<Answers, 'profile' | 'services'>): Record<ServiceName, boolean> {
  const base = PROFILE_SERVICES[a.profile === 'custom' ? 'web-chat' : a.profile];
  if (a.profile !== 'custom') return { ...base };
  return Object.fromEntries(SERVICE_NAMES.map((s) => [s, a.services[s] ?? base[s]])) as Record<ServiceName, boolean>;
}

// The public ports each service needs (docs/19), for the port checks, the firewall and the summary.
export function portsFor(services: Record<ServiceName, boolean>, sshPort: number): { port: number; what: string }[] {
  const out = [{ port: 80, what: 'web (certificates)' }, { port: 443, what: 'web' }];
  if (services.irc) out.push({ port: 6697, what: 'chat (IRC over TLS)' });
  if (services.bbs) out.push({ port: 23, what: 'BBS telnet' }, { port: sshPort, what: 'BBS SSH' });
  if (services.mud) out.push({ port: 4000, what: 'MUD' });
  if (services.gopher) out.push({ port: 70, what: 'Gopher' });
  if (services.finger) out.push({ port: 79, what: 'finger' });
  if (services.gemini) out.push({ port: 1965, what: 'Gemini' });
  return out;
}
