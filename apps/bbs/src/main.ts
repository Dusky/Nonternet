import { WebSocketServer } from 'ws';
import { ArtPack } from './art';
import { envFrom } from './config';
import { Core } from './core';
import { hostKey } from './hostkey';
import { attachWs, sshServer, telnetServer } from './listeners';
import { Nodes } from './nodes';
import type { BbsContext } from './session';

// The BBS (docs/04): telnet, SSH and the web terminal, all as clients of core.

async function start() {
  const env = envFrom(process.env);
  const log = (m: string) => console.error(`[bbs] ${m}`);
  const cfg = env.site.bbs;
  const art = new ArtPack(env.artDir, { 'site.name': env.site.site.name, 'site.domain': env.site.site.domain, 'site.url': env.publicUrl });
  const core = new Core(env.coreUrl, env.authToken, env.publicUrl);
  const nodes = new Nodes(cfg.max_nodes, cfg.per_ip);
  const ctx: BbsContext = { core, art, nodes, secret: env.secret, siteUrl: env.publicUrl, log, doors: cfg.doors, doorWrapper: cfg.door_wrapper };
  const opts = { idleMs: cfg.idle_minutes * 60_000 };
  nodes.start(core, 3000, log);
  nodes.startNews(core);
  telnetServer(ctx, opts).listen(env.telnetPort, '0.0.0.0', () => log(`telnet on ${env.telnetPort}`));
  sshServer(ctx, hostKey(env.hostKeyFile), opts).listen(env.sshPort, '0.0.0.0', () => log(`ssh on ${env.sshPort}`));
  const wss = new WebSocketServer({ port: env.wsPort, maxPayload: 64 * 1024 }, () => log(`websocket on ${env.wsPort}`));
  attachWs(wss, ctx, { ...opts, trustProxy: (ip) => env.trustedProxies.includes(ip.replace(/^::ffff:/, '')) });
  const stop = () => { nodes.stop(); for (const n of nodes.list()) n.drop('The BBS is restarting. Call again in a minute.'); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
start().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
