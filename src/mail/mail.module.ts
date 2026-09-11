import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'path';
import { MailConfig } from '@/config/configuration';
import { MailService } from './mail.service';

@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const mail = configService.getOrThrow<MailConfig>('mail');

        return {
          transport: {
            host: mail.host,
            port: mail.port,
            secure: mail.secure,
            auth: mail.user
              ? { user: mail.user, pass: mail.password }
              : undefined,
          },
          defaults: {
            from: mail.from,
          },
          template: {
            dir: join(__dirname, 'templates'),
            adapter: new HandlebarsAdapter(),
            options: { strict: true },
          },
        };
      },
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
