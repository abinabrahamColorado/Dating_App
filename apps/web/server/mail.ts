import nodemailer from 'nodemailer';
import { appOrigin, store } from './runtime';
export async function deliverAuthMail() {
  // Local mailbox adapter. Real vendor selection and production transport remain release gates.
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? '127.0.0.1',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
    connectionTimeout: 5000,
    socketTimeout: 10000,
  });
  try {
    await store().deliverMagicLinks(async (email, token) => {
      const link = `${appOrigin()}/verify#${token}`;
      await transport.sendMail({
        from: 'Meetwell <access@meetwell.invalid>',
        to: email,
        subject: 'Your sign-in link',
        text: `Use this link in the browser where you requested it:\n\n${link}\n\nIf you did not request this, you can ignore it.`,
      });
    });
  } finally {
    transport.close();
  }
}
