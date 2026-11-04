import nodemailer from 'nodemailer';
import { appOrigin, store } from './accounts';
import { accountConfig as c } from '@meetwell/config/accounts';
/** Generic event-driven introduction mail. Only errors known to precede SMTP DATA
 * are retried. A timeout during DATA is uncertain and requires manual review. */
export async function sendIntroductionMail(
  email: string,
): Promise<'SENT' | 'RETRY' | 'UNCERTAIN' | 'FAILED'> {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? '127.0.0.1',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    connectionTimeout: c.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: c.SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: c.SMTP_SOCKET_TIMEOUT_MS,
  });
  try {
    await transport.sendMail({
      from: 'Meetwell <updates@meetwell.invalid>',
      to: email,
      subject: 'An update in Meetwell',
      text: `There is an update in your Meetwell account. Open your account to review it:\n\n${appOrigin()}/explore`,
    });
    return 'SENT';
  } catch (e) {
    const error = e as { code?: string; command?: string; responseCode?: number };
    if (
      error.code === 'ECONNECTION' ||
      error.code === 'EDNS' ||
      (error.code === 'ETIMEDOUT' && error.command === 'CONN')
    )
      return 'RETRY';
    if (error.responseCode && error.responseCode >= 400 && error.responseCode < 500) return 'RETRY';
    if (error.responseCode && error.responseCode >= 500) return 'FAILED';
    return 'UNCERTAIN';
  } finally {
    transport.close();
  }
}
export async function deliverAuthMail(accounts = store()) {
  // Local mailbox adapter. Real vendor selection and production transport remain release gates.
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? '127.0.0.1',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    connectionTimeout: c.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: c.SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: c.SMTP_SOCKET_TIMEOUT_MS,
  });
  try {
    const result = await accounts.deliverMagicLinks(async (email, token) => {
      const link = `${appOrigin()}/verify#${token}`;
      await transport.sendMail({
        from: 'Meetwell <access@meetwell.invalid>',
        to: email,
        subject: 'Your sign-in link',
        text: `Use this link in the browser where you requested it:\n\n${link}\n\nIf you did not request this, you can ignore it.`,
      });
    });
    if (result.failed > 0)
      process.stderr.write(`${JSON.stringify({ event: 'auth.delivery.retry', ...result })}\n`);
  } finally {
    transport.close();
  }
}
