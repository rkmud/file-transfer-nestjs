import { MailerService } from '@nestjs-modules/mailer';
import { FakeClock, useFakeClock } from '../../../test/setup/clock';
import { MailService } from './mail.service';

describe('MailService', () => {
  let clock: FakeClock;
  let sendMail: jest.Mock;
  let service: MailService;

  beforeEach(() => {
    clock = useFakeClock('2026-01-15T10:00:00.000Z');
    sendMail = jest.fn().mockResolvedValue(undefined);
    service = new MailService({ sendMail } as unknown as MailerService);
  });

  afterEach(() => clock.restore());

  const inMs = (ms: number) => new Date(clock.now().getTime() + ms);

  it('sends the verification code template', async () => {
    await service.sendVerificationEmail(
      'a@example.com',
      '123456',
      inMs(600_000),
    );

    expect(sendMail).toHaveBeenCalledWith({
      to: 'a@example.com',
      subject: 'Verify your email',
      template: 'verification-code',
      context: { code: '123456', minutesLeft: 10 },
    });
  });

  it('sends the email-change template with the name', async () => {
    await service.sendEmailChangeEmail(
      'new@example.com',
      'Ann',
      '654321',
      inMs(5 * 60_000),
    );

    expect(sendMail).toHaveBeenCalledWith({
      to: 'new@example.com',
      subject: 'Confirm your new email address',
      template: 'email-change-code',
      context: { name: 'Ann', code: '654321', minutesLeft: 5 },
    });
  });

  it('sends the account-deletion template with the name', async () => {
    await service.sendAccountDeletionEmail(
      'b@example.com',
      'Bob',
      '111222',
      inMs(15 * 60_000),
    );

    expect(sendMail).toHaveBeenCalledWith({
      to: 'b@example.com',
      subject: 'Confirm account deletion',
      template: 'account-deletion-code',
      context: { name: 'Bob', code: '111222', minutesLeft: 15 },
    });
  });

  it.each([
    [89_000, 1], // 1.48 min rounds down
    [90_000, 2], // 1.5 min rounds up
    [150_000, 3], // 2.5 min
    [29_000, 1], // rounds to 0 -> minimum 1
    [0, 1], // already expired -> minimum 1
    [-120_000, 1], // in the past -> minimum 1
  ])('minutesLeft for %i ms remaining is %i', async (remaining, expected) => {
    await service.sendVerificationEmail('a@example.com', '1', inMs(remaining));

    expect(sendMail.mock.calls[0][0].context.minutesLeft).toBe(expected);
  });

  it('computes minutesLeft against the current clock', async () => {
    const expiresAt = inMs(10 * 60_000);

    clock.advance(4 * 60_000);
    await service.sendVerificationEmail('a@example.com', '1', expiresAt);

    expect(sendMail.mock.calls[0][0].context.minutesLeft).toBe(6);
  });

  it('propagates mailer failures', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(
      service.sendVerificationEmail('a@example.com', '1', inMs(60_000)),
    ).rejects.toThrow('SMTP down');
  });
});
