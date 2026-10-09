import { deflateSync } from 'node:zlib';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Pictures in posts and mail (docs/23, E6): add one while writing (saying what it shows), see it as someone else.
// A real 16x16 blue PNG, built here so the test needs no picture file.
function makePng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(t)); return Buffer.concat([len, t, c]); };
  const w = 16; const h = 16;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [40, 90, 200]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = makePng();
const h = { origin: BASE_URL };

test('a picture goes in a post and a message, needs a description, and shows to the readers', async ({ page, browser }) => {
  const author = await makeUser(page);
  const reader = await makeUser(page);
  await setRole(author.handle, 'trusted');
  await signIn(page, author.handle, PASSWORD);
  const slug = uniq('pics');
  await page.request.post('/api/v1/boards', { data: { slug, name: 'Pictures', visibility: 'public' }, headers: h });

  await page.goto(`/boards/${slug}/new`);
  await page.getByLabel('Subject', { exact: false }).first().fill('A picture for you');
  await page.locator('#compose-body').fill('Look at this:');
  await page.locator('.picture-add input[type=file]').setInputFiles({ name: 'door.png', mimeType: 'image/png', buffer: PNG });
  const insert = page.getByRole('button', { name: 'Add it to the text' });
  await expect(insert).toBeDisabled(); // it needs a description first
  await page.getByLabel('What does it show?', { exact: false }).fill('a small blue square');
  await insert.click();
  await expect(page.locator('#compose-body')).toHaveValue(/!\[a small blue square\]\(image:i_[0-9A-Z]{26}\)/);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByRole('img', { name: 'a small blue square' })).toBeVisible();

  // Someone else sees it, drawn at a real size.
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const rp = await ctx.newPage();
  await signIn(rp, reader.handle, PASSWORD);
  await rp.goto(`/boards/${slug}`);
  await rp.getByRole('link', { name: 'A picture for you' }).click();
  const img = rp.getByRole('img', { name: 'a small blue square' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const scan = await new AxeBuilder({ page: rp }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  // In mail, only the two of them see it.
  await page.goto(`/mail/new/${reader.handle}`);
  await page.getByLabel('Subject').fill(uniq('Pic '));
  await page.locator('.picture-add input[type=file]').setInputFiles({ name: 'door.png', mimeType: 'image/png', buffer: PNG });
  await page.getByLabel('What does it show?', { exact: false }).fill('another blue square');
  await page.getByRole('button', { name: 'Add it to the text' }).click();
  await page.getByRole('button', { name: 'Send', exact: false }).first().click();
  await expect(page.getByRole('img', { name: 'another blue square' })).toBeVisible();
  await ctx.close();
});
