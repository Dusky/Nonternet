const WebSocket = require(process.env.ENIGMA_DIR + '/node_modules/ws');
const http = require('http');
const [,, mode] = process.argv;
function post(path, body) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port: 8080, path, method: 'POST',
      headers: { 'x-bridge-secret': 'spike-secret', 'content-type': 'application/json' } },
      resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => res(JSON.parse(d))); });
    r.on('error', rej); r.end(JSON.stringify(body));
  });
}
function txt(b) {
  return b.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x00-\x08\x0b-\x1f]/g, '')
    .split('\n').map(l => l.trim()).filter(l => /[A-Za-z0-9]{3}/.test(l) && !/[▀▄█░▒▓]{3}/.test(l)).join('\n');
}
function run(url, label, ms = 6000) {
  return new Promise(resolve => {
    const ws = new WebSocket(url); let all = Buffer.alloc(0);
    ws.on('message', d => {
      d = Buffer.from(d); let out = [];
      for (let i = 0; i < d.length; i++) {
        if (d[i] === 255 && d[i+1] >= 251 && d[i+1] <= 254) {
          const cmd = d[i+1], opt = d[i+2];
          if (cmd === 253 && opt === 31) ws.send(Buffer.from([255,251,31,255,250,31,0,80,0,24,255,240]));
          else if (cmd === 253 && opt === 24) ws.send(Buffer.from([255,251,24]));
          else if (cmd === 253) ws.send(Buffer.from([255,252,opt]));
          else if (cmd === 251) ws.send(Buffer.from([255,254,opt]));
          i += 2;
        } else if (d[i] === 255 && d[i+1] === 250) {
          if (d[i+2] === 24) ws.send(Buffer.concat([Buffer.from([255,250,24,0]), Buffer.from('xterm'), Buffer.from([255,240])]));
          while (i < d.length && !(d[i] === 255 && d[i+1] === 240)) i++; i++;
        } else out.push(d[i]);
      }
      const o = Buffer.from(out); all = Buffer.concat([all, o]);
      const s = o.toString('latin1');
      if (s.includes('\x1b[0c')) ws.send(Buffer.from('\x1b[?1;2c'));
      if (s.includes('\x1b[6n')) ws.send(Buffer.from('\x1b[24;80R'));
    });
    ws.on('close', () => { console.log(`--- ${label}: closed ---`); console.log(txt(all).slice(-500)); resolve(); });
    ws.on('error', e => console.log(label, 'error', e.message));
    setTimeout(() => { console.log(`--- ${label}: still open after ${ms}ms ---`); console.log(txt(all).slice(-600)); ws.close(); }, ms);
  });
}
(async () => {
  const t = await post('/bridge/tickets', { handle: 'zerocool' });
  console.log('ticket issued:', t.ticket.slice(0, 8) + '…', 'ttl', t.expiresInSeconds);
  await run(`ws://127.0.0.1:8812/?handle=zerocool&ticket=${t.ticket}`, 'valid ticket');
  await run(`ws://127.0.0.1:8812/?handle=zerocool&ticket=${t.ticket}`, 'replayed ticket', 3000);
  await run(`ws://127.0.0.1:8812/?handle=zerocool&ticket=deadbeef`, 'bad ticket', 3000);
})();
