import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendVerificationEmail(
    email: string,
    code: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Verify your email',
      template: 'verification-code',
      context: { code, minutesLeft: this.minutesLeft(expiresAt) },
    });
  }

  async sendEmailChangeEmail(
    email: string,
    name: string,
    code: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your new email address',
      template: 'email-change-code',
      context: { name, code, minutesLeft: this.minutesLeft(expiresAt) },
    });
  }

  private minutesLeft(expiresAt: Date): number {
    return Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
  }
}
