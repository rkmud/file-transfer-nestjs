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
    const minutesLeft = Math.max(
      1,
      Math.round((expiresAt.getTime() - Date.now()) / 60_000),
    );

    await this.mailerService.sendMail({
      to: email,
      subject: 'Verify your email',
      template: 'verification-code',
      context: { code, minutesLeft },
    });
  }
}
