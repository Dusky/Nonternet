import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, posix } from 'node:path';
import { ApiError } from '../errors';

// What a homepage may contain. Anything else is refused at upload, so the site never stores or
// serves a kind of file it has not thought about (docs/07). Served with these types and `nosniff`.
export const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml', ico: 'image/x-icon', png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', mid: 'audio/midi', midi: 'audio/midi', mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf',
};
export const extOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
export const mimeFor = (name: string): string | null => MIME[extOf(name)] ?? null;
// Text the studio can open in its editor.
export const isEditable = (name: string): boolean => ['html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'md', 'xml', 'svg'].includes(extOf(name));

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.~()+-]{0,99}$/;
export const MAX_DEPTH = 8;
export const MAX_FILES = 500;
export const MAX_PATH = 200;
const bad = (msg: string) => new ApiError(400, 'bad_path', msg);

// A path inside a homepage: "index.html", "img/cat.gif". Slashes only, no dots at the start of a
// name, no "..", nothing that could point outside the folder (docs/15).
export function cleanPath(input: string, opts: { allowRoot?: boolean } = {}): string {
  const p = input.replace(/^\/+|\/+$/g, '');
  if (p === '') {
    if (opts.allowRoot) return '';
    throw bad('Give a file name.');
  }
  if (p.length > MAX_PATH) throw bad('That path is too long.');
  const parts = p.split('/');
  if (parts.length > MAX_DEPTH) throw bad(`Folders can go ${MAX_DEPTH - 1} deep.`);
  for (const s of parts) {
    if (!SEGMENT.test(s)) throw bad('Names can use letters, digits and _ . ~ ( ) + - and must start with a letter, digit or underscore. No spaces.');
  }
  return parts.join('/');
}

export interface Entry { path: string; type: 'file' | 'dir'; size: number; modified: string }

const tails = new Map<string, Promise<void>>();
// One change at a time per person, so two uploads at once cannot both pass the quota check.
export async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  try { return await fn(); } finally { release(); if (tails.get(key) === tail) tails.delete(key); }
}

export class HomeStore {
  constructor(readonly root: string) {}

  dir(userId: string): string {
    if (!/^u_[0-9A-Z]{26}$/.test(userId)) throw new Error('bad user id');
    return join(this.root, userId);
  }

  private abs(userId: string, rel: string): string {
    return rel === '' ? this.dir(userId) : join(this.dir(userId), ...rel.split('/'));
  }

