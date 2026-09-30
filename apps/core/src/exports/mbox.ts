// The person's posts as a mailbox (mboxrd), so mail and news readers can open them (docs/12).
export interface MboxPost { id: string; board: string; thread_id: string; reply_to: string | null; subject: string; body: string; posted_at: string }

const rfc2822 = (iso: string) => new Date(iso).toUTCString().replace('GMT', '+0000');
// Header values may not contain line breaks.
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');
// Non-ASCII subjects are sent as an encoded word so any reader shows them right.
const subjectHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

export function formatMbox(posts: MboxPost[], who: { handle: string; domain: string }): string {
  return posts.map((p) => {
    const headers = [
      `From ${who.handle}@${who.domain} ${new Date(p.posted_at).toUTCString().replace(/,/g, '').replace('GMT', '').trim()}`,
      `From: ${oneLine(who.handle)} <${who.handle}@${who.domain}>`,
      `Newsgroups: ${p.board}`,
      `Subject: ${subjectHeader(oneLine(p.subject))}`,
      `Date: ${rfc2822(p.posted_at)}`,
      `Message-ID: <${p.id}@${who.domain}>`,
      ...(p.reply_to ? [`In-Reply-To: <${p.reply_to}@${who.domain}>`, `References: <${p.thread_id}@${who.domain}>`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
    ];
    // mboxrd: any body line that starts with "From " (after any run of ">") gets one more ">".
    const body = p.body.replace(/\r\n?/g, '\n').split('\n').map((l) => (/^>*From /.test(l) ? `>${l}` : l)).join('\n');
    return `${headers.join('\n')}\n\n${body}\n`;
  }).join('\n');
}
