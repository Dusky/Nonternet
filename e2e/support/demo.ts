import { startStack, cli, BASE_URL, CORE_PORT, BBS_TELNET_PORT, BBS_SSH_PORT, HOMES_DOMAIN, HOMES_PORT, MUD_TELNET_PORT, ERGO_BIN, EVENNIA_BIN, SITE_NAME } from './stack';

// A site to look at (docs/19): the real thing, booted like the end-to-end tests do it, with a small demo community in it.
// Run with scripts/demo.sh. Everything is thrown away when you press Ctrl+C.
const ADMIN = { handle: 'steward', password: 'demo admin walkthrough 1' };

const stop = await startStack();
try {
  console.log(cli(['seed-demo', '--url', `http://127.0.0.1:${CORE_PORT}`]).trim());
  console.log(cli(['create-admin', '--handle', ADMIN.handle, '--email', 'steward@demo.invalid'], { ADMIN_PASSWORD: ADMIN.password }).split('\n')[0]);
  console.log(`
  ${SITE_NAME} is running.

  Open            ${BASE_URL}
  Sign in as      ada, lin, tansy, ozzy or moss      (password: demo walkthrough 1)
  Admin           ${ADMIN.handle}                         (password: ${ADMIN.password}; the first login asks you to set up
                                                            two-factor, which is what a real admin sees)
  Homepages       http://lin.${HOMES_DOMAIN}:${HOMES_PORT}/   (your browser must resolve *.${HOMES_DOMAIN} to this machine)
  Terminal BBS    telnet 127.0.0.1 ${BBS_TELNET_PORT}   or   ssh -p ${BBS_SSH_PORT} 127.0.0.1   (or the Terminal app on the site)
  Chat (IRC)      ${ERGO_BIN ? 'on: the Chat app' : 'off (needs ergo on the PATH)'}
  MUD             ${EVENNIA_BIN ? `on: the MUD app, or telnet 127.0.0.1 ${MUD_TELNET_PORT}` : 'off (needs evennia on the PATH)'}

  Press Ctrl+C to stop and throw the demo away.
`);
  await new Promise<void>((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
} finally {
  await stop();
}
