import { Injectable, Logger } from '@nestjs/common';

/**
 * Sends project invitation emails. Uses the SMTP relay when SMTP_HOST is set;
 * otherwise logs the link (dev/test). Throws when the relay is unavailable so
 * the caller can report delivery: 'failed'.
 */
@Injectable()
export class InvitationMailerService {
  private readonly logger = new Logger('InvitationMailer');

  link(token: string): string {
    const base = (process.env.APP_URL ?? process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
    return `${base}/#/invitations/accept?token=${encodeURIComponent(token)}`;
  }

  async sendInvitation(email: string, token: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    if (!host) {
      this.logger.log(`[invitation] link for ${email}: ${this.link(token)}`);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 5000,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? 'no-reply@localhost',
      to: email,
      subject: 'You have been invited to a project',
      text: `You have been invited to collaborate on a project. Set your password here: ${this.link(token)}`,
    });
  }
}
