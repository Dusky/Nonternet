import { promises as dns } from 'node:dns';
import { statfs } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { cpus, totalmem } from 'node:os';
import type { Probes } from './checks';

// The real machine. The installer runs in a container on the host's network (sitectl starts it with --network host and
// the deploy folder mounted), so ports, DNS and disk are the host's. Docker's versions come from sitectl, which asks the
// host's own docker.
export function nodeProbes(deployDir: string, env: NodeJS.ProcessEnv = process.env): Probes {
  return {
    cpus: () => cpus().length,
    memoryBytes: () => totalmem(),
    diskFreeBytes: async () => { const s = await statfs(deployDir); return s.bavail * s.bsize; },
    docker: () => ({ docker: env.HOST_DOCKER_VERSION || null, compose: env.HOST_COMPOSE_VERSION || null }),
    portFree: (port) => new Promise((resolve) => {
      const srv = createServer();
      srv.once('error', () => resolve(false));
      srv.listen({ port, host: '0.0.0.0', exclusive: true }, () => srv.close(() => resolve(true)));
    }),
    resolve: (name) => dns.resolve4(name),
    publicIp: async () => {
      try {
        const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) });
        return r.ok ? (await r.text()).trim() : null;
      } catch { return null; }
    },
    smtpGreets: (url) => new Promise((resolve) => {
      let u: URL;
      try { u = new URL(url); } catch { return resolve(false); }
      const secure = u.protocol === 'smtps:';
      const port = Number(u.port || (secure ? 465 : 587));
      const sock = secure ? tlsConnect({ host: u.hostname, port, servername: u.hostname }) : connect({ host: u.hostname, port });
      const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
      sock.setTimeout(6000, () => done(false));
      sock.once('error', () => done(false));
      sock.once('data', (b) => done(b.toString().startsWith('220')));
    }),
  };
}
