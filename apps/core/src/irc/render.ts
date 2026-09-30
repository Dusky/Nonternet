import bcrypt from 'bcryptjs';
import { stringify } from 'yaml';
import type { SiteConfig } from '@app/shared';
import { BOT_NICK, type IrcSecrets } from './secrets';

export interface RenderOptions {
  secrets: IrcSecrets;
  coreUrl: string;             // how the auth-script reaches core, e.g. http://core:3000
  authScript: string;          // path of services/irc/auth.sh inside Ergo's container
  plainListen: string;         // the bot's listener, private network only, e.g. ":6667"
  websocketListen: string;     // behind Caddy at /ws/irc, e.g. ":8097"
  apiListen: string;           // e.g. ":8089"
  websocketOrigins: string[];  // the site's own origin(s)
  tls?: { listen: string; cert: string; key: string }; // native clients, e.g. ":6697"
  datastore?: string;          // path of Ergo's own database
}

// Ergo's config, made from the site config (docs/08). The name and domain come from config, never
// from code. Accounts come from core through the auth-script; nobody registers on IRC itself.
export function renderErgoConfig(cfg: SiteConfig, o: RenderOptions): string {
  const listeners: Record<string, unknown> = {
    [o.plainListen]: {},
    [o.websocketListen]: { websocket: true },
  };
  if (o.tls) listeners[o.tls.listen] = { tls: { cert: o.tls.cert, key: o.tls.key } };
  const doc = {
    // IRC's NETWORK token cannot hold spaces.
    network: { name: cfg.site.name.replace(/[^A-Za-z0-9._-]/g, '') || cfg.site.short_name },
    server: {
      name: cfg.irc.public_host ?? `irc.${cfg.site.domain}`,
      listeners,
      'unix-bind-mode': 0o777,
      'tor-listeners': {},
      websockets: { 'allowed-origins': o.websocketOrigins },
      sts: { enabled: false },
      'lookup-hostnames': false,
      'forward-confirm-hostnames': false,
      'check-ident': false,
      'enforce-utf8': true,
      casemapping: 'ascii',
      'max-sendq': '96k',
      'compatibility': { 'force-trailing': true, 'send-unprefixed-sasl': true, 'allow-truncation': false },
      'ip-cloaking': { enabled: true, 'enabled-for-always-on': true, netname: cfg.site.short_name, 'cidr-len-ipv4': 32, 'cidr-len-ipv6': 64, 'num-bits': 64 },
      'secure-nets': ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
      // The WebSocket and bot connections arrive from Caddy and core on the private network.
      'proxy-allowed-from': ['localhost'],
      'connection-limits': { enabled: false },
      'connection-throttling': { enabled: true, 'cidr-len-ipv4': 32, 'cidr-len-ipv6': 64, duration: '10m', 'max-connections': 64, 'ban-duration': '10m', 'ban-message': 'Too many connections from your address. Try again in a few minutes.', exempted: ['localhost'] },
      relaymsg: { enabled: false },
      'override-services-hostname': '',
      motd: '',
      'suppress-lusers': false,
    },
    accounts: {
      'authentication-enabled': true,
      registration: { enabled: false },
      // Everyone signs in with their site account; there are no anonymous nicks (Q4, decided 2026-09-30).
      'require-sasl': { enabled: true, exempted: [] },
      'login-throttling': { enabled: true, duration: '1m', 'max-attempts': 5 },
      'skip-server-password': false,
      'nick-reservation': { enabled: true, 'additional-nick-limit': 0, method: 'strict', 'allow-custom-enforcement': false, 'guest-nickname-format': 'Guest-*', 'force-guest-format': false, 'force-nick-equals-account': true, 'forbid-anonymous-nick-changes': true },
      multiclient: { enabled: true, 'allowed-by-default': true, 'always-on': 'opt-in', 'auto-away': 'opt-in' },
      vhosts: { enabled: false },
      'default-user-modes': '+i',
      'auth-script': { enabled: true, command: o.authScript, args: [o.coreUrl, o.secrets.authToken], autocreate: true, timeout: '9s', 'kill-timeout': '1s', 'max-concurrency': 64 },
    },
    channels: {
      'default-modes': '+ntC',
      'max-channels-per-client': 100,
      'operator-only-creation': false,
      // Only the site's bot registers channels; core decides who may (docs/08).
      registration: { enabled: true, 'operator-only': true, 'max-channels-per-account': 0 },
      'list-delay': '0s',
      'invite-expiration': '24h',
      'auto-join': [cfg.irc.official_channels[0]],
    },
    'oper-classes': {
      'chat-moderator': { title: 'Chat Moderator', capabilities: ['kill', 'ban', 'nofakelag', 'sajoin', 'samode', 'snomasks'] },
      'server-admin': { title: 'Server Admin', extends: 'chat-moderator', capabilities: ['rehash', 'accreg', 'chanreg', 'history', 'defcon', 'massmessage', 'metadata'] },
    },
    opers: {
      [BOT_NICK]: { class: 'server-admin', hidden: true, 'whois-line': 'is the site bot', password: bcrypt.hashSync(o.secrets.botPassword, 10) },
    },
    logging: [{ method: 'stderr', type: '* -userinput -useroutput', level: 'info' }],
    datastore: { path: o.datastore ?? 'ircd.db', autoupgrade: true },
    limits: { nicklen: 32, identlen: 20, realnamelen: 150, channellen: 64, awaylen: 390, kicklen: 390, topiclen: 390, 'monitor-entries': 100, 'whowas-entries': 100, 'chan-list-modes': 100, 'registration-messages': 1024, multiline: { 'max-bytes': 4096, 'max-lines': 100 } },
    fakelag: { enabled: true, window: '1s', 'burst-limit': 5, 'messages-per-window': 2, cooldown: '2s' },
    roleplay: { enabled: false },
    history: {
      enabled: cfg.irc.history_days > 0,
      'channel-length': 2048,
      'client-length': 256,
      'autoresize-window': '3d',
      'autoreplay-on-join': 0,
      'chathistory-maxmessages': 1000,
      'znc-maxmessages': 2048,
      restrictions: { 'expire-time': `${Math.max(1, cfg.irc.history_days)}d`, 'query-cutoff': 'none', 'grace-period': '1h' },
      persistent: { enabled: false },
      retention: { 'allow-individual-delete': false, 'enable-account-indexing': false },
      'tagmsg-storage': { default: false, whitelist: ['+draft/react', '+react'] },
    },
    'allow-environment-overrides': false,
    metadata: { enabled: false },
    webpush: { enabled: false },
    api: { enabled: true, listener: o.apiListen, 'bearer-tokens': [o.secrets.apiToken] },
  };
  return `# Made by \`cli irc-config\` from the site config. Do not edit by hand: change the site config and run it again.\n${stringify(doc)}`;
}
