import { statSync } from 'node:fs';
import { depsFromEnv } from './env';
import { loadGeminiCert } from './gemini/cert';
import { buildGeminiServer } from './gemini/server';

// The read-only Gemini mirror (docs/05), its own process beside core. It only reads the database. The certificate is
// reloaded on SIGHUP (`sitectl tls-reload`) and whenever its file changes, so a renewed site certificate is picked up.
async function start() {
  const deps = depsFromEnv();
  let cert = await loadGeminiCert(deps.config);
  console.log(`gemini certificate (${cert.source}): ${cert.fingerprint}`);
  const { server, reload } = buildGeminiServer(deps, cert, (m) => console.error(m));
  const mtime = () => { try { return cert.certPath ? statSync(cert.certPath).mtimeMs : 0; } catch { return 0; } };
  let seen = mtime();
  const refresh = async (why: string) => {
    try {
      cert = await loadGeminiCert(deps.config);
      reload(cert);
      seen = mtime();
      console.log(`gemini certificate reloaded (${why}): ${cert.fingerprint}`);
    } catch (e) { console.error(`gemini certificate reload failed: ${e instanceof Error ? e.message : String(e)}`); }
  };
  process.on('SIGHUP', () => void refresh('SIGHUP'));
  setInterval(() => { if (mtime() !== seen) void refresh('file changed'); }, 3_600_000).unref();
  const shutdown = () => { server.close(() => void deps.db.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const port = Number(process.env.GEMINI_LISTEN_PORT ?? 1965);
  server.listen(port, '0.0.0.0', () => console.log(`gemini listening on ${port}`));
}
start().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
