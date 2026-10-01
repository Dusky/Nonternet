import nodemailer from 'nodemailer';

export interface Mail { to: string; subject: string; text: string }
export interface Mailer { send(mail: Mail): Promise<void>; real?: boolean } // real: mail leaves the machine (SMTP is set)

// SMTP when SMTP_URL is set (e.g. smtp://user:pass@host:587); otherwise mail is logged so local
// development works with no mail server. Verification links are visible in the log.
export function makeMailer(opts: { smtpUrl?: string; from: string; log: (msg: string) => void }): Mailer {
  if (!opts.smtpUrl) {
    return { async send(mail) { opts.log(`[mail to ${mail.to}] ${mail.subject}\n${mail.text}`); } };
  }
  const transport = nodemailer.createTransport(opts.smtpUrl);
  return { real: true, async send(mail) { await transport.sendMail({ from: opts.from, ...mail }); } };
}

// Collects mail in memory, for tests.
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { sent, real: true, async send(mail) { sent.push(mail); } };
}
