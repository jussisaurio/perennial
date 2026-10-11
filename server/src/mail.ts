import { Resend } from "resend";
import type { Config } from "./config";

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Development: keep messages in memory so tests and the local app can read them. */
export class OutboxMailer implements Mailer {
  readonly outbox: { to: string; subject: string; text: string; at: number }[] = [];
  async send(to: string, subject: string, text: string) {
    this.outbox.push({ to, subject, text, at: Date.now() });
    const code = subject.match(/\d{6}/)?.[0];
    console.log(code ? `[mail] sign-in code for ${to}: ${code}` : `[mail] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
  }
  latest(to: string) {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}

export class ResendMailer implements Mailer {
  private readonly resend: Resend;
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.resend = new Resend(apiKey);
  }
  async send(to: string, subject: string, text: string) {
    const { error } = await this.resend.emails.send({ from: this.from, to, subject, text });
    if (error) throw new Error(`email failed: ${error.message}`);
  }
}

export function createMailer(config: Config): Mailer {
  return config.mail.resendKey && !config.dev ? new ResendMailer(config.mail.resendKey, config.mail.from) : new OutboxMailer();
}
