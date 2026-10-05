import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { ApiError } from './errors';

// Fetching something from an address a person typed (docs/15). The server must never be turned into a way to reach
// what only it can see, so every name is resolved first and refused if any address it gives is private, loopback,
// link-local or otherwise not on the public internet; the connection then goes to the address that was checked, so a
// name can't answer differently the second time. Redirects are followed by hand (at most three), each checked again.
// The body is cut off at `maxBytes` and the whole thing at `timeoutMs`.

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(a, p, 'ipv6');

export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (!family) return false;
  // An IPv4 address written as IPv6 (::ffff:a.b.c.d) is judged as the IPv4 address it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPublicAddress(mapped[1]!);
  return !blocked.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

export interface FetchedFile { data: Buffer; contentType: string; finalUrl: string }
export interface SafeFetchOptions { maxBytes: number; timeoutMs?: number; accept?: string; allowPrivate?: boolean }

const refuse = (message: string) => new ApiError(400, 'fetch_refused', message);

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<FetchedFile> {
  let url = rawUrl;
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  for (let hop = 0; hop < 4; hop++) {
    const r = await once(url, opts, deadline);
    if ('redirect' in r) { url = r.redirect; continue; }
    return r;
  }
  throw refuse('That address sends you round too many times.');
}

function once(rawUrl: string, opts: SafeFetchOptions, deadline: number): Promise<FetchedFile | { redirect: string }> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return Promise.reject(refuse('That is not a web address.')); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return Promise.reject(refuse('Only http and https addresses work.'));
  if (u.username || u.password) return Promise.reject(refuse('Leave the name and password out of the address.'));
  // Checks every address the name resolves to, and connects to the first one.
  const lookup = (host: string, _o: unknown, cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
    dnsLookup(host, { all: true }, (err, addrs: LookupAddress[]) => {
      if (err) return cb(err, '', 0);
      if (!addrs.length) return cb(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }), '', 0);
      if (!opts.allowPrivate && addrs.some((a) => !isPublicAddress(a.address))) return cb(Object.assign(new Error('private address'), { code: 'EPRIVATE' }), '', 0);
      cb(null, addrs[0]!.address, addrs[0]!.family);
    });
  };
  const literal = net.isIP(u.hostname.replace(/^\[|\]$/g, ''));
  if (literal && !opts.allowPrivate && !isPublicAddress(u.hostname.replace(/^\[|\]$/g, ''))) return Promise.reject(refuse('That address is not on the public internet.'));
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(refuse('That address took too long to answer.'));
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? https : http).request(u, {
      method: 'GET', lookup: literal ? undefined : (lookup as never), timeout: left,
      headers: { accept: opts.accept ?? '*/*', 'user-agent': 'site-fetch/1 (+picture copy)' },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        try { resolve({ redirect: new URL(res.headers.location, u).toString() }); } catch { reject(refuse('That address sends you somewhere broken.')); }
        return;
      }
      if (status !== 200) { res.resume(); reject(refuse(`That address answered ${status}, not a file.`)); return; }
      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared > opts.maxBytes) { res.destroy(); reject(new ApiError(413, 'too_big', 'That file is too big.')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > opts.maxBytes) { res.destroy(); reject(new ApiError(413, 'too_big', 'That file is too big.')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ data: Buffer.concat(chunks), contentType: String(res.headers['content-type'] ?? ''), finalUrl: u.toString() }));
      res.on('error', () => reject(refuse('The download broke off.')));
    });
    req.on('timeout', () => { req.destroy(); reject(refuse('That address took too long to answer.')); });
    req.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EPRIVATE' ? refuse('That address is not on the public internet.') : refuse('That address could not be reached.')));
    req.end();
  });
}
