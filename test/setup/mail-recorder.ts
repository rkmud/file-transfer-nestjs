/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RecordedMail {
  to: string;
  subject?: string;
  template: string;
  context: Record<string, any>;
}

export class MailRecorder {
  readonly sent: RecordedMail[] = [];
  failNext: Error | null = null;

  sendMail = jest.fn(async (message: any) => {
    if (this.failNext) {
      const error = this.failNext;

      this.failNext = null;
      throw error;
    }

    this.sent.push({
      to: message.to,
      subject: message.subject,
      template: message.template,
      context: message.context ?? {},
    });

    return { messageId: `test-${this.sent.length}` };
  });

  last(): RecordedMail | undefined {
    return this.sent.at(-1);
  }

  to(address: string): RecordedMail[] {
    return this.sent.filter((mail) => mail.to === address);
  }

  lastCode(address: string): string {
    const code = this.to(address).at(-1)?.context.code;

    if (!code) throw new Error(`No OTP mail recorded for ${address}`);

    return code;
  }

  reset(): void {
    this.sent.length = 0;
    this.failNext = null;
    this.sendMail.mockClear();
  }
}
