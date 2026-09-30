// A tiny door for the tests: reads DOOR32.SYS, greets the caller, echoes lines back in capitals, "q" quits,
// "hang" never answers again (for the time limit).
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'latin1').split('\r\n');
process.stdout.write(`Hello, ${lines[6]} on node ${lines[10]}. Level ${lines[7]}.\r\n> `);
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString('utf8');
  let i;
  while ((i = buf.search(/[\r\n]/)) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line === 'q') { process.stdout.write('Bye from the door.\r\n'); process.exit(0); }
    if (line === 'hang') { process.stdin.pause(); return; }
    if (line) process.stdout.write(`${line.toUpperCase()}\r\n> `);
  }
});