  // Everything in a homepage, folders first within each level. Symbolic links are skipped: we never
  // make them, so one that appears did not come from us.
  async tree(userId: string): Promise<Entry[]> {
    const out: Entry[] = [];
    const walk = async (rel: string): Promise<void> => {
      let names: string[];
      try { names = await fs.readdir(this.abs(userId, rel)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
      names.sort();
      for (const name of names) {
        const childRel = rel ? `${rel}/${name}` : name;
        // Another upload may rename its temporary file away between the listing and this look.
        const st = await this.statOrNull(this.abs(userId, childRel));
        if (!st || st.isSymbolicLink() || name.endsWith('.part')) continue;
        if (st.isDirectory()) { out.push({ path: childRel, type: 'dir', size: 0, modified: st.mtime.toISOString() }); if (out.length < 5000) await walk(childRel); }
        else if (st.isFile()) out.push({ path: childRel, type: 'file', size: st.size, modified: st.mtime.toISOString() });
      }
    };
    await walk('');
    return out;
  }

  async usage(userId: string): Promise<{ bytes: number; files: number; hasIndex: boolean }> {
    const t = await this.tree(userId);
    const files = t.filter((e) => e.type === 'file');
    return { bytes: files.reduce((n, f) => n + f.size, 0), files: files.length, hasIndex: files.some((f) => f.path === 'index.html') };
  }

  private async statOrNull(p: string) {
    try { return await fs.lstat(p); } catch (e) { if (['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code ?? '')) return null; throw e; }
  }

  // Every folder along the way must be a real folder, not a file or a link.
  private async ensureParents(userId: string, rel: string): Promise<void> {
    const parts = rel.split('/').slice(0, -1);
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      const st = await this.statOrNull(this.abs(userId, cur));
      if (st && !st.isDirectory()) throw new ApiError(409, 'not_a_folder', `${cur} is a file, so nothing can go inside it.`);
      if (st?.isSymbolicLink()) throw new ApiError(409, 'not_a_folder', 'That path is not allowed.');
    }
    await fs.mkdir(join(this.dir(userId), ...parts), { recursive: true });
  }

  async write(userId: string, rel: string, data: Buffer, limits: { maxFile: number; quota: number }): Promise<void> {
    const ext = extOf(rel);
    if (!MIME[ext]) throw new ApiError(415, 'file_type_not_allowed', `.${ext || 'no extension'} files cannot go on a homepage. Allowed: ${Object.keys(MIME).join(', ')}.`);
    if (data.length > limits.maxFile) throw new ApiError(413, 'file_too_large', `A file can be up to ${Math.floor(limits.maxFile / 1048576)} MB.`);
    await exclusive(userId, async () => {
      const target = this.abs(userId, rel);
      const existing = await this.statOrNull(target);
      if (existing?.isDirectory()) throw new ApiError(409, 'is_a_folder', `${rel} is a folder.`);
      const tree = await this.tree(userId);
      const used = tree.filter((e) => e.type === 'file').reduce((n, f) => n + f.size, 0);
      const files = tree.filter((e) => e.type === 'file').length;
      if (used - (existing?.size ?? 0) + data.length > limits.quota) throw new ApiError(413, 'quota_exceeded', `That would go over your ${Math.floor(limits.quota / 1048576)} MB of space.`);
      if (!existing && files >= MAX_FILES) throw new ApiError(413, 'too_many_files', `A homepage can have up to ${MAX_FILES} files.`);
      await this.ensureParents(userId, rel);
      // Write beside the file and rename, so a visitor never sees half a file.
      const tmp = `${target}.${randomBytes(4).toString('hex')}.part`;
      await fs.writeFile(tmp, data, { mode: 0o644 });
      await fs.rename(tmp, target);
    });
  }

  async read(userId: string, rel: string, maxBytes = 2 * 1048576): Promise<Buffer> {
    const p = this.abs(userId, rel);
    const st = await this.statOrNull(p);
    if (!st || !st.isFile()) throw new ApiError(404, 'not_found', 'No such file.');
    if (st.size > maxBytes) throw new ApiError(413, 'file_too_large', 'That file is too big to open in the editor.');
    return fs.readFile(p);
  }

  async mkdir(userId: string, rel: string): Promise<void> {
    await exclusive(userId, async () => {
      const st = await this.statOrNull(this.abs(userId, rel));
      if (st) throw new ApiError(409, 'exists', 'That name is already used.');
      await this.ensureParents(userId, rel);
      await fs.mkdir(this.abs(userId, rel));
    });
  }

  async remove(userId: string, rel: string): Promise<void> {
    if (rel === '') throw bad('Choose what to delete.');
    await exclusive(userId, async () => {
      const st = await this.statOrNull(this.abs(userId, rel));
      if (!st) throw new ApiError(404, 'not_found', 'No such file or folder.');
      await fs.rm(this.abs(userId, rel), { recursive: true, force: true });
    });
  }

  async move(userId: string, from: string, to: string): Promise<void> {
    if (from === '' || to === '') throw bad('Choose a name.');
    if (to === from || to.startsWith(`${from}/`)) throw bad('A folder cannot be moved into itself.');
    await exclusive(userId, async () => {
      const src = await this.statOrNull(this.abs(userId, from));
      if (!src) throw new ApiError(404, 'not_found', 'No such file or folder.');
      if (src.isFile() && !MIME[extOf(to)]) throw new ApiError(415, 'file_type_not_allowed', 'That name would make it a kind of file that cannot go on a homepage.');
      if (await this.statOrNull(this.abs(userId, to))) throw new ApiError(409, 'exists', 'That name is already used.');
      await this.ensureParents(userId, to);
      await fs.rename(this.abs(userId, from), this.abs(userId, to));
    });
  }

  async removeAll(userId: string): Promise<void> {
    await fs.rm(this.dir(userId), { recursive: true, force: true });
  }
}

export const parentOf = (rel: string): string => (posix.dirname(rel) === '.' ? '' : posix.dirname(rel));
